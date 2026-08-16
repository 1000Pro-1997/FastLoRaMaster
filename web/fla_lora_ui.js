/** 로라 목록 UI 공용 부품.
 *
 *  FLALoraTheme 과 FLAChecklist 가 똑같이 쓰는 것들을 모아둔다.
 *  여기를 고치면 두 노드에 함께 반영된다.
 *
 *  각 노드가 다르게 쓰는 부분(여백, 바이패스 표시, 삭제 대상)은
 *  makeLoraRow 의 opts 로 받는다.
 */
import { app } from "../../scripts/app.js";
import { t } from "./fla_i18n.js";
import { pickLora } from "./fla_lora_picker.js";
import { mouseGate, releaseWidgetCaptureSoon } from "./fla_widget_mouse.js";

export const ROW_HEIGHT = 22;

// 강도 조절부(◀ 0.90 ▶) 치수. drawNumber 가 쓴다.
export const ARROW_W = 9;
export const ARROW_H = 10;
export const NUM_W = 32;
export const INNER = 3;
export const NUM_TOTAL = ARROW_W + INNER + NUM_W + INNER + ARROW_W;

// 로라 행 색
export const ROW_COLORS = {
    on: "#2a3a2c",       // 켜진 로라 바탕
    onEdge: "#3f6146",   // 켜진 로라 테두리
    off: "#2a2a2a",      // 꺼진 로라 바탕
    offEdge: "#3a3a3a",  // 꺼진 로라 테두리
    del: "#a66",         // 삭제 ✕
};

/** REST 응답을 JSON 으로 풀어준다. 실패하면 서버가 준 error 문구를 던진다. */
export async function api(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).error || msg; } catch (e) { /* 본문 없음 */ }
        throw new Error(msg);
    }
    return res.json();
}

/** 위젯을 이름으로 찾는다. */
export function findWidget(node, name) {
    return node.widgets?.find(w => w.name === name);
}

/** 이 노드 전체가 꺼진 상태인지(프롬프트 토글 off). */
export function isNodeOff(node) {
    return node?.flaHidden?.prompt_enabled?.value === false;
}

/** 알림. 오류는 눈에 띄게 대화상자로 띄운다. */
export function notify(msg, error = false) {
    if (error) {
        // 블로킹 대화상자라 pointerup 을 삼킬 수 있다
        releaseWidgetCaptureSoon();
        alert(msg);
        return;
    }
    const toast = app.extensionManager?.toast;
    if (toast?.add) {
        toast.add({ severity: "success", summary: msg, life: 2000 });
    } else {
        console.log("[FLA]", msg);
    }
}

/** 목록에서 하나 고르는 팝업. 클릭한 자리에서 열리도록 이벤트를 넘겨준다.
 *  event 를 주지 않으면 마지막 캔버스 클릭 위치를 쓴다.
 *  메뉴를 그냥 닫으면 문자열이 아닌 값이 오므로 null 로 정규화한다. */
export function pickFromList(list, event) {
    // 메뉴가 커서를 덮으면 캔버스가 pointerup 을 못 받아 위젯 캡처가 남는다
    releaseWidgetCaptureSoon();
    return new Promise((resolve) => {
        const ev = event
            ?? app.canvas.last_canvas_mouse_event
            ?? { clientX: 400, clientY: 300 };
        const menu = new LiteGraph.ContextMenu(list, {
            scale: Math.max(1, app.canvas.ds.scale),
            event: ev,
            callback: (v) => {
                // 취소하거나 객체가 오면 선택하지 않은 것으로 본다
                if (typeof v === "string") resolve(v);
                else if (v && typeof v.content === "string") resolve(v.content);
                else resolve(null);
            },
        });

        // 목록이 길면 스크롤이 생기도록 높이를 제한한다.
        // 기본 스타일의 max-height 가 브라우저에 따라 동작하지 않는 경우가 있다.
        const root = menu?.root;
        if (root) {
            root.style.maxHeight = "60vh";
            root.style.overflowY = "auto";
        }
    });
}

export function drawRoundedRect(ctx, x, y, w, h, fill, stroke) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(2, w), h, [h * 0.25]);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();
}

/** 토글 스위치. 클릭 범위 [x, width] 를 돌려준다.
 *  live 가 false 면 켜져 있어도 회색으로 그린다(바이패스 표시). */
