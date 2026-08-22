"""Civitai 업데이트 확인 — 가진 로라의 새 버전을 찾는다.

두 곳을 본다.

1. 같은 모델 페이지의 다른 버전 — 제작자가 같은 글에 v2 를 올린 경우.
2. 같은 제작자의 다른 모델 페이지 — 이름은 거의 같고 번호만 오른 경우
   ("MyLora v1" 글과 "MyLora v2" 글이 따로 있는 흔한 형태). 느리므로 선택이다.

거울상으로 "하위 모델 정리" 도 여기 있다. 가진 로라끼리만 견줘, 더 새 버전을
이미 받아 둔 옛 파일을 찾는다(지우면 자리가 남는다). 이쪽은 Civitai 를 부르지
않으므로 누르는 즉시 끝난다.

무엇을 "새 버전" 으로 볼지는 이름으로 정한다. 글자는 거의 같고 숫자만 커졌으면
새 버전이다. 반대로 HighNoise/LowNoise(H/L)처럼 갈래만 다른 것은 새 버전이
아니다 — Wan2.2 계열은 한 모델을 하이·로우 두 벌로 올리는데, 이것을 업글로
세면 목록이 쓸모없어진다.
"""

import asyncio
import difflib
import json
import os
import re
import time
from urllib.parse import urlencode

from aiohttp import web
from server import PromptServer

import folder_paths

from .api import _load_metadata, _metadata_path
from .civitai import (
    MAX_ERRORS,
    REQUEST_GAP,
    CivitaiError,
    NotFound,
    _api_key,
    _get_json,
    _installed_index,
    _trim_version,
    fetch_model,
    library_folders,
)

routes = PromptServer.instance.routes

# 결과는 파일에 남긴다. 창을 닫았다 열어도 지난 결과를 다시 보여주려고.
STATE_PATH = os.path.join(os.path.dirname(__file__), "civitai_updates.json")
# 제작자 한 명당 한 번에 훑는 모델 수(Civitai 상한이 100)
CREATOR_LIMIT = 100
# 카드에 곁들여 보여줄 다른 후보 수
MAX_OTHERS = 3


# ---------------------------------------------------------------- 이름 나누기

# 숫자 앞에 붙는 말. 버리고 숫자만 본다("v2" 와 "2" 를 같게 보려고).
VERSION_MARKS = {"v", "ver", "vers", "version", "rev"}

# 같은 모델의 다른 갈래. 새 버전이 아니라 쓰임이 다른 짝이다.
VARIANTS = {
    "high": "high", "highnoise": "high", "hn": "high", "hi": "high", "h": "high",
    "low": "low", "lownoise": "low", "ln": "low", "lo": "low", "l": "low",
    "t2v": "t2v", "i2v": "i2v", "v2v": "v2v", "t2i": "t2i", "i2i": "i2i",
}

# 있으나 없으나 같은 모델로 보는 꾸밈말.
FILLER = {
    "noise", "lora", "loras", "lycoris", "locon", "lokr", "safetensors", "ckpt",
    "final", "fixed", "fix", "beta", "alpha", "test", "epoch", "ep", "step", "steps",
    "rank", "dim", "fp16", "fp8", "bf16", "pruned", "the", "of", "for", "by",
}

# 글자가 이만큼 닮았으면 같은 이름으로 본다(오타·띄어쓰기 차이를 넘기려고).
NAME_RATIO = 0.87

_EXT = re.compile(r"\.(safetensors|ckpt|pt|pth|bin|sft)$", re.IGNORECASE)
_NUMBER = re.compile(r"^\d+(?:\.\d+)*$")
# 글자와 숫자가 섞인 갈래(t2v, i2v...). 글자·숫자를 떼기 전에 먼저 걷어낸다.
_MIXED_VARIANT = re.compile(r"(?<![a-z0-9])([tiv]2[vi])(?![a-z0-9])")


