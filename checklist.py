"""체크리스트 항목 저장소.

FLAChecklist 노드가 들고 다니는 항목 목록을 다루는 순수 함수 모음이다.
프리셋과 달리 파일에 저장하지 않는다. 항목은 노드 위젯(JSON 문자열)에만
들어 있고 워크플로와 함께 저장된다. 노드마다 체크리스트가 다르기 때문이다.
"""

import json


def empty_item():
    return {"title": "", "prompt": "", "loras": [], "enabled": False}


def normalize_lora(raw):
    """로라 한 개를 신뢰할 수 있는 형태로 정리한다. 못 쓰면 None."""
    if not isinstance(raw, dict):
        return None
    path = raw.get("path") or raw.get("name") or ""
    if not isinstance(path, str) or not path.strip():
        return None
    try:
        strength = float(raw.get("strength", 1.0))
    except (TypeError, ValueError):
        strength = 1.0
    # presets.normalize 와 같은 범위로 맞춘다.
    strength = max(-10.0, min(10.0, strength))
    return {
        "path": path.strip(),
        "strength": strength,
        "enabled": bool(raw.get("enabled", True)),
    }


def normalize_item(raw):
    """항목 하나를 정리한다. 제목과 프롬프트가 모두 비면 None."""
    if not isinstance(raw, dict):
        return None

    title = raw.get("title", "")
    if not isinstance(title, str):
        title = ""

    prompt = raw.get("prompt", "")
    if not isinstance(prompt, str):
        prompt = ""

    loras = []
    for entry in (raw.get("loras") if isinstance(raw.get("loras"), list) else []):
        lora = normalize_lora(entry)
        if lora is not None:
            loras.append(lora)

    # 제목만 있고 내용이 없는 항목도 자리표시로 남겨둔다.
    # 셋 다 비었을 때만 버린다.
    if not title.strip() and not prompt.strip() and not loras:
        return None

    return {
        "title": title,
        "prompt": prompt,
        "loras": loras,
        "enabled": bool(raw.get("enabled", False)),
    }


def normalize(data):
    """항목 목록 전체를 정리한다."""
    if not isinstance(data, list):
        return []
    items = []
    for raw in data:
        item = normalize_item(raw)
        if item is not None:
            items.append(item)
    return items


def parse(text):
    """위젯에 담긴 JSON 문자열을 항목 목록으로 바꾼다. 깨졌으면 빈 목록."""
    if not isinstance(text, str) or not text.strip():
        return []
    try:
        data = json.loads(text)
    except ValueError:
        return []
    return normalize(data)


def compose(items, prompt_in=None, delimiter=", "):
    """켜진 항목의 프롬프트를 순서대로 잇는다.

    prompt_in 이 있으면 맨 앞에 둔다. 빈 프롬프트는 건너뛴다.
    """
    parts = []
    if isinstance(prompt_in, str) and prompt_in.strip():
        parts.append(prompt_in.strip())
    for item in items:
        if not item["enabled"]:
            continue
        text = item["prompt"].strip()
        if text:
            parts.append(text)
    return delimiter.join(parts)


def active_loras(items):
    """켜진 항목들이 요구하는 로라를 순서대로 모은다.

    같은 로라가 여러 항목에 있으면 처음 것만 쓴다. 두 번 얹으면
    강도가 곱으로 겹쳐서 의도와 달라지기 때문이다.
    """
    out = []
    seen = set()
    for item in items:
        if not item["enabled"]:
            continue
        for lora in item["loras"]:
            if not lora["enabled"]:
                continue
            if lora["path"] in seen:
                continue
            seen.add(lora["path"])
            out.append(lora)
    return out
