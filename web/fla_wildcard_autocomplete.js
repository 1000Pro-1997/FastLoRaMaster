/** 프롬프트 칸에서 __ 를 치면 뜨는 와일드카드 자동완성.
 *
 *  글자에 색을 입히는 것과 달리 이 목록은 textarea 위에 따로 뜨는 창이라
 *  글자와 픽셀 단위로 맞출 필요가 없다. 커서 근처면 충분하다.
 *
 *  조작은 흔한 자동완성과 같다.
 *    ↑ ↓      고르기
 *    Tab      넣기
 *    Enter    넣기
 *    Esc      닫기
 *
 *  즐겨찾기는 목록 맨 위에 노란 별을 달고 나온다.
 */

import { library, wildcardToken } from "./fla_wildcard_picker.js";

// 한 번에 보여줄 최대 개수. 너무 길면 고르기 어렵다.
const MAX_ROWS = 12;

let styled = false;

function addStyles() {
    if (styled) return;
    styled = true;
    const style = document.createElement("style");
    style.id = "fla-wc-ac-style";
    // 캔버스 위젯보다 위에 떠야 하므로 z-index 를 피커와 같은 대역으로 둔다.
    style.textContent = `
      .fla-wc-ac{position:fixed;z-index:100030;min-width:220px;max-width:420px;padding:4px;overflow-y:auto;background:#22262d;border:1px solid #4b5360;border-radius:8px;box-shadow:0 12px 34px #000b;font:13px Arial,sans-serif}
      .fla-wc-ac-row{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:5px;color:#dde2e8;cursor:pointer;white-space:nowrap}
      .fla-wc-ac-row .star{flex:none;width:13px;color:#ffd34e;text-align:center}
      .fla-wc-ac-row .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
      .fla-wc-ac-row .count{flex:none;color:#828b97;font-size:11px}
      .fla-wc-ac-row.on{background:#2f6fd0;color:#fff}
      .fla-wc-ac-row.on .count{color:#dbe7f7}
      .fla-wc-ac-row .hit{color:#ffd84d;font-weight:700}
      .fla-wc-ac-row.on .hit{color:#fff59a}
    `;
    document.head.appendChild(style);
}

/** 커서 바로 앞에서 아직 닫히지 않은 __토큰 을 찾는다.
 *
 *  줄 첫머리이거나 앞이 공백 · , · ( · [ · : 일 때만 잡는다.
 *  그래야 snake_case 나 이미 완성된 __hair__ 뒤에서 뜨지 않는다.
 *  이름에 _ 를 쓸 수 있어야 하므로(hair_color) 뒷부분은 _ 도 받되,
 *  __ 가 다시 나오면 닫힌 것이므로 제외한다.
 */
export function findQuery(text, caret) {
    const before = text.slice(0, caret);
    const m = /(?:^|[\s,(\[:])__([^\s,)\]]*)$/.exec(before);
    if (!m) return null;
    const typed = m[1];
    // 닫는 __ 가 이미 들어왔으면 완성된 토큰이다
    if (typed.includes("__")) return null;
    return { typed, start: caret - typed.length - 2 };
}

/** 친 글자로 목록을 거른다.
 *
 *  즐겨찾기가 먼저, 그 다음 이름 순이다.
 *  앞에서부터 맞는 것을 중간에 맞는 것보다 위에 둔다.
 */
export function filterItems(items, typed) {
    const q = typed.toLocaleLowerCase();
    const scored = [];
    for (const item of items) {
        const name = String(item.name ?? "");
        const at = q ? name.toLocaleLowerCase().indexOf(q) : 0;
        if (at < 0) continue;
        scored.push({ item, at });
    }
    scored.sort((a, b) => {
        // ① 즐겨찾기 먼저
        const fa = a.item.favorite === true, fb = b.item.favorite === true;
        if (fa !== fb) return fa ? -1 : 1;
        // ② 앞에서 맞은 것 먼저
        if (a.at !== b.at) return a.at - b.at;
        // ③ 이름 순
        return String(a.item.name).localeCompare(String(b.item.name));
    });
    return scored.slice(0, MAX_ROWS).map((s) => s.item);
}

/** 맞은 부분만 굳게 칠해서 넣는다. */
function withHit(host, name, typed) {
    const at = typed ? name.toLocaleLowerCase().indexOf(typed.toLocaleLowerCase()) : -1;
    if (at < 0) {
        host.textContent = name;
        return;
    }
    host.append(document.createTextNode(name.slice(0, at)));
    const hit = document.createElement("span");
    hit.className = "hit";
    hit.textContent = name.slice(at, at + typed.length);
    host.append(hit, document.createTextNode(name.slice(at + typed.length)));
}

