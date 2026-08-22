"""Civitai 연동 — 로라 파일 해시로 모델 정보를 받아 metadata.json 을 만든다.

로라 라이브러리와 상세 창은 <로라이름>.metadata.json 의 civitai 블록을 읽는다.
지금까지는 그 파일을 다른 도구가 만들어줘야 했다. 여기서 직접 만든다.

파일 이름은 사람이 마음대로 바꾸므로 이름 대신 SHA256 해시로 모델을 찾는다.
해시는 한 번 구하면 metadata.json 에 남겨 두 번 계산하지 않는다.
"""

import asyncio
import hashlib
import os
import re
import time
from urllib.parse import urlencode, urlparse

from aiohttp import web
from server import PromptServer

import folder_paths

from .api import (
    PREVIEW_EXTS,
    MAX_PREVIEW_BYTES,
    _load_metadata,
    _metadata_path,
    _preview_path,
    _read_settings,
    _save_metadata,
    _write_preview,
    _write_settings,
)

routes = PromptServer.instance.routes

API_BASE = "https://civitai.com/api/v1"
# 한 번에 읽는 크기. 수백 MB 짜리 로라를 통째로 메모리에 올리지 않는다.
HASH_CHUNK = 4 * 1024 * 1024
# 연속 요청 사이 간격(초). 429(요청 과다)를 받지 않을 만큼만 띄운다.
REQUEST_GAP = 0.4
TIMEOUT = 30
# 진행 창에 남겨 보여줄 실패 기록 개수
MAX_ERRORS = 20


class CivitaiError(Exception):
    """호출 실패. 메시지를 그대로 화면에 보여준다."""


class NotFound(CivitaiError):
    """해시가 Civitai 에 없다. 다시 시도해도 결과가 같다."""