def parse_name(text):
    """이름을 글자·숫자·갈래로 나눈다.

    "MyLora Wan2.2 v3 HighNoise" -> ("mylora wan", (2, 2, 3), {"high"})
    """
    lower = _EXT.sub("", str(text or "").lower())
    lower = lower.replace("_", " ")
    # 소수점 버전(1.5)만 남기고 나머지 점은 칸으로 바꾼다
    lower = re.sub(r"\.(?!\d)", " ", lower)
    lower = re.sub(r"(?<!\d)\.", " ", lower)
    lower = re.sub(r"[^\w.]+", " ", lower, flags=re.UNICODE)

    variants = set()

    def take(match):
        variants.add(VARIANTS[match.group(1)])
        return " "

    lower = _MIXED_VARIANT.sub(take, lower)
    # 글자와 숫자가 붙어 있으면 뗀다: "wan2" -> "wan 2", "v3" -> "v 3"
    lower = re.sub(r"(?<=[a-z])(?=\d)", " ", lower)
    lower = re.sub(r"(?<=\d)(?=[a-z])", " ", lower)

    letters = []
    numbers = []
    for token in lower.split():
        token = token.strip(".")
        if not token or token in VERSION_MARKS or token in FILLER:
            continue
        if token in VARIANTS:
            variants.add(VARIANTS[token])
            continue
        if _NUMBER.match(token):
            numbers.extend(int(part) for part in token.split(".") if part != "")
            continue
        letters.append(token)
    return " ".join(letters), tuple(numbers), variants


def dotted(numbers):
    """숫자 묶음을 화면에 쓸 글자로. 비었으면 빈 문자열."""
    return ".".join(str(n) for n in numbers)


def same_words(a, b):
    """글자 부분이 사실상 같은지."""
    if a == b:
        return True
    if not a or not b:
        return False
    if min(len(a), len(b)) < 4:
        return False  # 짧은 이름은 조금만 달라도 다른 모델이다
    # 가진 로라를 모두 짝지어 보면 이 비교가 수천 번 돈다. 값싼 것부터 거른다.
    matcher = difflib.SequenceMatcher(None, a, b)
    if matcher.real_quick_ratio() < NAME_RATIO or matcher.quick_ratio() < NAME_RATIO:
        return False
    return matcher.ratio() >= NAME_RATIO


def newer_numbers(new, old):
    """숫자만 보고 올랐는지. 자릿수가 다르면 0 을 채워 견준다."""
    size = max(len(new), len(old))
    return new + (0,) * (size - len(new)) > old + (0,) * (size - len(old))


def compare_parsed(a, b):
    """이미 나눠 둔 이름끼리 견준다. b 가 a 의 새 버전이면 (옛 번호, 새 번호).

    이름을 나누는 일이 제일 무겁다. 가진 로라를 모두 짝지어 보는 쪽에서는
    한 번만 나눠 두고 이 함수로 견준다.
    """
    a_letters, a_numbers, a_variants = a
    b_letters, b_numbers, b_variants = b
    # 하이노이즈/로우노이즈처럼 갈래가 다르면 업글이 아니다
    if a_variants != b_variants:
        return None
    if not same_words(a_letters, b_letters):
        return None
    if not newer_numbers(b_numbers, a_numbers):
        return None
    # 앞자리가 같으면 떼고 보여준다. 이름에 기반 모델 번호까지 섞여 있으면
    # "2.1.2.2.1022 -> 2.1.2.2.1030" 처럼 읽기 나쁜 글자가 되기 때문이다.
    same = 0
    while (same < min(len(a_numbers), len(b_numbers))
           and a_numbers[same] == b_numbers[same]):
        same += 1
    return dotted(a_numbers[same:]), dotted(b_numbers[same:])


def upgrade_of(current, candidate):
    """candidate 가 current 의 새 버전이면 (옛 번호, 새 번호), 아니면 None."""
    return compare_parsed(parse_name(current), parse_name(candidate))


def variant_of(text):
    """이름에서 갈래만 뽑는다(하이·로우 짝을 맞춰 고르는 데 쓴다)."""
    return parse_name(text)[2]


# ---------------------------------------------------------------- 저장

_state = None


def _read_state():
    global _state
    if _state is not None:
        return _state
    data = {}
    if os.path.isfile(STATE_PATH):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                data = loaded
        except (OSError, ValueError):
            data = {}
    _state = {
        "items": data.get("items") if isinstance(data.get("items"), list) else [],
        "ignored": data.get("ignored") if isinstance(data.get("ignored"), list) else [],
        # 하위 모델 정리에서 "그대로 둠" 으로 찍은 것
        "kept": data.get("kept") if isinstance(data.get("kept"), list) else [],
        "checked_at": data.get("checked_at") or 0,
        "deep": data.get("deep") is True,
    }
    return _state


def _write_state():
    state = _read_state()
    temp = STATE_PATH + ".tmp"
    try:
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
        os.replace(temp, STATE_PATH)
    except OSError:
        pass  # 결과를 못 남겨도 이번 화면은 멀쩡하다


def ignore_key(item):
    """무시 목록에 쓰는 열쇠. 로라 파일과 새 버전을 묶는다."""
    return f"{item.get('name', '')}|{(item.get('latest') or {}).get('id', '')}"