/** textarea 안 커서의 화면 좌표를 잰다.
 *
 *  textarea 는 안쪽 글자 위치를 알려주지 않으므로, 똑같은 글꼴·너비·여백을 준
 *  숨은 div 에 커서 앞 글자까지만 넣고 그 끝을 재는 방식을 쓴다.
 *  자동완성 위치는 조금 어긋나도 무해하므로 이 정도로 충분하다.
 *
 *  실패하면 null 을 돌려준다. 그때는 칸 아래에 붙인다.
 */
function caretPoint(el, caret) {
    let mirror = null;
    try {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        mirror = document.createElement("div");
        // 줄바꿈이 실제 칸과 같은 자리에서 일어나야 좌표가 맞는다
        for (const key of [
            "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
            "lineHeight", "textTransform", "wordSpacing", "textIndent",
            "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
            "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
            "boxSizing", "whiteSpace", "wordBreak", "overflowWrap",
        ]) mirror.style[key] = cs[key];
        Object.assign(mirror.style, {
            position: "fixed",
            visibility: "hidden",
            pointerEvents: "none",
            top: "0px",
            left: "0px",
            // 스크롤바가 차지한 만큼 빼야 줄바꿈 위치가 같아진다
            width: `${el.clientWidth}px`,
            height: "auto",
            overflow: "hidden",
            whiteSpace: cs.whiteSpace === "nowrap" ? "pre" : "pre-wrap",
        });

        mirror.textContent = el.value.slice(0, caret);
        // 커서 자리를 표시할 조각. 빈 span 은 높이가 0 이라 글자를 하나 넣는다.
        const mark = document.createElement("span");
        mark.textContent = "\u200b";
        mirror.appendChild(mark);
        document.body.appendChild(mirror);

        const m = mark.getBoundingClientRect();
        const mr = mirror.getBoundingClientRect();
        // 미러는 (0,0) 에 있으므로 칸 좌표로 옮기고 스크롤만큼 뺀다
        const x = r.left + (m.left - mr.left) - el.scrollLeft;
        const top = r.top + (m.top - mr.top) - el.scrollTop;
        const lineH = m.height || parseFloat(cs.lineHeight) || 14;
        return { x, top, bottom: top + lineH };
    } catch (e) {
        return null;
    } finally {
        mirror?.remove();
    }
}

