/** 버튼 상호작용(호버 밝아짐 · 누름 어두워짐) 공용 부품.
 *
 *  캔버스에 직접 그리는 버튼은 CSS :hover 가 없다. 그래서 캔버스의
 *  pointermove/down/up 을 한 곳에서 듣고, "지금 어느 위젯의 어느 칸 위에
 *  있는지"를 전역으로 하나만 들고 있는다. 각 위젯의 draw 는 그 값을 보고
 *  자기 칸의 색을 밝히거나 어둡게 한다.
 *
 *  칸은 위젯이 draw 때 채우는 bounds 의 키 이름(예 "save", "del")으로 가른다.
 *  bounds 는 [x, width] 라 가로만 담고 있으므로, 세로는 위젯 자체를 찾아주는
 *  getWidgetOnPos 로 가린다. 두 조건이 함께 맞아야 그 칸 위에 있는 것이다.
 */
import { app } from "../../scripts/app.js";

// 지금 마우스가 올라간 칸 / 누르고 있는 칸. { widget, key } 또는 null.
let hovered = null;
let pressed = null;
let boundCanvas = null;

/** 두 상태가 가리키는 칸이 같은지 본다. */
function same(spot, widget, key) {
    return spot?.widget === widget && spot.key === key;
}

/** 캔버스 좌표를 노드 기준 좌표로 바꿔 위젯을 찾는다.
 *  못 찾으면 null. */
function widgetAt(event) {
    const canvas = app.canvas;
    const graph = canvas?.graph;
    const scale = canvas?.ds?.scale;
    const offset = canvas?.ds?.offset;
    if (!graph || !scale || !offset) return null;

    const rect = canvas.canvas.getBoundingClientRect();
    const graphX = (event.clientX - rect.left) / scale - offset[0];
    const graphY = (event.clientY - rect.top) / scale - offset[1];
    const node = graph.getNodeOnPos?.(graphX, graphY);
    const widget = node?.getWidgetOnPos?.(graphX, graphY);
    if (!widget?.flaHit) return null;
    return { widget, node, localX: graphX - node.pos[0] };
}

/** widget.bounds 중 localX 가 들어가는 칸의 키를 돌려준다.
 *  bounds 가 배열이면(체크리스트의 버튼 줄) 인덱스를 키로 쓴다. */
function keyAt(widget, localX) {
    const bounds = widget.bounds;
    if (!bounds) return null;

    const hit = (b) => b && localX >= b[0] && localX <= b[0] + b[1];

    if (Array.isArray(bounds)) {
        for (let i = 0; i < bounds.length; i++) {
            if (hit(bounds[i])) return i;
        }
        return null;
    }
    for (const [key, b] of Object.entries(bounds)) {
        if (hit(b)) return key;
    }
    return null;
}

/** 상태가 바뀌었을 때만 다시 그린다. 매 pointermove 마다 그리면 무겁다. */
function repaint() {
    const canvas = app.canvas;
    if (!canvas) return;
    // 프론트엔드 버전에 따라 이름이 다르다. 있는 쪽을 쓴다.
    if (typeof canvas.setDirty === "function") canvas.setDirty(true, true);
    else canvas.graph?.setDirtyCanvas(true, true);
}

function setHovered(next) {
    if (same(hovered, next?.widget, next?.key)) return;
    hovered = next;
    // 커서 모양은 건드리지 않는다. 프론트엔드가 리사이즈·링크 연결에 맞춰
    // 매 프레임 canvas.style.cursor 를 자기 값으로 덮어쓰기 때문에,
    // 여기서 끼어들면 그쪽 표시를 지워버린다. 색 변화만으로 충분하다.
    repaint();
}

function setPressed(next) {
    if (same(pressed, next?.widget, next?.key)) return;
    pressed = next;
    repaint();
}