# ---------------------------------------------------------------- 해시


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(HASH_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def sha256_async(path):
    """해시는 파일 전체를 읽는다. 루프에서 그냥 돌리면 ComfyUI 가 멈춘다."""
    return await asyncio.get_running_loop().run_in_executor(None, sha256_of, path)


# ---------------------------------------------------------------- HTTP


def _api_key():
    key = _read_settings().get("civitai_api_key")
    return key.strip() if isinstance(key, str) and key.strip() else None


def _headers(api_key):
    headers = {"User-Agent": "comfy_FLA"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


async def _with_session(work):
    """ComfyUI 가 쓰던 세션을 빌려 쓰고, 없으면 잠깐 하나 연다."""
    session = getattr(PromptServer.instance, "client_session", None)
    if session is not None:
        return await work(session)
    import aiohttp
    async with aiohttp.ClientSession() as own:
        return await work(own)


async def _get_json(path, api_key, retries=2):
    import aiohttp

    url = f"{API_BASE}{path}"
    timeout = aiohttp.ClientTimeout(total=TIMEOUT)

    async def work(session):
        for attempt in range(retries + 1):
            try:
                async with session.get(url, headers=_headers(api_key), timeout=timeout) as res:
                    if res.status == 404:
                        raise NotFound("Civitai 에 없는 모델")
                    if res.status in (401, 403):
                        raise CivitaiError(f"권한 없음({res.status}) — API 키가 필요할 수 있음")
                    if res.status == 429:
                        # 잠깐 쉬었다 다시. 그래도 막히면 사용자에게 알린다.
                        if attempt < retries:
                            await asyncio.sleep(2 * (attempt + 1))
                            continue
                        raise CivitaiError("요청이 너무 잦음(429) — 잠시 뒤 다시")
                    if res.status != 200:
                        raise CivitaiError(f"HTTP {res.status}")
                    return await res.json()
            except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                if attempt < retries:
                    await asyncio.sleep(1)
                    continue
                raise CivitaiError(str(e) or "연결 실패") from e
        raise CivitaiError("연결 실패")

    return await _with_session(work)


async def _download_image(url):
    """예시 이미지를 서버가 받아온다. 브라우저에서 받으면 교차 출처에 걸린다."""
    import aiohttp

    timeout = aiohttp.ClientTimeout(total=TIMEOUT)

    async def work(session):
        async with session.get(url, timeout=timeout) as res:
            if res.status != 200:
                raise CivitaiError(f"이미지 HTTP {res.status}")
            return await res.read()

    blob = await _with_session(work)
    if len(blob) > MAX_PREVIEW_BYTES:
        raise CivitaiError("이미지가 너무 큼")
    ext = os.path.splitext(urlparse(url).path)[1].lower()
    return blob, (ext if ext in PREVIEW_EXTS else ".png")


# ---------------------------------------------------------------- 메타데이터


def has_info(metadata):
    return bool(metadata.get("civitai"))


def pick_preview(version):
    """대표로 쓸 예시 하나를 고른다. Civitai 가 먼저 주는 것이 표지 이미지다."""
    for image in version.get("images") or []:
        url = image.get("url")
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            return image
    return None


def build_metadata(existing, version, model, full_path, sha256):
    """사용자가 손댄 값(즐겨찾기·메모·대표 이미지)은 그대로 두고 Civitai 정보만 덮는다."""
    data = dict(existing or {})

    civitai = dict(version)
    if isinstance(model, dict):
        # 설명·태그·제작자는 버전이 아니라 모델 쪽에만 있다
        merged = dict(civitai.get("model") or {})
        for key in ("name", "type", "nsfw", "poi", "description", "tags", "allowCommercialUse"):
            if model.get(key) is not None:
                merged[key] = model[key]
        civitai["model"] = merged
        if model.get("creator"):
            civitai["creator"] = model["creator"]
    data["civitai"] = civitai

    block = civitai.get("model") or {}
    data["model_name"] = block.get("name") or data.get("model_name") or ""
    data["file_name"] = os.path.basename(full_path)
    data["base_model"] = version.get("baseModel") or data.get("base_model") or ""
    data["model_type"] = block.get("type") or data.get("model_type") or ""
    data["sha256"] = sha256
    data["size"] = os.path.getsize(full_path)
    if version.get("trainedWords"):
        data["trained_words"] = version["trainedWords"]
    if block.get("tags"):
        data["tags"] = block["tags"]
    data["model_id"] = version.get("modelId")
    data["version_id"] = version.get("id")
    data["civitai_fetched_at"] = int(time.time())
    # 예전에 "없음" 으로 찍혔더라도 이번에 찾았으니 지운다
    data.pop("civitai_missing", None)
    return data


def _mark_missing(metadata_path, metadata, sha256):
    """Civitai 에 없는 파일. 다음 일괄 검사에서 건너뛰도록 표시만 남긴다."""
    data = dict(metadata or {})
    data["sha256"] = sha256
    data["civitai_missing"] = True
    data["civitai_checked_at"] = int(time.time())
    try:
        _save_metadata(metadata_path, data)
    except OSError:
        pass


# ---------------------------------------------------------------- 한 개 가져오기


async def fetch_version_by_hash(sha256, api_key):
    return await _get_json(f"/model-versions/by-hash/{sha256}", api_key)


async def fetch_model(model_id, api_key):
    return await _get_json(f"/models/{model_id}", api_key)


async def enrich(name, api_key, overwrite=False, set_preview=True, replace_preview=False):
    """로라 하나를 Civitai 정보로 채운다.

    overwrite 가 거짓이면 이미 정보가 있는 파일은 건드리지 않는다.
    대표 이미지는 아직 없을 때만 받아온다. 사용자가 직접 고른 그림을
    말없이 바꾸지 않으려고, 정보를 새로 받을 때도 그림은 그대로 둔다
    (replace_preview 를 켜야 바꾼다).
    """
    full, metadata_path = _metadata_path(name)
    if full is None or not os.path.isfile(full):
        raise CivitaiError("파일을 찾을 수 없음")

    metadata = _load_metadata(metadata_path)
    if has_info(metadata) and not overwrite:
        return {"updated": False, "skipped": True, "title": metadata.get("model_name") or ""}

    sha = metadata.get("sha256")
    if not isinstance(sha, str) or len(sha) != 64:
        sha = await sha256_async(full)

    try:
        version = await fetch_version_by_hash(sha, api_key)
    except NotFound:
        _mark_missing(metadata_path, metadata, sha)
        raise

    model = None
    if version.get("modelId"):
        try:
            model = await fetch_model(version["modelId"], api_key)
        except CivitaiError:
            # 버전 정보만으로도 이름·트리거·예시는 채워진다. 설명·태그만 빠진다.
            model = None

    data = build_metadata(metadata, version, model, full, sha)

    stem = os.path.splitext(full)[0]
    already = _preview_path(stem, metadata.get("preview_url")) is not None
    blob = None
    ext = None
    image = None
    if set_preview and (replace_preview or not already):
        image = pick_preview(version)
        if image:
            try:
                blob, ext = await _download_image(image["url"])
            except CivitaiError:
                blob = None  # 정보는 살리고 그림만 포기한다

    if blob is not None:
        level = image.get("nsfwLevel")
        data["preview_nsfw_level"] = level if isinstance(level, int) else 0

    try:
        _save_metadata(metadata_path, data)
    except OSError as e:
        raise CivitaiError(str(e)) from e

    stamp = None
    if blob is not None:
        # _write_preview 가 파일에서 메타데이터를 다시 읽으므로 저장한 뒤에 부른다
        _, error = _write_preview(name, blob, ext)
        if not error:
            stamp = int(time.time())

    return {
        "updated": True,
        "skipped": False,
        "title": data.get("model_name") or "",
        "stamp": stamp,
        "model_id": data.get("model_id"),
    }


# ---------------------------------------------------------------- 일괄 검사


_progress = {
    "running": False,
    "total": 0,
    "done": 0,
    "updated": 0,
    "missing": 0,
    "failed": 0,
    "current": "",
    "cancelled": False,
    "errors": [],
    "finished_at": 0,
}
_task = None


def _reset_progress(total):
    _progress.update({
        "running": True,
        "total": total,
        "done": 0,
        "updated": 0,
        "missing": 0,
        "failed": 0,
        "current": "",
        "cancelled": False,
        "errors": [],
        "finished_at": 0,
    })


# 남은 개수는 진행 창이 0.7 초마다 물어본다. 매번 로라 전부의 metadata.json 을
# 읽으면(로라가 많을수록 오래 걸린다) 서버가 그만큼 멈춘다. 잠깐은 같은 값을 준다.
PENDING_TTL = 5.0
_pending = {"value": None, "at": 0.0}


def _invalidate_pending():
    _pending["value"] = None


def pending_count():
    now = time.monotonic()
    if _pending["value"] is None or now - _pending["at"] > PENDING_TTL:
        _pending["value"] = len(_targets(False))
        _pending["at"] = now
    return _pending["value"]


def _targets(overwrite):
    """검사할 파일 목록. 기본은 아직 정보가 없는 것만 고른다."""
    names = []
    for name in folder_paths.get_filename_list("loras"):
        _, metadata_path = _metadata_path(name)
        if metadata_path is None:
            continue
        metadata = _load_metadata(metadata_path)
        if overwrite:
            names.append(name)
            continue
        # 이미 채웠거나, 이전에 찾아봤는데 Civitai 에 없던 것은 건너뛴다
        if has_info(metadata) or metadata.get("civitai_missing") is True:
            continue
        names.append(name)
    return names


async def _scan(names, api_key, overwrite, set_preview, replace_preview):
    try:
        for name in names:
            if _progress["cancelled"]:
                break
            _progress["current"] = name
            try:
                result = await enrich(name, api_key, overwrite, set_preview, replace_preview)
                if result["updated"]:
                    _progress["updated"] += 1
            except NotFound:
                _progress["missing"] += 1
            except CivitaiError as e:
                _progress["failed"] += 1
                if len(_progress["errors"]) < MAX_ERRORS:
                    _progress["errors"].append({"name": name, "error": str(e)})
            except Exception as e:  # 예상 못 한 오류 하나로 전체가 멈추지 않게
                _progress["failed"] += 1
                if len(_progress["errors"]) < MAX_ERRORS:
                    _progress["errors"].append({"name": name, "error": repr(e)})
            _progress["done"] += 1
            await asyncio.sleep(REQUEST_GAP)
    finally:
        _progress["running"] = False
        _progress["current"] = ""
        _progress["finished_at"] = int(time.time())
        _invalidate_pending()


# ---------------------------------------------------------------- 라우트


@routes.get("/fla/civitai/status")
async def get_civitai_status(request):
    return web.json_response({
        "ok": True,
        "has_key": _api_key() is not None,
        "pending": pending_count(),
        "progress": dict(_progress),
    })


@routes.post("/fla/civitai/key")
async def post_civitai_key(request):
    """API 키는 user_settings.json 에만 둔다(깃에 올라가지 않는 파일)."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    key = body.get("key")
    if not isinstance(key, str):
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    settings = _read_settings()
    key = key.strip()
    if key:
        settings["civitai_api_key"] = key
    else:
        settings.pop("civitai_api_key", None)
    try:
        _write_settings(settings)
    except OSError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    return web.json_response({"ok": True, "has_key": bool(key)})


@routes.post("/fla/civitai/fetch")
async def post_civitai_fetch(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    name = body.get("name", "")
    if name not in folder_paths.get_filename_list("loras"):
        return web.json_response({"ok": False, "error": "LoRA not found"}, status=404)

    try:
        # 버튼으로 직접 부른 것이니 이미 정보가 있어도 새로 받는다
        result = await enrich(
            name,
            _api_key(),
            overwrite=body.get("overwrite") is not False,
            set_preview=body.get("set_preview") is not False,
            replace_preview=body.get("replace_preview") is True,
        )
    except NotFound as e:
        return web.json_response({"ok": False, "missing": True, "error": str(e)}, status=404)
    except CivitaiError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=502)

    _invalidate_pending()
    return web.json_response({"ok": True, **result})


@routes.post("/fla/civitai/scan")
async def post_civitai_scan(request):
    global _task
    if _progress["running"]:
        return web.json_response(
            {"ok": False, "error": "이미 검사 중", "progress": dict(_progress)}, status=409)

    try:
        body = await request.json()
    except Exception:
        body = {}
    overwrite = body.get("overwrite") is True
    set_preview = body.get("set_preview") is not False
    replace_preview = body.get("replace_preview") is True

    names = _targets(overwrite)
    _reset_progress(len(names))
    if not names:
        _progress["running"] = False
        _progress["finished_at"] = int(time.time())
        return web.json_response({"ok": True, "progress": dict(_progress)})

    _task = asyncio.create_task(_scan(names, _api_key(), overwrite, set_preview, replace_preview))
    return web.json_response({"ok": True, "progress": dict(_progress)})


@routes.post("/fla/civitai/cancel")
async def post_civitai_cancel(request):
    # 지금 처리 중인 파일까지는 마치고 멈춘다(반쯤 쓴 파일을 남기지 않는다)
    _progress["cancelled"] = True
    return web.json_response({"ok": True, "progress": dict(_progress)})


# ---------------------------------------------------------------- 검색
#
# Civitai 목록을 그대로 넘기면 한 페이지가 수 MB 다(버전마다 예시 이미지가 수십 장).
# 카드에 그릴 것만 추려서 넘긴다.

SEARCH_LIMIT = 24
# 카드 하나에 보여줄 예시 이미지 수
SEARCH_IMAGES = 6
# 이미 가진 로라 목록을 다시 훑는 간격(초)
INSTALLED_TTL = 10.0

_installed = {"hashes": None, "names": None, "at": 0.0}


def _installed_index():
    """이미 가진 로라의 해시와 파일 이름. 검색 결과에 '있음' 을 찍는 데 쓴다.

    해시가 없는 파일도 있으므로(아직 한 번도 안 채운 것) 이름도 같이 본다.
    """
    now = time.monotonic()
    if _installed["hashes"] is None or now - _installed["at"] > INSTALLED_TTL:
        hashes = set()
        names = set()
        for name in folder_paths.get_filename_list("loras"):
            names.add(os.path.basename(name).lower())
            _, metadata_path = _metadata_path(name)
            sha = _load_metadata(metadata_path).get("sha256")
            if isinstance(sha, str) and len(sha) == 64:
                hashes.add(sha.lower())
        _installed.update({"hashes": hashes, "names": names, "at": now})
    return _installed["hashes"], _installed["names"]


def _invalidate_installed():
    _installed["hashes"] = None


def _trim_image(image):
    return {
        "url": image.get("url"),
        "width": image.get("width"),
        "height": image.get("height"),
        "type": image.get("type") or "image",
        "nsfw_level": image.get("nsfwLevel") if isinstance(image.get("nsfwLevel"), int) else 0,
    }


def _primary_file(version):
    """내려받을 파일. 로라는 보통 Model 하나뿐이지만 VAE 가 딸려 오기도 한다."""
    files = [f for f in (version.get("files") or []) if f.get("type") == "Model"]
    if not files:
        return None
    return next((f for f in files if f.get("primary")), files[0])


def _trim_version(version, hashes, names, model=None, folders=None):
    primary = _primary_file(version) or {}
    sha = ((primary.get("hashes") or {}).get("SHA256") or "").lower()
    file_name = primary.get("name") or ""
    return {
        "id": version.get("id"),
        "name": version.get("name") or "",
        "base_model": version.get("baseModel") or "",
        "published": version.get("publishedAt") or version.get("createdAt") or "",
        "size_kb": primary.get("sizeKB"),
        "file_name": file_name,
        "sha256": sha,
        "downloadable": bool(primary),
        "installed": bool((sha and sha in hashes) or (file_name and file_name.lower() in names)),
        "trained_words": version.get("trainedWords") or [],
        # 어느 폴더에 둘지 미리 골라둔다(화면에서 바꿀 수 있다)
        "folder": suggest_folder(model or {}, version, folders) if folders is not None else "",
        "images": [_trim_image(i) for i in (version.get("images") or [])[:SEARCH_IMAGES]
                   if isinstance(i.get("url"), str)],
    }


def _trim_model(model, hashes, names, folders=None):
    stats = model.get("stats") or {}
    versions = [_trim_version(v, hashes, names, model, folders)
                for v in (model.get("modelVersions") or [])]
    return {
        "id": model.get("id"),
        "name": model.get("name") or "",
        "type": model.get("type") or "",
        "nsfw": model.get("nsfw") is True,
        "nsfw_level": model.get("nsfwLevel") if isinstance(model.get("nsfwLevel"), int) else 0,
        "tags": model.get("tags") or [],
        "creator": (model.get("creator") or {}).get("username") or "",
        "downloads": stats.get("downloadCount"),
        "likes": stats.get("thumbsUpCount"),
        "versions": versions,
        # 어느 버전이든 하나라도 있으면 카드에 표시한다
        "installed": any(v["installed"] for v in versions),
    }


@routes.get("/fla/civitai/search")
async def get_civitai_search(request):
    """Civitai 모델 목록을 대신 불러온다.

    브라우저에서 직접 부르면 교차 출처에 걸리고 API 키도 노출된다.
    """
    query = request.query
    params = {"limit": SEARCH_LIMIT, "types": query.get("types") or "LORA"}
    for key, name in (("query", "query"), ("tag", "tag"), ("username", "username"),
                      ("sort", "sort"), ("period", "period"), ("baseModels", "baseModels")):
        value = query.get(name, "").strip()
        if value:
            params[key] = value
    if query.get("nsfw") in ("true", "false"):
        params["nsfw"] = query["nsfw"]
    cursor = query.get("cursor", "").strip()
    if cursor:
        params["cursor"] = cursor

    try:
        data = await _get_json(f"/models?{urlencode(params)}", _api_key())
    except CivitaiError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=502)

    hashes, names = _installed_index()
    # 폴더 목록은 한 번만 훑고 모든 결과에 돌려 쓴다
    folders = library_folders()
    items = [_trim_model(m, hashes, names, folders) for m in (data.get("items") or [])]
    return web.json_response({
        "ok": True,
        "items": items,
        "next_cursor": (data.get("metadata") or {}).get("nextCursor") or "",
    })


# ---------------------------------------------------------------- 저장 폴더
#
# 받은 파일을 아무 데나 던져두면 나중에 찾지 못한다. 태그와 기반 모델을 보고
# 이미 쓰고 있는 폴더 중 하나를 골라 제안한다. 없는 폴더는 제안하지 않는다.

# 성인 등급으로 보는 nsfwLevel 하한(api.py 의 ADULT_LEVEL 과 같다)
ADULT_NSFW = 4

# 앞에 있는 규칙이 이긴다. 영상 모델은 기반 모델이 다르면 아예 못 쓰므로 먼저 본다.
FOLDER_RULES = [
    ("base", ("wan",), ("Wan2.2", "Wan2.1", "Wan", "Video")),
    ("base", ("ltx",), ("LTX-Video", "LTXV", "LTX", "Video")),
    ("base", ("hunyuan",), ("Hunyuan", "Video")),
    ("tag", ("character", "characters", "celebrity", "actress", "idol", "person"),
     ("Characters", "Character", "Char")),
    ("tag", ("poses", "pose"), ("Poses", "Pose")),
    ("tag", ("expression", "expressions", "emotion", "facial expression"),
     ("Expressions", "Expression", "Exp")),
    ("tag", ("background", "backgrounds", "scenery", "landscape", "location", "environment"),
     ("Locations", "Location", "Background", "Backgrounds")),
    ("tag", ("clothing", "clothes", "outfit", "dress", "costume", "uniform"),
     ("Clothing", "Clothes", "Outfit", "Dress")),
    ("nsfw", (), ("Adult", "NSFW", "18")),
    ("tag", ("style", "artstyle", "art style", "anime", "artist"), ("Anime", "Styles", "Style")),
    ("tag", ("concept", "tool", "helper"), ("Recipes", "Concepts", "Tools")),
]


def library_folders():
    """이미 로라가 들어 있는 하위 폴더 목록."""
    folders = set()
    for name in folder_paths.get_filename_list("loras"):
        parent = os.path.dirname(name).replace("\\", "/")
        parts = [p for p in parent.split("/") if p]
        for depth in range(1, len(parts) + 1):
            folders.add("/".join(parts[:depth]))
    return sorted(folders)


def suggest_folder(model, version, folders=None):
    """받은 모델을 어느 폴더에 둘지 고른다. 마땅한 곳이 없으면 빈 문자열."""
    if folders is None:
        folders = library_folders()
    # 폴더 이름은 대소문자만 다를 수 있다. 마지막 칸으로 견준다.
    by_leaf = {}
    for folder in folders:
        by_leaf.setdefault(folder.split("/")[-1].lower(), folder)

    tags = {str(tag).lower() for tag in (model.get("tags") or [])}
    base = str(version.get("baseModel") or "").lower()
    adult = model.get("nsfw") is True or (model.get("nsfwLevel") or 0) >= ADULT_NSFW

    for kind, needles, candidates in FOLDER_RULES:
        if kind == "base":
            hit = any(needle in base for needle in needles)
        elif kind == "tag":
            hit = bool(tags & set(needles))
        else:
            hit = adult
        if not hit:
            continue
        for candidate in candidates:
            found = by_leaf.get(candidate.lower())
            if found:
                return found
    return ""


@routes.get("/fla/civitai/folders")
async def get_civitai_folders(request):
    roots = folder_paths.get_folder_paths("loras")
    return web.json_response({
        "ok": True,
        "root": roots[0] if roots else "",
        "folders": library_folders(),
    })


# ---------------------------------------------------------------- 내려받기

# 한 번에 읽는 크기. 너무 잘게 나누면 진행률만 자주 바뀌고 느려진다.
DOWNLOAD_CHUNK = 1024 * 1024
# 연결이 끊긴 채 매달려 있지 않도록. 전체 시간에는 제한을 두지 않는다(큰 파일).
DOWNLOAD_READ_TIMEOUT = 120

_dl = {
    "running": False,
    "queue": [],
    "current": None,
    "received": 0,
    "total": 0,
    "done": 0,
    "failed": 0,
    "cancelled": False,
    "errors": [],
    "finished_at": 0,
}
_dl_task = None


class Cancelled(CivitaiError):
    """사용자가 멈췄다. 실패로 세지 않는다."""


def _safe_component(text):
    """경로를 뚫고 나갈 수 있는 글자를 걷어낸다."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(text or "")).strip(" .")
    return cleaned[:120]


def _resolve_target(folder, file_name):
    """<로라 루트>/<folder>/<파일> 경로를 만든다. 루트 밖으로 나가면 거절한다."""
    roots = folder_paths.get_folder_paths("loras")
    if not roots:
        raise CivitaiError("로라 폴더가 없음")
    root = os.path.abspath(roots[0])

    parts = [_safe_component(p) for p in str(folder or "").replace("\\", "/").split("/")]
    parts = [p for p in parts if p]
    target_dir = os.path.abspath(os.path.join(root, *parts)) if parts else root
    if os.path.commonpath([target_dir, root]) != root:
        raise CivitaiError("폴더가 로라 폴더 밖을 가리킴")

    name = _safe_component(file_name) or "lora.safetensors"
    if not os.path.splitext(name)[1]:
        name += ".safetensors"

    os.makedirs(target_dir, exist_ok=True)
    # 같은 이름이 있으면 덮지 않고 번호를 붙인다
    stem, ext = os.path.splitext(name)
    candidate = os.path.join(target_dir, name)
    index = 2
    while os.path.exists(candidate):
        candidate = os.path.join(target_dir, f"{stem} ({index}){ext}")
        index += 1
    return candidate


async def _stream_to_file(url, api_key, path, on_progress):
    """받은 만큼 바로 디스크에 쓴다. 로라는 수백 MB 라 메모리에 담지 않는다."""
    import aiohttp

    # 전체 제한은 두지 않는다. 대신 한동안 아무것도 안 오면 끊는다.
    timeout = aiohttp.ClientTimeout(total=None, connect=30, sock_read=DOWNLOAD_READ_TIMEOUT)
    # 내려받기 주소는 CDN 으로 넘어간다. 그쪽에 Authorization 헤더를 들고 가면
    # 서명과 충돌하므로 키는 쿼리로 붙인다(Civitai 가 권하는 방식).
    params = {"token": api_key} if api_key else None

    async def work(session):
        async with session.get(url, params=params, headers={"User-Agent": "comfy_FLA"},
                               timeout=timeout) as res:
            if res.status in (401, 403):
                raise CivitaiError("이 모델은 로그인해야 받을 수 있습니다 — API 키를 등록하세요")
            if res.status != 200:
                raise CivitaiError(f"HTTP {res.status}")
            total = int(res.headers.get("Content-Length") or 0)
            on_progress(0, total)
            received = 0
            with open(path, "wb") as f:
                async for chunk in res.content.iter_chunked(DOWNLOAD_CHUNK):
                    if _dl["cancelled"]:
                        raise Cancelled("취소함")
                    f.write(chunk)
                    received += len(chunk)
                    on_progress(received, total)
            if total and received != total:
                raise CivitaiError(f"받다가 끊김 ({received}/{total})")
            return received

    return await _with_session(work)


async def _write_sidecars(path, version, model, sha256):
    """받은 파일 옆에 metadata.json 과 대표 이미지를 놓는다."""
    stem = os.path.splitext(path)[0]
    data = build_metadata({}, version, model, path, sha256)

    image = pick_preview(version)
    if image:
        try:
            blob, ext = await _download_image(image["url"])
            with open(stem + ".preview" + ext, "wb") as f:
                f.write(blob)
            data["preview_url"] = os.path.basename(stem + ".preview" + ext)
            level = image.get("nsfwLevel")
            data["preview_nsfw_level"] = level if isinstance(level, int) else 0
        except (CivitaiError, OSError):
            pass  # 정보는 살리고 그림만 포기한다

    _save_metadata(stem + ".metadata.json", data)


async def download_version(version_id, folder, api_key, verify=True):
    """모델 버전 하나를 받아 폴더에 넣고 정보까지 채운다."""
    version = await _get_json(f"/model-versions/{version_id}", api_key)
    primary = _primary_file(version)
    if not primary:
        raise CivitaiError("받을 파일이 없음")

    expected = ((primary.get("hashes") or {}).get("SHA256") or "").lower()
    url = primary.get("downloadUrl") or version.get("downloadUrl")
    if not url:
        raise CivitaiError("내려받기 주소가 없음")

    path = _resolve_target(folder, primary.get("name") or f"{version_id}.safetensors")
    part = path + ".part"

    _dl["current"] = {
        "version_id": version_id,
        "title": (version.get("model") or {}).get("name") or version.get("name") or "",
        "file_name": os.path.basename(path),
        "folder": folder or "/",
    }

    def progress(received, total):
        _dl["received"] = received
        _dl["total"] = total

    try:
        await _stream_to_file(url, api_key, part, progress)

        sha = expected
        if verify:
            # 끊긴 파일을 정상으로 기록해두면 나중에 원인을 못 찾는다
            sha = await sha256_async(part)
            if expected and sha != expected:
                raise CivitaiError("받은 파일이 손상됨(해시 불일치)")

        os.replace(part, path)
    except BaseException:
        # 반쯤 받은 파일을 남기지 않는다
        try:
            if os.path.exists(part):
                os.remove(part)
        except OSError:
            pass
        raise

    model = None
    if version.get("modelId"):
        try:
            model = await fetch_model(version["modelId"], api_key)
        except CivitaiError:
            model = None
    try:
        await _write_sidecars(path, version, model, sha)
    except OSError:
        pass  # 파일은 이미 받았다. 정보는 나중에 다시 채울 수 있다.

    _invalidate_installed()
    _invalidate_pending()
    return {"path": path, "file_name": os.path.basename(path), "folder": folder}


async def _download_loop(api_key):
    try:
        while _dl["queue"] and not _dl["cancelled"]:
            job = _dl["queue"].pop(0)
            _dl["received"] = 0
            _dl["total"] = 0
            try:
                await download_version(job["version_id"], job.get("folder") or "", api_key)
                _dl["done"] += 1
            except Cancelled:
                break
            except CivitaiError as e:
                _dl["failed"] += 1
                if len(_dl["errors"]) < MAX_ERRORS:
                    _dl["errors"].append({"name": job.get("title") or job["version_id"], "error": str(e)})
            except Exception as e:
                _dl["failed"] += 1
                if len(_dl["errors"]) < MAX_ERRORS:
                    _dl["errors"].append({"name": job.get("title") or job["version_id"], "error": repr(e)})
    finally:
        _dl["running"] = False
        _dl["current"] = None
        _dl["received"] = 0
        _dl["total"] = 0
        _dl["finished_at"] = int(time.time())


@routes.post("/fla/civitai/download")
async def post_civitai_download(request):
    global _dl_task
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    try:
        version_id = int(body.get("version_id"))
    except (TypeError, ValueError):
        return web.json_response({"ok": False, "error": "Bad version"}, status=400)

    _dl["queue"].append({
        "version_id": version_id,
        "folder": body.get("folder") or "",
        "title": body.get("title") or "",
    })

    if not _dl["running"]:
        _dl["running"] = True
        _dl["cancelled"] = False
        _dl["done"] = 0
        _dl["failed"] = 0
        _dl["errors"] = []
        _dl["finished_at"] = 0
        _dl_task = asyncio.create_task(_download_loop(_api_key()))

    return web.json_response({"ok": True, "download": _public_download()})


def _public_download():
    return {
        "running": _dl["running"],
        "queued": len(_dl["queue"]),
        "current": _dl["current"],
        "received": _dl["received"],
        "total": _dl["total"],
        "done": _dl["done"],
        "failed": _dl["failed"],
        "cancelled": _dl["cancelled"],
        "errors": list(_dl["errors"]),
        "finished_at": _dl["finished_at"],
    }


@routes.get("/fla/civitai/download-status")
async def get_civitai_download_status(request):
    return web.json_response({"ok": True, "download": _public_download()})


@routes.post("/fla/civitai/download-cancel")
async def post_civitai_download_cancel(request):
    # 받던 파일은 지우고 대기열도 비운다
    _dl["cancelled"] = True
    _dl["queue"].clear()
    return web.json_response({"ok": True, "download": _public_download()})
