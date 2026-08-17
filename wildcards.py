"""와일드카드 파일을 찾아서 목록으로 만든다.

ComfyUI 폴더 아래에 흩어져 있는 와일드카드 폴더를 모은다.
폴더 이름은 사람마다 제각각이라("wildcards", "wild cards", "WildCard" ...)
대소문자·공백·구분자를 지우고 비교한다.
"""

import json
import os
import re
import time

import folder_paths


# 폴더 이름을 비교할 때 쓰는 표준형. 두 이름이 같은 값으로 줄어들면 같은 폴더로 본다.
_ALIASES = {"wildcard", "wildcards"}

# 와일드카드로 읽어들일 확장자. 한 줄에 하나씩 들어 있는 텍스트 파일이다.
_EXTENSIONS = (".txt", ".yaml", ".yml")

# 폴더를 뒤지는 최대 깊이. 너무 깊이 들어가면 느려지기만 한다.
_MAX_DEPTH = 6

# 들어가 봐야 소용없는 폴더들. 모델·캐시·저장소 안에는 와일드카드가 없다.
_SKIP_DIRS = {
    ".git", ".github", "__pycache__", "node_modules", ".venv", "venv",
    "models", "output", "temp", "input", "web", "js", "dist", "build",
    ".idea", ".vscode", "site-packages",
    # 문서·테스트 안의 와일드카드는 예제일 뿐 실제로 쓰이지 않는다
    "docs", "doc", "tests", "test", "examples", "example_workflows",
}

# 이름이 이렇게 시작하는 폴더는 통째로 건너뛴다.
# 밑줄로 시작하는 폴더는 보통 격리·백업용이라 실제로 쓰이지 않는다.
_SKIP_PREFIXES = (".", "_")

# 즐겨찾기는 파일 옆에 두지 않고 한곳에 모은다.
# 와일드카드 폴더가 남의 커스텀 노드 안에 있을 수 있어서다(업데이트로 날아간다).
FAVORITES_PATH = os.path.join(os.path.dirname(__file__), "wildcard_favorites.json")


def _normalize(name):
    """비교용 표준형. 대소문자·공백·밑줄·붙임표를 지운다."""
    return re.sub(r"[\s_\-.]+", "", name).lower()


def _is_wildcard_dir(name):
    return _normalize(name) in _ALIASES


def comfy_root():
    """ComfyUI 최상위 폴더. folder_paths 가 아는 경로에서 거슬러 올라간다."""
    base = getattr(folder_paths, "base_path", None)
    if isinstance(base, str) and os.path.isdir(base):
        return os.path.realpath(base)
    # base_path 가 없는 옛 버전 대비: 이 파일 기준 custom_nodes/<우리> 의 두 단계 위
    return os.path.realpath(os.path.join(os.path.dirname(__file__), "..", ".."))


# 폴더를 훑은 결과를 잠깐 기억한다. 프롬프트 한 줄에 와일드카드가 여러 개 있으면
# 그때마다 디스크를 다시 뒤지게 되는데, 그 사이 폴더가 바뀔 일은 거의 없다.
_ROOTS_CACHE = None
_ROOTS_STAMP = 0.0
_ROOTS_TTL = 5.0

# 이름 -> 경로 표도 같이 기억한다
_INDEX_CACHE = None
_INDEX_STAMP = 0.0


def forget_roots():
    """폴더 목록을 다시 찾게 한다. 새 폴더를 만든 직후에 쓴다."""
    global _ROOTS_CACHE, _INDEX_CACHE
    _ROOTS_CACHE = None
    _INDEX_CACHE = None


