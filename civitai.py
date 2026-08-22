"""Civitai 연동 — 로라 파일 해시로 모델 정보를 받아 metadata.json 을 만든다.

로라 라이브러리와 상세 창은 <로라이름>.metadata.json 의 civitai 블록을 읽는다.
지금까지는 그 파일을 다른 도구가 만들어줘야 했다. 여기서 직접 만든다.

파일 이름은 사람이 마음대로 바꾸므로 이름 대신 SHA256 해시로 모델을 찾는다.
해시는 한 번 구하면 metadata.json 에 남겨 두 번 계산하지 않는다.
"""

import asyncio
import hashlib
import os
import time
from urllib.parse import urlparse

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


async def _download(url):
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
                blob, ext = await _download(image["url"])
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