/** 캔버스에 리스너를 한 번만 단다. 위젯을 만들 때마다 불러도 안전하다. */
export function ensureHitTracking() {
    const canvas = app.canvas?.canvas;
    if (!canvas || canvas === boundCanvas) return;
    boundCanvas = canvas;

    canvas.addEventListener("pointermove", (event) => {
        const found = widgetAt(event);
        if (!found) {
            setHovered(null);
            return;
        }
        const key = keyAt(found.widget, found.localX);
        setHovered(key === null ? null : { widget: found.widget, key });
    });

    canvas.addEventListener("pointerdown", (event) => {
        const found = widgetAt(event);
        if (!found) {
            setPressed(null);
            return;
        }
        const key = keyAt(found.widget, found.localX);
        setPressed(key === null ? null : { widget: found.widget, key });
    });

    // up 은 버튼 밖에서 떼도 와야 하므로 window 에서 듣는다.
    // 캔버스에서만 들으면 눌린 채 밖으로 나가 뗐을 때 눌림 상태가 남는다.
    window.addEventListener("pointerup", () => setPressed(null));
    window.addEventListener("pointercancel", () => setPressed(null));
    // 마우스가 캔버스를 벗어나면 호버도 푼다
    canvas.addEventListener("pointerleave", () => setHovered(null));
}

/** 이 위젯의 칸들이 상호작용 대상임을 표시한다.
 *  표식이 없는 위젯은 widgetAt 이 무시하므로 기존 동작 그대로다. */
export function markHit(widget) {
    widget.flaHit = true;
    ensureHitTracking();
    return widget;
}

/** draw 안에서 부른다. 이 칸의 현재 상태를 돌려준다. */
export function hitState(widget, key) {
    return {
        hover: same(hovered, widget, key),
        press: same(pressed, widget, key),
    };
}

/** "#2a3a2c" 같은 색을 amount 만큼 밝히거나(양수) 어둡게(음수) 한다.
 *  캔버스는 filter 로 개별 도형만 손보기 어려워서 색을 직접 계산한다. */
function shade(color, amount) {
    const hex = String(color).trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) return color;

    let body = m[1];
    // #abc → #aabbcc
    if (body.length === 3) body = body.split("").map((c) => c + c).join("");

    const channels = [0, 2, 4].map((i) => {
        const v = parseInt(body.slice(i, i + 2), 16);
        // 밝힐 때는 남은 폭(255-v)의 비율만큼, 어둡게 할 때는 자기 값의 비율만큼
        const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
        return Math.round(Math.min(255, Math.max(0, next)));
    });
    return "#" + channels.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const HOVER_LIFT = 0.18;    // 호버 시 밝히는 정도
const PRESS_DROP = -0.18;   // 누를 때 어둡게 하는 정도

/** 칸 상태에 맞춰 [바탕색, 테두리색] 을 조정해 돌려준다.
 *
 *  enabled 가 false 면(꺼진 노드 등) 원래 색을 그대로 둔다.
 *  눌린 상태가 호버보다 우선한다 — 누르고 있으면 어두운 쪽이 보여야 한다.
 */
export function hitColors(widget, key, fill, stroke, enabled = true) {
    if (!enabled) return [fill, stroke];
    const { hover, press } = hitState(widget, key);
    if (press) return [shade(fill, PRESS_DROP), shade(stroke, PRESS_DROP)];
    // 테두리는 바탕보다 조금 더 밝혀야 윤곽이 또렷해진다
    if (hover) return [shade(fill, HOVER_LIFT), shade(stroke, HOVER_LIFT * 1.5)];
    return [fill, stroke];
}

/** 배경 없이 글자만 있는 버튼(⚙, ✕ 같은 것)용.
 *  바탕을 밝힐 수 없으니 글자색 자체를 조정한다. */
export function hitText(widget, key, color, enabled = true) {
    if (!enabled) return color;
    const { hover, press } = hitState(widget, key);
    if (press) return shade(color, PRESS_DROP);
    if (hover) return shade(color, HOVER_LIFT * 2);
    return color;
}