# ---------------------------------------------------------------- 진행 상태

_progress = {
    "running": False,
    "total": 0,
    "done": 0,
    "found": 0,
    "skipped": 0,
    "failed": 0,
    "current": "",
    "cancelled": False,
    "errors": [],
    "finished_at": 0,
    "deep": False,
}
_task = None


def _reset_progress(total, deep):
    _progress.update({
        "running": True,
        "total": total,
        "done": 0,
        "found": 0,
        "skipped": 0,
        "failed": 0,
        "current": "",
        "cancelled": False,
        "errors": [],
        "finished_at": 0,
        "deep": deep,
    })


def _targets():
    """확인할 로라. Civitai 정보가 있는 것만 본다(없으면 견줄 대상이 없다)."""
    names = []
    for name in folder_paths.get_filename_list("loras"):
        _, metadata_path = _metadata_path(name)
        if metadata_path is None:
            continue
        metadata = _load_metadata(metadata_path)
        model_id = metadata.get("model_id") or (metadata.get("civitai") or {}).get("modelId")
        if model_id:
            names.append(name)
    return names


# ---------------------------------------------------------------- 한 개 확인


async def _creator_models(username, api_key, cache):
    """같은 제작자의 로라 목록. 한 번 받아 두고 돌려 쓴다."""
    if not username:
        return []
    if username in cache:
        return cache[username]
    params = {"types": "LORA", "limit": CREATOR_LIMIT, "username": username, "sort": "Newest"}
    try:
        data = await _get_json(f"/models?{urlencode(params)}", api_key)
        items = data.get("items") or []
    except CivitaiError:
        items = []  # 제작자가 사라졌거나 막혔다. 같은 글의 버전만으로 본다.
    cache[username] = items
    return items


def _pick_version(model, variant):
    """모델에서 고를 버전. 갈래(하이·로우)가 같은 것 중 가장 최신."""
    for version in model.get("modelVersions") or []:
        # Civitai 는 최신 버전을 앞에 준다. 갈래가 맞는 첫 번째가 최신이다.
        if variant_of(version.get("name") or "") == variant:
            return version
    return None


async def _check_one(name, api_key, deep, model_cache, creator_cache, hashes, names, folders):
    """로라 하나. 새 버전이 있으면 카드 하나 분량을 돌려준다."""
    _, metadata_path = _metadata_path(name)
    metadata = _load_metadata(metadata_path)
    block = metadata.get("civitai") or {}
    model_id = metadata.get("model_id") or block.get("modelId")
    version_id = metadata.get("version_id") or block.get("id")
    if not model_id:
        return None

    model = model_cache.get(model_id)
    if model is None:
        model = await fetch_model(model_id, api_key)
        model_cache[model_id] = model

    versions = model.get("modelVersions") or []
    current = next((v for v in versions if v.get("id") == version_id), None)
    current_name = (current or block).get("name") or ""
    model_name = model.get("name") or metadata.get("model_name") or ""
    # 갈래는 버전 이름에 적히는 게 보통이지만, 파일 이름에만 남는 경우도 있다
    variant = variant_of(current_name) or variant_of(os.path.basename(name))

    # 후보 모으기
    found = []

    # 1) 같은 글의 다른 버전
    for version in versions:
        if version.get("id") == version_id:
            continue
        step = upgrade_of(current_name, version.get("name") or "")
        if step is None:
            continue
        found.append(("version", version, model, step))

    # 2) 같은 제작자의 다른 글
    if deep:
        creator = (model.get("creator") or {}).get("username") or ""
        for other in await _creator_models(creator, api_key, creator_cache):
            if other.get("id") == model_id:
                continue
            step = upgrade_of(model_name, other.get("name") or "")
            if step is None:
                continue
            version = _pick_version(other, variant)
            if version is None:
                continue  # 짝이 맞는 갈래가 없다(하이만 올라온 글 등)
            found.append(("model", version, other, step))

    if not found:
        return None

    # 번호가 가장 높은 것이 앞으로. 같으면 나중에 올라온 것.
    found.sort(key=lambda e: (parse_name(e[3][1])[1], e[1].get("id") or 0), reverse=True)

    cards = []
    for kind, version, owner, step in found:
        card = _trim_version(version, hashes, names, owner, folders, max_images=1)
        card["model_id"] = owner.get("id")
        card["model_name"] = owner.get("name") or ""
        card["kind"] = kind
        card["from_ver"], card["to_ver"] = step
        cards.append(card)

    # 이미 받아 둔 것은 업글로 세지 않는다(받고 나면 목록에서 사라진다)
    fresh = [card for card in cards if not card["installed"]]
    if not fresh:
        return None

    return {
        "name": name,
        "file_name": os.path.basename(name),
        "folder": os.path.dirname(name).replace("\\", "/"),
        "title": model_name,
        "variant": "|".join(sorted(variant)),
        "current": {
            "model_id": model_id,
            "version_id": version_id,
            "version_name": current_name,
            "base_model": (current or {}).get("baseModel") or metadata.get("base_model") or "",
            "published": (current or {}).get("publishedAt") or (current or {}).get("createdAt") or "",
        },
        "latest": fresh[0],
        "others": [
            {"model_id": c["model_id"], "version_id": c["id"], "name": c["model_name"],
             "version_name": c["name"], "to_ver": c["to_ver"], "kind": c["kind"]}
            for c in fresh[1:1 + MAX_OTHERS]
        ],
        "found_at": int(time.time()),
    }