export function drawToggle(ctx, posX, posY, height, value, live = true) {
    const radius = height * 0.36;
    const bgWidth = height * 1.5;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(posX + 4, posY + 4, bgWidth - 8, height - 8, [height * 0.5]);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = (value && live) ? "#89B" : "#888";
    const knobX = value ? posX + height : posX + height * 0.5;
    ctx.beginPath();
    ctx.arc(knobX, posY + height * 0.5, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    return [posX, bgWidth];
}

/** ◀ 값 ▶ 묶음을 rightX 기준 오른쪽 정렬로 그린다.
 *  [왼쪽화살표, 숫자, 오른쪽화살표] 각각의 [x, width] 를 돌려준다. */
export function drawNumber(ctx, rightX, posY, height, value) {
    const midY = posY + height / 2;
    let posX = rightX - NUM_TOTAL;

    ctx.save();
    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";

    // ◀
    ctx.fill(new Path2D(
        `M ${posX} ${midY} l ${ARROW_W} ${ARROW_H / 2} l 0 -${ARROW_H} L ${posX} ${midY} z`
    ));
    const left = [posX, ARROW_W];
    posX += ARROW_W + INNER;

    // 숫자
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Number(value).toFixed(2), posX + NUM_W / 2, midY);
    const num = [posX, NUM_W];
    posX += NUM_W + INNER;

    // ▶
    ctx.fill(new Path2D(
        `M ${posX} ${midY - ARROW_H / 2} l ${ARROW_W} ${ARROW_H / 2} l -${ARROW_W} ${ARROW_H / 2} v -${ARROW_H} z`
    ));
    const right = [posX, ARROW_W];

    ctx.restore();
    return [left, num, right];
}

/** 폭에 맞춰 글자를 줄인다.
 *  로라는 경로 뒤쪽에 파일명이 오므로 앞을 자른다("…style_v2.safetensors"). */
export function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText("…" + s).width > maxWidth) {
        s = s.slice(1);
    }
    return "…" + s;
}

/** pos 가 [x, width] 범위 안인지. 행 높이는 프론트엔드가 이미 걸러준다. */
export function inBounds(pos, bounds) {
    if (!bounds) return false;
    return pos[0] >= bounds[0] && pos[0] <= bounds[0] + bounds[1];
}

/** "SDXL/style/foo.safetensors" → "foo". 폭이 좁으니 파일명만 보여준다. */
export function prettyLora(path) {
    const file = String(path ?? "").split(/[\\/]/).pop() ?? "";
    return file.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
}

/** 로라 한 줄(토글 · 이름 · ◀강도▶ · ✕)을 그리는 위젯을 만든다.
 *
 *  opts 로 노드별 차이를 받는다:
 *    margin    좌우 여백. 패널 안쪽이면 더 크게 준다(기본 10)
 *    rowFlag   위젯에 달아둘 표식 이름. rebuild 때 걷어내는 기준
 *    bypassed  () => boolean. 참이면 켜져 있어도 회색 + 반투명으로 그린다
 *    onChange  값이 바뀌었을 때(토글·강도·경로). 저장 동기화용
 *    onRemove  (idx) => void. ✕ 를 눌렀을 때. 빼는 방법이 노드마다 다르다
 */