/** textarea 하나에 자동완성을 붙인다. 이미 붙어 있으면 그냥 둔다. */
export function attachWildcardAutocomplete(el, onChanged = null) {
    if (!el || el.flaWcAc) return;
    el.flaWcAc = true;
    addStyles();

    let box = null;      // 떠 있는 목록
    let rows = [];       // 지금 보이는 항목
    let active = 0;      // 고른 줄
    let query = null;    // 지금 잡힌 __토큰

    // Esc 로 껐다는 표시. 그 토큰을 벗어나기 전까지는 다시 열지 않는다.
    let muted = false;

    const isOpen = () => box !== null;

    function close() {
        box?.remove();
        box = null;
        rows = [];
        query = null;
    }

    /** 고른 항목을 넣는다. __이름__ 으로 닫고 커서를 뒤로 보낸다. */
    function commit(item) {
        if (!query) return;
        const token = wildcardToken(item.name);
        const text = el.value;
        // 커서 뒤에 이미 __ 가 붙어 있으면 겹쳐 쓰지 않는다
        const after = text.slice(el.selectionStart);
        const tail = after.startsWith("__") ? 2 : 0;
        el.value = text.slice(0, query.start) + token + after.slice(tail);
        const caret = query.start + token.length;
        el.setSelectionRange(caret, caret);
        close();
        // ComfyUI 위젯 값까지 따라오게 한다
        el.dispatchEvent(new Event("input", { bubbles: true }));
        onChanged?.(el.value);
    }

    /** 커서가 있는 줄 바로 아래에 목록을 놓는다.
     *
     *  캔버스 안이라 칸이 작을 수 있으므로 화면 밖으로 나가지 않게 가둔다.
     *  아래가 좁으면 커서 줄 위로 올린다.
     */
    function place() {
        if (!box) return;
        const r = el.getBoundingClientRect();
        // 커서를 못 재면 칸 아래에 붙인다(예전 동작)
        const pt = caretPoint(el, el.selectionStart) ?? { x: r.left, top: r.top, bottom: r.bottom };

        // 커서가 칸 밖으로 스크롤돼 나갔으면 칸 안으로 당겨둔다
        const lineTop = Math.min(Math.max(pt.top, r.top), r.bottom);
        const lineBottom = Math.min(Math.max(pt.bottom, r.top), r.bottom);

        box.style.maxWidth = `${Math.min(420, Math.max(220, window.innerWidth - 16))}px`;
        box.style.maxHeight = "";

        // 높이를 알아야 위아래를 정할 수 있으므로 먼저 아래에 두고 잰다
        box.style.left = "0px";
        box.style.top = `${Math.round(lineBottom + 4)}px`;
        let rect = box.getBoundingClientRect();

        const below = window.innerHeight - lineBottom - 8;
        const above = lineTop - 8;
        if (rect.height > below && above > below) {
            // 위쪽이 더 넓으면 커서 줄 위로 올린다
            box.style.maxHeight = `${Math.round(Math.max(90, above))}px`;
            rect = box.getBoundingClientRect();
            box.style.top = `${Math.round(lineTop - 4 - rect.height)}px`;
        } else if (rect.height > below) {
            box.style.maxHeight = `${Math.round(Math.max(90, below))}px`;
        }

        // 가로는 커서에 맞추되 오른쪽으로 넘치면 왼쪽으로 당긴다
        rect = box.getBoundingClientRect();
        const x = Math.min(Math.max(8, pt.x), window.innerWidth - rect.width - 8);
        box.style.left = `${Math.round(x)}px`;
    }

    function draw() {
        if (!box) return;
        box.replaceChildren();
        rows.forEach((item, i) => {
            const row = document.createElement("div");
            row.className = `fla-wc-ac-row${i === active ? " on" : ""}`;

            const star = document.createElement("span");
            star.className = "star";
            // 즐겨찾기만 노란 별을 단다. 자리는 늘 잡아둬서 이름이 들쭉날쭉하지 않게 한다.
            star.textContent = item.favorite ? "★" : "";
            const name = document.createElement("span");
            name.className = "name";
            withHit(name, String(item.name ?? ""), query?.typed ?? "");
            const count = document.createElement("span");
            count.className = "count";
            if (item.count != null) count.textContent = String(item.count);

            row.append(star, name, count);
            // mousedown 으로 잡아야 textarea 가 포커스를 잃기 전에 넣을 수 있다
            row.addEventListener("mousedown", (event) => {
                event.preventDefault();
                commit(item);
            });
            row.addEventListener("mousemove", () => {
                if (active === i) return;
                active = i;
                draw();
            });
            box.appendChild(row);
        });
        place();
        // 골라진 줄이 안 보이면 따라 내려간다
        box.children[active]?.scrollIntoView({ block: "nearest" });
    }

    async function refresh() {
        const found = findQuery(el.value, el.selectionStart);
        // 토큰을 벗어나면 Esc 표시를 푼다. 다음 __ 에서는 다시 뜬다.
        if (!found) { muted = false; close(); return; }
        // Esc 로 껐으면 같은 토큰 안에서는 조용히 있는다
        if (muted) return;
        query = found;

        let items = [];
        try {
            items = await library();
        } catch (e) {
            close();
            return;
        }
        // 기다리는 사이 커서가 움직였을 수 있으므로 다시 확인한다
        const still = findQuery(el.value, el.selectionStart);
        if (!still) { close(); return; }
        query = still;

        rows = filterItems(items, query.typed);
        if (!rows.length) { close(); return; }

        if (!box) {
            box = document.createElement("div");
            box.className = "fla-wc-ac";
            document.body.appendChild(box);
            active = 0;
        } else if (active >= rows.length) {
            active = 0;
        }
        draw();
    }

    // 캔버스로 새어 나가면 노드가 지워지거나 화면이 움직인다.
    // 목록이 떠 있을 때는 이 키들을 여기서 끝낸다.
    el.addEventListener("keydown", (event) => {
        if (!isOpen()) return;
        const k = event.key;
        if (k === "ArrowDown" || k === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            active = (active + (k === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
            draw();
            return;
        }
        if (k === "Tab" || k === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commit(rows[active]);
            return;
        }
        if (k === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            muted = true;
            close();
        }
    // capture 로 잡아야 위젯이 걸어둔 stopPropagation 보다 먼저 본다
    }, true);


    el.addEventListener("input", refresh);
    // 화살표·클릭으로 커서만 옮겨도 조건이 바뀔 수 있다
    el.addEventListener("click", refresh);
    el.addEventListener("keyup", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refresh();
    });
    el.addEventListener("blur", () => setTimeout(close, 120));
    el.addEventListener("scroll", place);
    window.addEventListener("resize", () => { if (isOpen()) place(); });
}