async def _scan(names, api_key, deep):
    state = _read_state()
    model_cache = {}
    creator_cache = {}
    hashes, installed_names = _installed_index()
    folders = library_folders()
    items = []
    try:
        for name in names:
            if _progress["cancelled"]:
                break
            _progress["current"] = name
            try:
                item = await _check_one(name, api_key, deep, model_cache, creator_cache,
                                        hashes, installed_names, folders)
                if item:
                    items.append(item)
                    _progress["found"] += 1
            except NotFound:
                _progress["skipped"] += 1  # Civitai 에서 내려간 모델
            except CivitaiError as e:
                _progress["failed"] += 1
                if len(_progress["errors"]) < MAX_ERRORS:
                    _progress["errors"].append({"name": name, "error": str(e)})
            except Exception as e:  # 하나 때문에 전체가 멈추지 않게
                _progress["failed"] += 1
                if len(_progress["errors"]) < MAX_ERRORS:
                    _progress["errors"].append({"name": name, "error": repr(e)})
            _progress["done"] += 1
            await asyncio.sleep(REQUEST_GAP)
    finally:
        _progress["running"] = False
        _progress["current"] = ""
        _progress["finished_at"] = int(time.time())
        # 중간에 멈췄어도 거기까지 찾은 것은 남긴다
        state["items"] = items
        state["checked_at"] = int(time.time())
        state["deep"] = deep
        _write_state()


# ---------------------------------------------------------------- 라우트


def _public(with_items=True):
    state = _read_state()
    ignored = set(state["ignored"])
    body = {
        "ok": True,
        "progress": dict(_progress),
        "checked_at": state["checked_at"],
        "deep": state["deep"],
    }
    if with_items:
        items = []
        for item in state["items"]:
            copy = dict(item)
            copy["key"] = ignore_key(item)
            copy["ignored"] = copy["key"] in ignored
            items.append(copy)
        body["items"] = items
        body["candidates"] = len(_targets())
    return body


@routes.get("/fla/civitai/updates")
async def get_civitai_updates(request):
    return web.json_response(_public())


@routes.get("/fla/civitai/updates/status")
async def get_civitai_updates_status(request):
    """진행률만. 도는 동안 자주 물어보는 쪽이라 목록은 빼고 준다."""
    return web.json_response(_public(with_items=False))


@routes.post("/fla/civitai/updates/scan")
async def post_civitai_updates_scan(request):
    global _task
    if _progress["running"]:
        return web.json_response(
            {"ok": False, "error": "이미 확인 중", "progress": dict(_progress)}, status=409)

    try:
        body = await request.json()
    except Exception:
        body = {}
    deep = body.get("deep") is not False

    names = _targets()
    _reset_progress(len(names), deep)
    if not names:
        _progress["running"] = False
        _progress["finished_at"] = int(time.time())
        return web.json_response(_public())

    _task = asyncio.create_task(_scan(names, _api_key(), deep))
    return web.json_response(_public(with_items=False))


@routes.post("/fla/civitai/updates/cancel")
async def post_civitai_updates_cancel(request):
    # 지금 보고 있는 하나는 마치고 멈춘다
    _progress["cancelled"] = True
    return web.json_response(_public(with_items=False))


