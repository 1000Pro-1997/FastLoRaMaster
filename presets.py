"""프리셋 저장소.

presets/<테마>/<프리셋>.json 구조로 저장한다.
프리셋 하나에 프롬프트와 로라 목록이 함께 들어간다.
"""

import json
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRESET_ROOT = os.path.join(BASE_DIR, "presets")

NONE = "-"


def _safe_name(name):
    """경로 탈출과 파일명에 쓸 수 없는 문자를 막는다."""
    name = (name or "").strip()
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r'[<>:"|?*\x00-\x1f]', "", name)
    name = name.strip(". ")
    if name in ("", ".", ".."):
        return ""
    return name


def ensure_root():
    """사용자 프리셋 폴더를 준비한다. 프리셋은 사용자가 직접 만든다."""
    os.makedirs(PRESET_ROOT, exist_ok=True)


def list_themes():
    """테마(폴더) 목록. 없으면 빈 리스트."""
    ensure_root()
    try:
        names = [d for d in os.listdir(PRESET_ROOT)
                 if os.path.isdir(os.path.join(PRESET_ROOT, d))]
    except OSError:
        return []
    return sorted(names)


def theme_dir(theme):
    theme = _safe_name(theme)
    if not theme:
        return None
    return os.path.join(PRESET_ROOT, theme)


def create_theme(theme):
    d = theme_dir(theme)
    if d is None:
        return False
    os.makedirs(d, exist_ok=True)
    return True


def list_presets(theme):
    """해당 테마의 프리셋 이름 목록(확장자 제외)."""
    d = theme_dir(theme)
    if d is None or not os.path.isdir(d):
        return []
    names = [f[:-5] for f in os.listdir(d) if f.lower().endswith(".json")]
    return sorted(names)


def preset_path(theme, name):
    d = theme_dir(theme)
    name = _safe_name(name)
    if d is None or not name:
        return None
    return os.path.join(d, name + ".json")


def empty_preset():
    return {"prompt": "", "loras": []}


def load_preset(theme, name):
    """프리셋을 읽는다. 없거나 깨졌으면 빈 프리셋을 돌려준다."""
    path = preset_path(theme, name)
    if path is None or not os.path.isfile(path):
        return empty_preset()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return empty_preset()

    return normalize(data)


def normalize(data):
    """외부에서 온 데이터를 신뢰할 수 있는 형태로 정리한다."""
    if not isinstance(data, dict):
        return empty_preset()

    prompt = data.get("prompt", "")
    if not isinstance(prompt, str):
        prompt = ""

    loras = []
    raw = data.get("loras")
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            path = item.get("path") or item.get("name") or ""
            if not isinstance(path, str) or not path.strip():
                continue
            try:
                strength = float(item.get("strength", 1.0))
            except (TypeError, ValueError):
                strength = 1.0
            strength = max(-10.0, min(10.0, strength))
            loras.append({
                "path": path.strip(),
                "strength": strength,
                "enabled": bool(item.get("enabled", True)),
            })

    return {"prompt": prompt, "loras": loras}


def save_preset(theme, name, data):
    """프리셋을 저장한다. 테마 폴더가 없으면 만든다."""
    if not create_theme(theme):
        return False, "Invalid theme name."
    path = preset_path(theme, name)
    if path is None:
        return False, "Invalid preset name."

    payload = normalize(data)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except OSError as e:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False, str(e)
    return True, path


def prune_theme(theme):
    """프리셋이 하나도 없는 테마 폴더를 지운다. 지웠으면 True."""
    d = theme_dir(theme)
    if d is None or not os.path.isdir(d):
        return False
    if list_presets(theme):
        return False
    try:
        # 폴더가 정말 비었을 때만 지운다. 다른 파일이 있으면 남겨둔다.
        os.rmdir(d)
    except OSError:
        return False
    return True


def delete_preset(theme, name):
    """프리셋을 지운다. 그 테마의 마지막 프리셋이었으면 테마도 함께 지운다."""
    path = preset_path(theme, name)
    if path is None:
        return False, "Invalid name."
    if not os.path.isfile(path):
        return False, "Preset not found."
    try:
        os.remove(path)
    except OSError as e:
        return False, str(e)
    prune_theme(theme)
    return True, path


def rename_preset(theme, old, new):
    """프리셋 이름을 바꾼다."""
    src = preset_path(theme, old)
    dst = preset_path(theme, new)
    if src is None or dst is None:
        return False, "Invalid name."
    if not os.path.isfile(src):
        return False, "Source preset not found."
    if os.path.abspath(src) == os.path.abspath(dst):
        return True, dst
    if os.path.exists(dst):
        return False, "A preset with that name already exists."
    try:
        os.replace(src, dst)
    except OSError as e:
        return False, str(e)
    return True, dst


def rename_theme(old, new):
    """테마(폴더) 이름을 바꾼다."""
    src = theme_dir(old)
    dst = theme_dir(new)
    if src is None or dst is None:
        return False, "Invalid name."
    if not os.path.isdir(src):
        return False, "Source theme not found."
    if os.path.abspath(src) == os.path.abspath(dst):
        return True, dst
    if os.path.exists(dst):
        return False, "A theme with that name already exists."
    try:
        os.rename(src, dst)
    except OSError as e:
        return False, str(e)
    return True, dst
