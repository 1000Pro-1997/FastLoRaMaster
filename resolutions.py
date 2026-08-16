"""해상도 목록 저장소.

resolutions.json 이 사용자 파일이고, 없으면 resolutions_default.json 을 복사한다.
항목은 {w, h, favorite} 만 담고 라벨은 자동으로 만든다.
"""

import json
import os
from math import gcd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USER_PATH = os.path.join(BASE_DIR, "resolutions.json")
DEFAULT_PATH = os.path.join(BASE_DIR, "resolutions_default.json")


def ratio_text(w, h):
    """1024x1024 → "1:1". 약분이 안 되면 소수로."""
    if w <= 0 or h <= 0:
        return "-"
    g = gcd(int(w), int(h))
    rw, rh = int(w) // g, int(h) // g
    if rw <= 64 and rh <= 64:
        return f"{rw}:{rh}"
    return f"{w / h:.2f}:1"


def make_label(w, h):
    """항목 라벨을 자동으로 만든다. 1216x832 → "1216x832 (19:13)" """
    return f"{w}x{h} ({ratio_text(w, h)})"


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def ensure_user_file():
    """사용자 파일이 없으면 기본 파일을 복사한다."""
    if os.path.isfile(USER_PATH):
        return
    data = _read(DEFAULT_PATH)
    if data is None:
        return
    _write(data)


def _write(data):
    tmp = USER_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, USER_PATH)
    except OSError:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False
    return True


def normalize(data):
    """외부에서 온 데이터를 신뢰할 수 있는 형태로 정리한다."""
    out = {}
    if not isinstance(data, dict):
        return out
    for group, items in data.items():
        if not isinstance(items, list):
            continue
        clean = []
        for it in items:
            if not isinstance(it, dict):
                continue
            try:
                w = int(it.get("w", 0))
                h = int(it.get("h", 0))
            except (TypeError, ValueError):
                continue
            if w <= 0 or h <= 0:
                continue
            w = max(64, min(8192, w))
            h = max(64, min(8192, h))
            clean.append({
                "w": w,
                "h": h,
                "favorite": bool(it.get("favorite", False)),
            })
        if clean:
            out[str(group)] = clean
    return out


def load():
    """{그룹명: [{w, h, favorite}, ...]}"""
    ensure_user_file()
    return normalize(_read(USER_PATH) or _read(DEFAULT_PATH) or {})


def reset():
    """사용자 파일을 지우고 기본 목록으로 되돌린다."""
    data = _read(DEFAULT_PATH)
    if data is None:
        return False, "Default list file not found."
    try:
        if os.path.isfile(USER_PATH):
            os.remove(USER_PATH)
    except OSError as e:
        return False, str(e)
    ensure_user_file()
    return True, USER_PATH


def save(data):
    """목록 전체를 덮어쓴다."""
    payload = normalize(data)
    if not payload:
        return False, "Refusing to save an empty list."
    if not _write(payload):
        return False, "Could not write the file."
    return True, USER_PATH


def items():
    """UI 가 쓰기 좋은 평평한 목록. 즐겨찾기가 먼저 온다."""
    data = load()
    favs = []
    rest = []
    for group, arr in data.items():
        for it in arr:
            entry = {
                "group": group,
                "w": it["w"],
                "h": it["h"],
                "favorite": it["favorite"],
                "name": make_label(it["w"], it["h"]),
                "label": f"{group} / {make_label(it['w'], it['h'])}",
            }
            (favs if it["favorite"] else rest).append(entry)
    return favs + rest


def find_name(w, h):
    """크기와 일치하는 항목의 라벨. 없으면 ""."""
    for it in items():
        if it["w"] == w and it["h"] == h:
            return it["label"]
    return ""