@routes.post("/fla/civitai/updates/ignore")
async def post_civitai_updates_ignore(request):
    """이건 업글이 아니라고 표시한다. 다시 확인해도 접힌 채로 남는다."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    key = body.get("key")
    if not isinstance(key, str) or not key:
        return web.json_response({"ok": False, "error": "Bad key"}, status=400)

    state = _read_state()
    ignore = body.get("ignore") is not False
    state["ignored"] = [k for k in state["ignored"] if k != key]
    if ignore:
        state["ignored"].append(key)
    _write_state()
    return web.json_response({"ok": True, "ignored": ignore})


@routes.post("/fla/civitai/updates/clear")
async def post_civitai_updates_clear(request):
    """찾은 목록을 지운다(다시 확인하기 전까지 빈 화면)."""
    state = _read_state()
    state["items"] = []
    state["checked_at"] = 0
    _write_state()
    return web.json_response(_public())


# ---------------------------------------------------------------- 하위 모델 정리
#
# 업데이트 확인의 거울상이다. 새 버전을 받아도 옛 파일은 그대로 남아 자리만
# 차지한다. 가진 것끼리만 견주므로 Civitai 를 부르지 않고 바로 끝난다.
#
# 지우는 일은 하지 않는다. 화면이 /fla/lora-delete 로 하나씩 지운다
# (되돌릴 수 없는 일이라 한 번 더 물어본 뒤에).


def _entries():
    """가진 로라를 견줄 수 있는 꼴로 모은다. 이름은 한 번만 나눈다."""
    out = []
    for name in folder_paths.get_filename_list("loras"):
        full, metadata_path = _metadata_path(name)
        if full is None:
            continue
        metadata = _load_metadata(metadata_path)
        block = metadata.get("civitai") or {}
        stem = os.path.splitext(os.path.basename(name))[0]
        title = metadata.get("model_name") or (block.get("model") or {}).get("name") or ""
        version = block.get("name") or ""
        # 견줄 이름 — 정보가 있으면 모델 이름 + 버전 이름, 없으면 파일 이름
        label = " ".join(part for part in ((title or stem), version) if part)
        try:
            size = os.path.getsize(full)
        except OSError:
            size = metadata.get("size") or 0
        out.append({
            "name": name,
            "file_name": os.path.basename(name),
            "folder": os.path.dirname(name).replace("\\", "/"),
            "title": title or stem,
            "version_name": version,
            "base_model": metadata.get("base_model") or block.get("baseModel") or "",
            "model_id": metadata.get("model_id") or block.get("modelId"),
            "version_id": metadata.get("version_id") or block.get("id"),
            "size": size,
            "parsed": parse_name(label),
        })
    return out


CARD_FIELDS = ("name", "file_name", "folder", "title", "version_name",
               "base_model", "model_id", "version_id", "size")


def _card(entry, extra=None):
    """화면에 넘길 만큼만 추린다(나눠 둔 이름은 서버에서만 쓴다)."""
    card = {key: entry[key] for key in CARD_FIELDS}
    if extra:
        card.update(extra)
    return card


def older_items():
    """더 새 버전을 이미 가진 파일들. 새 것부터 앞에 달아 준다."""
    entries = _entries()
    kept = set(_read_state()["kept"])
    items = []
    for old in entries:
        newer = []
        for other in entries:
            if other is old:
                continue
            step = compare_parsed(old["parsed"], other["parsed"])
            if step is None:
                continue
            newer.append(_card(other, {
                "from_ver": step[0],
                "to_ver": step[1],
                "_numbers": other["parsed"][1],
            }))
        if not newer:
            continue
        newer.sort(key=lambda card: card["_numbers"], reverse=True)
        for card in newer:
            card.pop("_numbers", None)
        items.append(_card(old, {
            "key": old["name"],
            "ignored": old["name"] in kept,
            "newer": newer,
        }))
    # 자리를 많이 차지하는 것부터. 그대로 두기로 한 것은 뒤로 민다.
    items.sort(key=lambda item: (item["ignored"], -item["size"]))
    return items


@routes.get("/fla/civitai/older")
async def get_civitai_older(request):
    items = older_items()
    return web.json_response({
        "ok": True,
        "items": items,
        # 지우면 남는 자리(그대로 두기로 한 것은 빼고)
        "free": sum(item["size"] for item in items if not item["ignored"]),
        "library": len(folder_paths.get_filename_list("loras")),
    })


@routes.post("/fla/civitai/older/keep")
async def post_civitai_older_keep(request):
    """이 옛 파일은 그대로 두겠다고 표시한다. 다시 확인해도 접힌 채로 남는다."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Bad request"}, status=400)
    key = body.get("key")
    if not isinstance(key, str) or not key:
        return web.json_response({"ok": False, "error": "Bad key"}, status=400)

    state = _read_state()
    keep = body.get("keep") is not False
    state["kept"] = [k for k in state["kept"] if k != key]
    if keep:
        state["kept"].append(key)
    _write_state()
    return web.json_response({"ok": True, "kept": keep})