def find_roots():
    """와일드카드 폴더로 보이는 곳을 모두 찾는다.

    ComfyUI 폴더부터 훑되 _MAX_DEPTH 까지만 내려간다.
    와일드카드 폴더를 찾으면 그 안은 더 뒤지지 않는다(그 아래는 내용물이다).
    """
    global _ROOTS_CACHE, _ROOTS_STAMP
    now = time.monotonic()
    if _ROOTS_CACHE is not None and now - _ROOTS_STAMP < _ROOTS_TTL:
        return _ROOTS_CACHE

    root = comfy_root()
    found = []
    seen = set()

    def walk(path, depth):
        if depth > _MAX_DEPTH:
            return
        try:
            entries = list(os.scandir(path))
        except OSError:
            return
        for entry in entries:
            if not entry.is_dir(follow_symlinks=False):
                continue
            name = entry.name
            if _is_wildcard_dir(name):
                real = os.path.realpath(entry.path)
                if real not in seen:
                    seen.add(real)
                    found.append(real)
                # 와일드카드 폴더 안은 내용물이므로 더 내려가지 않는다
                continue
            if name.startswith(_SKIP_PREFIXES) or name.lower() in _SKIP_DIRS:
                continue
            walk(entry.path, depth + 1)

    walk(root, 0)
    found.sort()
    _ROOTS_CACHE = found
    _ROOTS_STAMP = now
    return found


def _label_for(root):
    """폴더를 구분할 이름. ComfyUI 기준 상대 경로를 쓴다."""
    base = comfy_root()
    try:
        rel = os.path.relpath(root, base)
    except ValueError:
        return os.path.basename(root)
    return rel.replace(os.sep, "/")


def root_labels():
    """찾은 와일드카드 폴더들의 이름. 어디를 뒤졌는지 보여줄 때 쓴다."""
    return [_label_for(root) for root in find_roots()]