export function makeLoraRow(node, lora, idx, opts = {}) {
    const {
        margin = 10,
        rowFlag = "flaLoraRow",
        bypassed = () => false,
        onChange = () => { },
        onRemove = () => { },
    } = opts;

    const widget = {
        type: "custom",
        name: "fla_lora_" + idx,
        serialize: false,   // 값이 없는 표시용 위젯
        value: lora,
        // 마우스를 올리면 전체 경로를 보여준다. 이름은 폭에 맞춰 잘리기 때문이다.
        tooltip: "",
        // 클릭 판정 영역. draw 때마다 갱신된다.
        bounds: { toggle: null, name: null, dec: null, num: null, inc: null, del: null },

        // 폭은 요구하지 않는다(0). 0 을 돌려줘야 사용자가 좁혀놓은 폭이 유지된다.
        computeSize() {
            return [0, ROW_HEIGHT];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const inner = INNER;
            const midY = posY + height * 0.5;
            // 노드 실제 폭을 기준으로 그린다. 인자로 오는 폭은 버전마다 다르다.
            const width = node.size?.[0] ?? widgetWidth;
            const off = bypassed();
            const live = lora.enabled && !off;

            drawRoundedRect(
                ctx, margin, posY, width - margin * 2, height,
                live ? ROW_COLORS.on : ROW_COLORS.off,
                live ? ROW_COLORS.onEdge : ROW_COLORS.offEdge,
            );

            let posX = margin;
            this.bounds.toggle = drawToggle(ctx, posX, posY, height, lora.enabled, !off);
            posX += this.bounds.toggle[1] + inner;

            ctx.save();
            // 꺼진 로라, 또는 전체 바이패스 상태면 흐리게 보여준다
            if (!lora.enabled) ctx.globalAlpha = 0.45;
            else if (off) ctx.globalAlpha = 0.5;

            // 오른쪽 끝: 삭제 버튼
            const delW = 14;
            const delX = width - margin - inner - delW;
            ctx.fillStyle = ROW_COLORS.del;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("✕", delX + delW / 2, midY);
            this.bounds.del = [delX, delW];

            // 그 왼쪽: 강도 조절
            const numRight = delX - inner * 2;
            const [dec, num, inc] = drawNumber(ctx, numRight, posY, height, lora.strength);
            this.bounds.dec = dec;
            this.bounds.num = num;
            this.bounds.inc = inc;

            // 가운데: 이름 (남는 폭을 전부 쓴다)
            const nameLeft = posX;
            const nameW = Math.max(10, dec[0] - inner * 2 - nameLeft);
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
            ctx.textAlign = "left";
            ctx.fillText(fitText(ctx, prettyLora(lora.path), nameW), nameLeft, midY);
            this.bounds.name = [nameLeft, nameW];

            ctx.restore();
        },

        mouse(event, pos, n) {
            // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 한 번 처리한다.
            const gate = mouseGate(event);
            if (gate === "down") return;
            if (gate !== "up") return false;
            return handleLoraRowClick(node, lora, this, pos, {
                onChange, onRemove: () => onRemove(idx),
            });
        },
    };

    widget[rowFlag] = true;
    return widget;
}

/** 로라 행 클릭 처리. 토글 · 삭제 · 강도 · 이름(교체) 순으로 본다. */
export function handleLoraRowClick(node, lora, widget, pos, opts = {}) {
    const { onChange = () => { }, onRemove = () => { } } = opts;
    const touched = () => {
        onChange();
        node.setDirtyCanvas(true, true);
    };

    if (inBounds(pos, widget.bounds.toggle)) {
        lora.enabled = !lora.enabled;
        touched();
        return true;
    }
    if (inBounds(pos, widget.bounds.del)) {
        onRemove();
        return true;
    }
    if (inBounds(pos, widget.bounds.dec)) {
        lora.strength = Math.round((lora.strength - 0.05) * 100) / 100;
        touched();
        return true;
    }
    if (inBounds(pos, widget.bounds.inc)) {
        lora.strength = Math.round((lora.strength + 0.05) * 100) / 100;
        touched();
        return true;
    }
    if (inBounds(pos, widget.bounds.num)) {
        // 숫자를 직접 입력받는다
        releaseWidgetCaptureSoon();
        const v = window.prompt(t("strength"), String(lora.strength));
        if (v !== null && !isNaN(parseFloat(v))) {
            lora.strength = parseFloat(v);
            touched();
        }
        return true;
    }
    if (inBounds(pos, widget.bounds.name)) {
        // 이름을 누르면 그 자리에서 로라 교체 목록을 연다
        pickLora().then((choice) => {
            if (!choice) return;
            lora.path = choice;
            touched();
        });
        return true;
    }
    return false;
}

// 로라 영역 색
export const BOX_COLORS = {
    header: "#2d4a5e",   // "로라 적용" 토글 줄
    action: "#4a3a2a",   // "＋ 로라 추가" 버튼
    edgeOn: "#3f6146",   // 켜졌을 때 테두리
    edgeOff: "#4a4a4a",  // 꺼졌을 때 테두리
    grey: "#2a2a2a",     // 꺼졌을 때 바탕
};

/** 위젯 배경색을 고정한다. addWidget 이 만든 위젯에 쓴다. */
export function paint(widget, color) {
    Object.defineProperty(widget, "background_color", {
        get: () => color,
        configurable: true,
    });
    return widget;
}

