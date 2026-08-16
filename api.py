"""프론트엔드가 호출하는 프리셋 API."""

import json
import os
import time
from urllib.parse import quote, urlparse

from aiohttp import web
from server import PromptServer

import folder_paths

from . import presets

routes = PromptServer.instance.routes


# 사용자별 UI 상태(토글·폴더·즐겨찾기 필터 등). 깃에는 올리지 않는다.
SETTINGS_PATH = os.path.join(os.path.dirname(__file__), "user_settings.json")


def _read_settings():
    if not os.path.isfile(SETTINGS_PATH):
        return {}
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_settings(data):
    """원자적으로 덮어쓴다. 쓰다 죽어도 기존 파일이 깨지지 않는다."""
    temp = SETTINGS_PATH + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp, SETTINGS_PATH)


@routes.get("/fla/settings")
async def get_settings(request):
    return web.json_response({"settings": _read_settings()})


@routes.post("/fla/settings")
async def post_settings(request):
    """받은 키만 덮어쓴다(부분 갱신). 저장 실패해도 UI 는 계속 동작해야 한다."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    patch = body.get("settings")
    if not isinstance(patch, dict):
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    data = _read_settings()
    data.update(patch)
    try:
        _write_settings(data)
    except OSError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    return web.json_response({"ok": True, "settings": data})


def _inside_lora_folders(path):
    resolved = os.path.realpath(path)
    for root in folder_paths.get_folder_paths("loras"):
        try:
            if os.path.commonpath([resolved, os.path.realpath(root)]) == os.path.realpath(root):
                return resolved
        except ValueError:
            continue
    return None


def _preview_path(stem, configured=None):
    if isinstance(configured, str) and not os.path.isabs(configured):
        configured = os.path.join(os.path.dirname(stem), configured)
    candidates = ([configured] if isinstance(configured, str) else []) + [
        stem + ext for ext in (".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
                               ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm")
    ]
    for candidate in candidates:
        if not candidate or candidate.startswith(("http://", "https://")):
            continue
        resolved = _inside_lora_folders(candidate)
        if resolved and os.path.isfile(resolved):
            return resolved
    return None


@routes.get("/fla/themes")
async def get_themes(request):
    return web.json_response({"themes": presets.list_themes()})


@routes.get("/fla/presets")
async def get_presets(request):
    theme = request.query.get("theme", "")
    return web.json_response({"presets": presets.list_presets(theme)})


@routes.get("/fla/preset")
async def get_preset(request):
    theme = request.query.get("theme", "")
    name = request.query.get("name", "")
    return web.json_response(presets.load_preset(theme, name))


@routes.get("/fla/loras")
async def get_loras(request):
    return web.json_response({"loras": folder_paths.get_filename_list("loras")})


# Civitai nsfwLevel 비트마스크에서 R 등급(4) 이상이면 성인물로 본다.
# 미리보기 이미지 등급(preview_nsfw_level)이 있으면 그것을 우선한다.
ADULT_LEVEL = 4


def _is_adult(metadata):
    level = metadata.get("preview_nsfw_level")
    if isinstance(level, int):
        return level >= ADULT_LEVEL
    civitai = metadata.get("civitai") or {}
    level = civitai.get("nsfwLevel")
    if isinstance(level, int):
        return level >= ADULT_LEVEL
    return (civitai.get("model") or {}).get("nsfw") is True


def _trained_words(metadata):
    words = metadata.get("trained_words") or metadata.get("trigger_words")
    if not words:
        words = (metadata.get("civitai") or {}).get("trainedWords") or []
    if isinstance(words, str):
        words = [word.strip() for word in words.split(",")]
    return [word for word in words if isinstance(word, str) and word.strip()]


def _lora_info(name):
    full = folder_paths.get_full_path("loras", name)
    if full is None or not os.path.isfile(full):
        return None

    stem = os.path.splitext(full)[0]
    metadata_path = stem + ".metadata.json"
    metadata = {}
    if os.path.isfile(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        except (OSError, ValueError):
            pass

    preview_path = _preview_path(stem, metadata.get("preview_url"))
    preview = None
    if preview_path:
        # 대표 이미지를 바꾸면 URL 도 바뀌어야 브라우저가 새로 받아온다
        try:
            stamp = int(os.path.getmtime(preview_path))
        except OSError:
            stamp = 0
        preview = f"/fla/lora-preview?name={quote(name)}&v={stamp}"
    civitai = metadata.get("civitai") or {}

    return {
        "name": name,
        "folder": os.path.dirname(name).replace("\\", "/"),
        "title": metadata.get("model_name") or metadata.get("file_name") or os.path.splitext(os.path.basename(name))[0],
        "base_model": metadata.get("base_model") or civitai.get("baseModel") or "",
        "version": civitai.get("name") or "",
        "trained_words": _trained_words(metadata),
        "tags": metadata.get("tags") or (civitai.get("model") or {}).get("tags") or [],
        "favorite": metadata.get("favorite") is True,
        "adult": _is_adult(metadata),
        "size": metadata.get("size") or os.path.getsize(full),
        "preview": preview,
        "preview_type": "video" if preview_path and os.path.splitext(preview_path)[1].lower() in (".mp4", ".webm") else "image",
    }


@routes.get("/fla/lora-library")
async def get_lora_library(request):
    items = []
    for name in folder_paths.get_filename_list("loras"):
        info = _lora_info(name)
        if info is not None:
            items.append(info)
    return web.json_response({"items": items})


@routes.get("/fla/lora-detail")
async def get_lora_detail(request):
    """모델 상세 창에 필요한 정보만 추려서 준다.

    메타데이터 원본을 통째로 넘기면 수 MB 가 되기도 하므로
    화면에 쓰는 항목만 골라 담는다.
    """
    name = request.query.get("name", "")
    if name not in folder_paths.get_filename_list("loras"):
        return web.json_response({"ok": False, "error": "LoRA not found"}, status=404)

    full = folder_paths.get_full_path("loras", name)
    stem = os.path.splitext(full)[0]
    metadata = {}
    metadata_path = stem + ".metadata.json"
    if os.path.isfile(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        except (OSError, ValueError):
            metadata = {}

    civitai = metadata.get("civitai") or {}
    model = civitai.get("model") or {}
    stats = civitai.get("stats") or {}

    # 현재 대표 이미지(모델 탭에서 보여준다)
    preview_path = _preview_path(stem, metadata.get("preview_url"))
    preview = None
    preview_type = "image"
    if preview_path:
        try:
            stamp = int(os.path.getmtime(preview_path))
        except OSError:
            stamp = 0
        preview = f"/fla/lora-preview?name={quote(name)}&v={stamp}"
        if os.path.splitext(preview_path)[1].lower() in (".mp4", ".webm"):
            preview_type = "video"

    # 예시 이미지. 원격 URL 이라 등급을 함께 넘겨 프론트에서 가릴 수 있게 한다.
    images = []
    for image in (civitai.get("images") or []):
        url = image.get("url")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        meta = image.get("meta") or {}
        images.append({
            "url": url,
            "width": image.get("width"),
            "height": image.get("height"),
            "type": image.get("type") or "image",
            "nsfw_level": image.get("nsfwLevel") if isinstance(image.get("nsfwLevel"), int) else 0,
            "prompt": meta.get("prompt") or "",
            "negative": meta.get("negativePrompt") or "",
            "sampler": meta.get("sampler") or "",
            "steps": meta.get("steps"),
            "cfg": meta.get("cfgScale"),
            "seed": meta.get("seed"),
        })

    return web.json_response({
        "ok": True,
        "name": name,
        "title": metadata.get("model_name") or metadata.get("file_name") or os.path.basename(stem),
        "folder": os.path.dirname(name).replace("\\", "/"),
        "file_name": os.path.basename(full),
        "size": metadata.get("size") or os.path.getsize(full),
        "sha256": metadata.get("sha256") or "",
        "base_model": metadata.get("base_model") or civitai.get("baseModel") or "",
        "version": civitai.get("name") or "",
        "adult": _is_adult(metadata),
        "preview": preview,
        "preview_type": preview_type,
        "notes": metadata.get("notes") or "",
        "description": model.get("description") or civitai.get("description") or "",
        "trained_words": _trained_words(metadata),
        "tags": model.get("tags") or metadata.get("tags") or [],
        "creator": (civitai.get("creator") or {}).get("username") or "",
        "downloads": stats.get("downloadCount"),
        "likes": stats.get("thumbsUpCount"),
        "published": civitai.get("publishedAt") or civitai.get("createdAt") or "",
        "model_id": civitai.get("modelId"),
        "version_id": civitai.get("id"),
        "images": images,
    })


def _metadata_path(name):
    full = folder_paths.get_full_path("loras", name)
    if full is None:
        return None, None
    return full, os.path.splitext(full)[0] + ".metadata.json"


def _load_metadata(metadata_path):
    if not metadata_path or not os.path.isfile(metadata_path):
        return {}
    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_metadata(metadata_path, data):
    temp = metadata_path + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp, metadata_path)


# 대표 이미지로 쓸 수 있는 형식
PREVIEW_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm")
# 업로드 상한. 예시 영상이 몇 MB 씩 하므로 넉넉히 잡는다.
MAX_PREVIEW_BYTES = 64 * 1024 * 1024


def _write_preview(name, blob, ext):
    """대표 이미지를 <로라이름>.preview.<확장자> 로 저장하고 메타데이터를 가리킨다.

    확장자가 바뀔 수 있으므로(png -> mp4) 예전 preview 파일은 지운다.
    """
    full, metadata_path = _metadata_path(name)
    if full is None:
        return None, "LoRA not found"
    stem = os.path.splitext(full)[0]

    for old_ext in PREVIEW_EXTS:
        old_file = stem + ".preview" + old_ext
        if os.path.isfile(old_file):
            try:
                os.remove(old_file)
            except OSError:
                pass

    target = stem + ".preview" + ext
    try:
        with open(target, "wb") as f:
            f.write(blob)
    except OSError as e:
        return None, str(e)

    metadata = _load_metadata(metadata_path)
    metadata["preview_url"] = os.path.basename(target)
    try:
        _save_metadata(metadata_path, metadata)
    except OSError as e:
        return None, str(e)
    return target, None


@routes.post("/fla/lora-preview-set")
async def post_lora_preview_set(request):
    """예시 이미지 하나를 대표 이미지로 삼는다.

    프론트가 URL 만 넘기면 서버가 내려받는다. 브라우저에서 받아 올리면
    Civitai 의 교차 출처 정책에 걸릴 수 있어서 서버에서 처리한다.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    name = body.get("name", "")
    url = body.get("url", "")
    if name not in folder_paths.get_filename_list("loras"):
        return web.json_response({"ok": False, "error": "LoRA not found"}, status=404)
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return web.json_response({"ok": False, "error": "Bad url"}, status=400)

    ext = os.path.splitext(urlparse(url).path)[1].lower()
    if ext not in PREVIEW_EXTS:
        ext = ".png"

    try:
        session = getattr(PromptServer.instance, "client_session", None)
        if session is not None:
            async with session.get(url) as res:
                if res.status != 200:
                    return web.json_response({"ok": False, "error": f"HTTP {res.status}"}, status=502)
                blob = await res.read()
        else:
            import aiohttp
            async with aiohttp.ClientSession() as own:
                async with own.get(url) as res:
                    if res.status != 200:
                        return web.json_response({"ok": False, "error": f"HTTP {res.status}"}, status=502)
                    blob = await res.read()
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=502)

    if len(blob) > MAX_PREVIEW_BYTES:
        return web.json_response({"ok": False, "error": "Too large"}, status=413)

    target, error = _write_preview(name, blob, ext)
    if error:
        return web.json_response({"ok": False, "error": error}, status=500)
    return web.json_response({"ok": True, "stamp": int(time.time())})