def _read_favorites():
    if not os.path.isfile(FAVORITES_PATH):
        return set()
    try:
        with open(FAVORITES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return set()
    return set(data) if isinstance(data, list) else set()


def _write_favorites(names):
    temp = FAVORITES_PATH + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(sorted(names), f, ensure_ascii=False, indent=2)
    os.replace(temp, FAVORITES_PATH)


def set_favorite(name, favorite):
    """즐겨찾기를 켜고 끈다. 저장된 뒤 상태를 돌려준다."""
    names = _read_favorites()
    if favorite:
        names.add(name)
    else:
        names.discard(name)
    _write_favorites(names)
    return name in names


def _safe_name(name):
    """사용자가 입력한 파일명을 와일드카드 상대 경로로 정리한다."""
    if not isinstance(name, str):
        return None
    value = name.strip().replace("\\", "/").strip("/")
    if not value or os.path.isabs(value) or ".." in value.split("/"):
        return None
    stem, ext = os.path.splitext(value)
    if ext.lower() in _EXTENSIONS:
        value = stem
    elif ext:
        return None
    if not value or any(part in ("", ".") for part in value.split("/")):
        return None
    if any(re.search(r'[<>:"|?*\x00-\x1f]', part) for part in value.split("/")):
        return None
    return value


def read_text(name):
    """편집용 원문과 현재 이름을 돌려준다."""
    path = resolve(name)
    if path is None:
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return {"name": name.replace("\\", "/").strip(), "content": f.read()}


def _inside(path, root):
    try:
        return os.path.commonpath((os.path.realpath(path), os.path.realpath(root))) == os.path.realpath(root)
    except ValueError:
        return False


def save_text(name, content, old_name=None):
    """새 와일드카드를 만들거나 기존 파일의 내용/이름을 바꾼다."""
    clean = _safe_name(name)
    if clean is None or not isinstance(content, str):
        raise ValueError("Invalid wildcard title or content")

    old_path = resolve(old_name) if old_name else None
    if old_name and old_path is None:
        raise FileNotFoundError("Wildcard not found")

    if old_path:
        root = next((r for r in find_roots() if _inside(old_path, r)), None)
        ext = os.path.splitext(old_path)[1].lower()
    else:
        roots = find_roots()
        root = roots[0] if roots else os.path.join(comfy_root(), "wildcards")
        ext = ".txt"
    if root is None:
        raise ValueError("Wildcard path is outside a wildcard folder")

    target = os.path.join(root, *clean.split("/")) + ext
    if not _inside(target, root):
        raise ValueError("Invalid wildcard path")
    if os.path.exists(target) and (not old_path or os.path.realpath(target) != os.path.realpath(old_path)):
        raise FileExistsError("A wildcard with that title already exists")

    os.makedirs(os.path.dirname(target), exist_ok=True)
    temp = target + ".tmp"
    with open(temp, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    os.replace(temp, target)
    if old_path and os.path.realpath(old_path) != os.path.realpath(target):
        os.remove(old_path)
        favorites = _read_favorites()
        if old_name in favorites:
            favorites.discard(old_name)
            favorites.add(clean)
            _write_favorites(favorites)
    forget_roots()
    return clean


def delete(name):
    """와일드카드 파일 하나를 삭제한다."""
    path = resolve(name)
    if path is None:
        raise FileNotFoundError("Wildcard not found")
    root = next((r for r in find_roots() if _inside(path, r)), None)
    if root is None:
        raise ValueError("Wildcard path is outside a wildcard folder")
    os.remove(path)
    favorites = _read_favorites()
    favorites.discard(name)
    _write_favorites(favorites)
    forget_roots()


def _entry_count(path):
    """고를 수 있는 줄이 몇 개인지 센다. 빈 줄과 주석은 빼고 센다."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return sum(
                1 for line in f
                if line.strip() and not line.lstrip().startswith("#")
            )
    except OSError:
        return 0


def preview_lines(path, limit=12):
    """미리보기용으로 앞쪽 몇 줄만 읽는다."""
    lines = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                text = line.strip()
                if not text or text.startswith("#"):
                    continue
                lines.append(text)
                if len(lines) >= limit:
                    break
    except OSError:
        return []
    return lines


def library():
    """모든 와일드카드를 목록으로 만든다.

    같은 이름이 여러 폴더에 있으면 먼저 찾은 것만 남긴다.
    Impact Pack 등도 이름으로 찾으므로 실제 사용될 것 하나만 보여준다.
    """
    favorites = _read_favorites()
    items = []
    taken = set()

    for root in find_roots():
        source = _label_for(root)
        for base, dirs, files in os.walk(root):
            dirs[:] = sorted(
                d for d in dirs
                if not d.startswith(_SKIP_PREFIXES) and d.lower() not in _SKIP_DIRS
            )
            for filename in sorted(files):
                stem, ext = os.path.splitext(filename)
                if ext.lower() not in _EXTENSIONS:
                    continue
                rel = os.path.relpath(os.path.join(base, filename), root)
                # 와일드카드 이름은 확장자를 뗀 상대 경로다("samples/flower")
                name = os.path.splitext(rel)[0].replace(os.sep, "/")
                key = name.lower()
                if key in taken:
                    continue
                taken.add(key)
                folder = os.path.dirname(name).replace(os.sep, "/")
                items.append({
                    "name": name,
                    "title": stem,
                    "folder": folder,
                    "source": source,
                    "count": _entry_count(os.path.join(base, filename)),
                    "favorite": name in favorites,
                })
    items.sort(key=lambda item: item["name"].lower())
    return items


def _index():
    """이름(소문자) -> 실제 경로 표. 폴더 목록과 같은 주기로 다시 만든다."""
    global _INDEX_CACHE, _INDEX_STAMP
    now = time.monotonic()
    if _INDEX_CACHE is not None and now - _INDEX_STAMP < _ROOTS_TTL:
        return _INDEX_CACHE

    table = {}
    for root in find_roots():
        for base, dirs, files in os.walk(root):
            dirs[:] = [
                d for d in dirs
                if not d.startswith(_SKIP_PREFIXES) and d.lower() not in _SKIP_DIRS
            ]
            for filename in files:
                _stem, ext = os.path.splitext(filename)
                if ext.lower() not in _EXTENSIONS:
                    continue
                rel = os.path.relpath(os.path.join(base, filename), root)
                key = os.path.splitext(rel)[0].replace(os.sep, "/").lower()
                # 먼저 찾은 폴더가 이긴다. library() 가 보여준 것과 같은 파일이어야 한다.
                table.setdefault(key, os.path.join(base, filename))
    _INDEX_CACHE = table
    _INDEX_STAMP = now
    return table


def resolve(name):
    """와일드카드 이름을 실제 파일 경로로 되돌린다. 없으면 None."""
    if not isinstance(name, str) or not name.strip():
        return None
    # 경로를 벗어나려는 이름은 받지 않는다
    if os.path.isabs(name) or ".." in name.replace("\\", "/").split("/"):
        return None
    path = _index().get(name.replace("\\", "/").strip().lower())
    return path if path and os.path.isfile(path) else None


# ── 프롬프트에 든 와일드카드를 실제 값으로 바꾸는 부분 ──────────────

# __이름__ 또는 __이름:2__ (2개 뽑기)
_TOKEN = re.compile(r"__([^_\s{}|][^\s{}|]*?)(?::(\d+))?__")

# {a|b|c} 인라인 선택. 중첩은 안쪽부터 푼다.
_INLINE = re.compile(r"\{([^{}]*)\}")

# 치환을 반복하는 최대 횟수. 와일드카드가 서로를 부르면 끝없이 돌 수 있다.
_MAX_PASSES = 20


def _choices(path):
    """파일에서 고를 수 있는 줄만 읽는다."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return [
                line.strip() for line in f
                if line.strip() and not line.lstrip().startswith("#")
            ]
    except OSError:
        return []


def _pick_inline(text, rng):
    """{a|b|c} 를 하나 골라 바꾼다. 안쪽 괄호부터 푼다."""
    def swap(match):
        options = match.group(1).split("|")
        return rng.choice(options).strip() if options else ""

    for _ in range(_MAX_PASSES):
        new_text, count = _INLINE.subn(swap, text)
        text = new_text
        if not count:
            break
    return text


def expand(text, rng, missing=None):
    """프롬프트 안의 와일드카드를 실제 값으로 바꾼다.

    rng 는 random.Random 이다. 시드를 고정하면 같은 결과가 나온다.
    없는 이름은 그대로 두고 missing 에 담아 호출한 쪽이 알 수 있게 한다.
    """
    if not isinstance(text, str):
        return ""
    if "__" not in text and "{" not in text:
        return text

    # 파일을 여러 번 읽지 않도록 이번 호출 동안만 기억한다
    cache = {}

    def lookup(name):
        key = name.lower()
        if key not in cache:
            path = resolve(name)
            cache[key] = _choices(path) if path else None
        return cache[key]

    # 없는 이름은 한 번만 알린다. 아래 루프가 같은 토큰을 여러 번 지나기 때문이다.
    unknown = set()

    def swap(match):
        name = match.group(1)
        count = int(match.group(2)) if match.group(2) else 1
        options = lookup(name)
        if not options:
            # 파일이 없으면 건드리지 않는다. 오타를 눈으로 찾을 수 있게 남긴다.
            if options is None and name not in unknown:
                unknown.add(name)
                if missing is not None:
                    missing.append(name)
            return match.group(0)
        count = max(1, min(count, len(options)))
        picked = rng.sample(options, count) if count > 1 else [rng.choice(options)]
        return ", ".join(picked)

    # 글자가 실제로 바뀌지 않으면 멈춘다.
    # subn 의 개수는 "치환한 횟수" 가 아니라 "찾은 횟수" 라서,
    # 없는 이름만 남았을 때 그대로 두면 끝없이 같은 자리를 다시 본다.
    for _ in range(_MAX_PASSES):
        before = text
        text = _pick_inline(text, rng)
        text = _TOKEN.sub(swap, text)
        if text == before:
            break

    return _pick_inline(text, rng)