/** "로라 적용" 토글 ~ "＋ 로라 추가" 까지를 테두리 하나로 묶은 영역을 만든다.
 *
 *  FLALoraTheme 과 FLAChecklist 가 같은 모양을 쓴다.
 *  만들어진 위젯들을 순서대로 담은 배열을 돌려준다. 호출한 쪽에서
 *  node.widgets 에 넣거나(테마) 패널 목록에 합친다(체크리스트).
 *
 *  opts:
 *    loras      () => 로라 배열
 *    enabled    () => boolean. "로라 적용" 토글의 현재 값
 *    setEnabled (v) => void. 토글을 눌렀을 때
 *    onAdd      (path) => void. 로라를 고른 뒤
 *    rowFlag    위젯에 달 표식 이름 (rebuild 때 걷어내는 기준)
 *    rowOpts    각 로라 행에 넘길 추가 옵션 (margin 등)
 *    extra      맨 아래에 더 붙일 위젯들 (체크리스트의 "항목 삭제")
 *    tooltip    토글에 붙일 설명
 */
export function buildLoraBox(node, opts = {}) {
    const {
        loras = () => [],
        enabled = () => true,
        setEnabled = () => { },
        onAdd = () => { },
        rowFlag = "flaLoraRow",
        rowOpts = {},
        extra = [],
        tooltip = "",
    } = opts;

    const list = loras();
    const onCount = list.filter((l) => l.enabled).length;
    // 노드 전체가 꺼져 있으면 로라 영역도 회색으로 본다
    const on = enabled() && !isNodeOff(node);

    const made = [];

    // ① "로라 적용" 토글 — 맨 위
    const allW = node.addWidget(
        "toggle",
        t("applyLora") + `  (${onCount}/${list.length})`,
        on,
        (v) => setEnabled(v),
    );
    allW[rowFlag] = true;
    // 실제 값은 파이썬 쪽 위젯이 들고 있다. 저장 슬롯을 차지하지 않게 한다.
    allW.serialize = false;
    if (tooltip) allW.tooltip = tooltip;
    paint(allW, on ? BOX_COLORS.header : BOX_COLORS.grey);
    made.push(allW);

    // ② 로라 목록 — 가운데
    list.forEach((lora, idx) => {
        made.push(makeLoraRow(node, lora, idx, {
            rowFlag,
            bypassed: () => !on,
            ...rowOpts,
        }));
    });

    // ③ "＋ 로라 추가" — 맨 아래
    const add = node.addWidget("button", t("addLora"), null, async () => {
        // 목록에서 고른 뒤에만 줄을 추가한다 (취소하면 아무 일도 없음)
        const choice = await pickLora();
        if (!choice) return;
        onAdd(choice);
    });
    add[rowFlag] = true;
    add.serialize = false;   // 버튼이라 저장할 값이 없다
    paint(add, on ? BOX_COLORS.action : BOX_COLORS.grey);
    made.push(add);

    // 호출한 쪽이 더 붙이고 싶은 줄(체크리스트의 "항목 삭제")
    for (const w of extra) {
        w[rowFlag] = true;
        made.push(w);
    }

    // 영역을 감싸는 테두리.
    // 높이를 차지하지 않는 위젯을 맨 앞에 두고, 거기서 영역 전체를 한 번에 그린다.
    // 각 위젯의 last_y 는 프론트엔드가 배치할 때 채워준다.
    const first = made[0];
    const last = made[made.length - 1];
    const boxW = {
        type: "custom",
        name: "fla_lora_box",
        serialize: false,   // 값이 없는 표시용 위젯
        computeSize() {
            return [0, 0];
        },
        draw(ctx, n, widgetWidth, posY) {
            const width = node.size?.[0] ?? widgetWidth;
            const top = (first.last_y ?? posY) - 3;
            // 마지막 줄의 높이는 종류에 따라 다르므로 실제 크기를 물어본다
            const lastH = last.computeSize?.()?.[1] ?? ROW_HEIGHT;
            const bottom = (last.last_y ?? top) + lastH + 3;
            if (bottom <= top) return;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(6, top, Math.max(20, width - 12), bottom - top, 6);
            ctx.strokeStyle = on ? BOX_COLORS.edgeOn : BOX_COLORS.edgeOff;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        },
    };
    boxW[rowFlag] = true;

    // 박스는 다른 줄보다 먼저 그려져야 하므로 맨 앞에 둔다
    return [boxW, ...made];
}
