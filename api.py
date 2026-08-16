"""프론트엔드가 호출하는 프리셋 API."""

import json
import os
from urllib.parse import quote

from aiohttp import web
from server import PromptServer

import folder_paths

from . import presets

routes = PromptServer.instance.routes


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
    preview = f"/fla/lora-preview?name={quote(name)}" if preview_path else None
    civitai = metadata.get("civitai") or {}

    return {
        "name": name,
        "folder": os.path.dirname(name).replace("\\", "/"),
        "title": metadata.get("model_name") or metadata.get("file_name") or os.path.splitext(os.path.basename(name))[0],
        "base_model": metadata.get("base_model") or civitai.get("baseModel") or "",
        "version": civitai.get("name") or "",
        "tags": metadata.get("tags") or (civitai.get("model") or {}).get("tags") or [],
        "favorite": metadata.get("favorite") is True,
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