@routes.post("/fla/lora-preview-upload")
async def post_lora_preview_upload(request):
    """사용자가 고른 파일을 대표 이미지로 저장한다."""
    try:
        reader = await request.multipart()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    name = None
    blob = None
    ext = ".png"
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "name":
            name = (await part.text()).strip()
        elif part.name == "file":
            candidate = os.path.splitext(part.filename or "")[1].lower()
            if candidate in PREVIEW_EXTS:
                ext = candidate
            blob = await part.read(decode=False)

    if not name or name not in folder_paths.get_filename_list("loras"):
        return web.json_response({"ok": False, "error": "LoRA not found"}, status=404)
    if not blob:
        return web.json_response({"ok": False, "error": "No file"}, status=400)
    if len(blob) > MAX_PREVIEW_BYTES:
        return web.json_response({"ok": False, "error": "Too large"}, status=413)

    target, error = _write_preview(name, blob, ext)
    if error:
        return web.json_response({"ok": False, "error": error}, status=500)
    return web.json_response({"ok": True, "stamp": int(time.time())})


@routes.post("/fla/lora-favorite")
async def post_lora_favorite(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    name = body.get("name", "")
    if name not in folder_paths.get_filename_list("loras"):
        return web.json_response({"ok": False, "error": "LoRA not found"}, status=404)
    full = folder_paths.get_full_path("loras", name)
    metadata_path = os.path.splitext(full)[0] + ".metadata.json"
    metadata = {}
    if os.path.isfile(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        except (OSError, ValueError):
            return web.json_response({"ok": False, "error": "Invalid metadata"}, status=400)
    metadata["favorite"] = body.get("favorite") is True
    temp = metadata_path + ".tmp"
    try:
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        os.replace(temp, metadata_path)
    except OSError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    return web.json_response({"ok": True, "favorite": metadata["favorite"]})


@routes.get("/fla/lora-preview")
async def get_lora_preview(request):
    name = request.query.get("name", "")
    if name not in folder_paths.get_filename_list("loras"):
        raise web.HTTPNotFound()
    full = folder_paths.get_full_path("loras", name)
    stem = os.path.splitext(full)[0]
    metadata_path = stem + ".metadata.json"
    configured = None
    if os.path.isfile(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                configured = json.load(f).get("preview_url")
        except (OSError, ValueError):
            pass
    preview = _preview_path(stem, configured)
    if preview:
        return web.FileResponse(preview)
    raise web.HTTPNotFound()


@routes.post("/fla/preset/save")
async def post_save(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    theme = body.get("theme", "")
    name = body.get("name", "")
    ok, info = presets.save_preset(theme, name, body.get("data", {}))
    if not ok:
        return web.json_response({"ok": False, "error": info}, status=400)
    return web.json_response({"ok": True, "presets": presets.list_presets(theme)})


@routes.post("/fla/preset/delete")
async def post_delete(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    theme = body.get("theme", "")
    name = body.get("name", "")
    ok, info = presets.delete_preset(theme, name)
    if not ok:
        return web.json_response({"ok": False, "error": info}, status=400)
    return web.json_response({"ok": True, "presets": presets.list_presets(theme)})


@routes.post("/fla/theme/create")
async def post_theme(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    if not presets.create_theme(body.get("theme", "")):
        return web.json_response({"ok": False, "error": "이름이 올바르지 않습니다."}, status=400)
    return web.json_response({"ok": True, "themes": presets.list_themes()})


@routes.post("/fla/preset/rename")
async def post_rename_preset(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    theme = body.get("theme", "")
    ok, info = presets.rename_preset(theme, body.get("old", ""), body.get("new", ""))
    if not ok:
        return web.json_response({"ok": False, "error": info}, status=400)
    return web.json_response({"ok": True, "presets": presets.list_presets(theme)})


@routes.post("/fla/theme/rename")
async def post_rename_theme(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    ok, info = presets.rename_theme(body.get("old", ""), body.get("new", ""))
    if not ok:
        return web.json_response({"ok": False, "error": info}, status=400)
    return web.json_response({"ok": True, "themes": presets.list_themes()})


@routes.get("/fla/resolutions")
async def get_resolutions(request):
    """평평한 목록(즐겨찾기 우선)과 원본 그룹 구조를 함께 돌려준다."""
    from . import resolutions
    return web.json_response({
        "items": resolutions.items(),
        "groups": resolutions.load(),
    })


@routes.post("/fla/resolutions/save")
async def post_resolutions_save(request):
    """편집기에서 목록 전체를 저장한다."""
    from . import resolutions
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)

    ok, info = resolutions.save(body.get("groups", {}))
    if not ok:
        return web.json_response({"ok": False, "error": info}, status=400)
    return web.json_response({
        "ok": True,
        "items": resolutions.items(),
        "groups": resolutions.load(),
    })


@routes.post("/fla/resolutions/reset")
async def post_resolutions_reset(request):
    """해상도 목록을 기본값으로 되돌린다."""
    from . import resolutions
    ok, info = resolutions.reset()
    if not ok:
        return web.json_response({"ok": False, "error": info}, status=400)
    return web.json_response({
        "ok": True,
        "items": resolutions.items(),
        "groups": resolutions.load(),
    })
