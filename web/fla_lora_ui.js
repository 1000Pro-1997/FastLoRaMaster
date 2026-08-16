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
import { mouseGate, releaseWidgetCaptureSoon, guardMouse } from "./fla_widget_mouse.js";

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
    del: "#a66",         // 삭제 ✕ (구버전 호환)
    delBg: "#7a2f2f",    // 삭제 버튼 바탕
    delEdge: "#a04a4a",  // 삭제 버튼 테두리
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

    // 강도 숫자를 좌우로 끌어 조절한다
    const drag = makeDragValue({ step: 6, amount: 0.01 });

    const widget = {
        type: "custom",
        name: "fla_lora_" + idx,
        serialize: false,   // 값이 없는 표시용 위젯
        value: lora,
        // 그 줄의 y. 인라인 입력칸을 제자리에 띄우려면 필요하다.
        lastY: 0,
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
            this.lastY = posY;
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

            // 오른쪽 끝: 삭제 버튼. 빨간 둥근 정사각형에 흰 ✕.
            // 한 변을 줄 높이에서 위아래 여백을 뺀 값으로 잡아 정사각형을 만든다.
            const delW = height - 8;
            const delX = width - margin - inner - delW;
            drawRoundedRect(ctx, delX, posY + 4, delW, delW,
                ROW_COLORS.delBg, ROW_COLORS.delEdge);
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "11px Arial";
            ctx.fillText("✕", delX + delW / 2, midY);
            ctx.font = "";
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
            const gate = mouseGate(event);

            // 숫자 위에서 누르면 드래그 조절을 준비한다.
            // 앞선 드래그가 up 을 놓쳐 갇혀 있어도 여기서 초기화되어 회복된다.
            if (gate === "down") {
                drag.cancel();
                if (inBounds(pos, this.bounds.num)) drag.begin(pos);
                return;
            }

            // 누른 채 좌우로 움직이면 0.01 씩 바뀐다
            if (gate === null && drag.active) {
                const delta = drag.move(pos);
                if (delta) {
                    lora.strength = roundStrength(lora.strength + delta);
                    onChange();
                    node.setDirtyCanvas(true, true);
                }
                return true;
            }

            if (gate !== "up") return false;

            // up 이 오면 드래그 상태는 무조건 푼다.
            // 여기서 안 풀면(예: rebuild 로 이 위젯이 교체돼 up 을 놓치면)
            // 다음 클릭이 계속 "드래그였다"로 잡혀 아무것도 안 눌린다.
            const wasDragged = drag.active && drag.end();
            // 실제로 값이 움직였을 때만 클릭으로 치지 않는다(입력칸이 뜨면 안 된다)
            if (wasDragged) return true;

            return handleLoraRowClick(node, lora, this, pos, {
                node, widgetY: this.lastY,
                onChange, onRemove: () => onRemove(idx),
            });
        },
    };

    widget[rowFlag] = true;
    // 예외가 새면 캡처가 남아 다른 위젯이 전부 먹통이 된다
    return guardMouse(widget);
}

/** 로라 행 클릭 처리. 토글 · 삭제 · 강도 · 이름(교체) 순으로 본다. */
export function handleLoraRowClick(node, lora, widget, pos, opts = {}) {
    const { onChange = () => { }, onRemove = () => { }, widgetY } = opts;
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
        // 그 자리에 입력칸을 띄운다
        inlineEditNumber(node, widget.bounds.num, widgetY ?? widget.lastY ?? 0,
            lora.strength, (v) => {
                lora.strength = v;
                touched();
            });
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
    // 머리글은 로라 행과 같은 여백을 써야 세로줄이 맞는다
    const margin = rowOpts.margin ?? 10;

    const list = loras();
    const onCount = list.filter((l) => l.enabled).length;
    // 노드 전체가 꺼져 있으면 로라 영역도 회색으로 본다
    const on = enabled() && !isNodeOff(node);

    const made = [];

    // ① 머리글 줄 — 토글 · "로라 적용 (n/m)" · 전체 강도 조절
    //    캡슐(배경)을 그리지 않아 박스 안에서 제목처럼 보이게 한다.
    const headDrag = makeDragValue({ step: 6, amount: 0.01 });
    const allW = {
        type: "custom",
        name: "fla_lora_head",
        serialize: false,   // 실제 값은 파이썬 쪽 위젯이 들고 있다
        tooltip,
        lastY: 0,
        bounds: { toggle: null, all: null, dec: null, inc: null },

        computeSize() {
            return [0, ROW_HEIGHT];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const midY = posY + height * 0.5;
            const width = node.size?.[0] ?? widgetWidth;
            this.lastY = posY;

            // 캡슐 없음: 바탕을 칠하지 않는다
            let posX = margin;
            this.bounds.toggle = drawToggle(ctx, posX, posY, height, on);
            posX += this.bounds.toggle[1] + INNER;

            ctx.save();
            if (!on) ctx.globalAlpha = 0.45;
            ctx.textBaseline = "middle";

            // 오른쪽: 전체 강도 조절 (◀ 전체 ▶)
            let rightEdge = width - margin - INNER;
            if (list.length) {
                const arrowW = ARROW_W;
                // 조작 방법을 알려주는 표시라 언어와 무관하게 영어로 둔다
                const capLabel = "Drag";
                ctx.font = "11px Arial";
                const capW = ctx.measureText(capLabel).width + 10;

                // ▶ (맨 오른쪽)
                const incX = rightEdge - arrowW;
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                ctx.fill(new Path2D(
                    `M ${incX} ${midY - ARROW_H / 2} l ${arrowW} ${ARROW_H / 2} l -${arrowW} ${ARROW_H / 2} v -${ARROW_H} z`
                ));
                this.bounds.inc = [incX, arrowW];

                // 캡슐 (가운데)
                const capX = incX - INNER - capW;
                drawRoundedRect(ctx, capX, posY + 4, capW, height - 8,
                    "#333a45", "#4a5568");
                ctx.fillStyle = "#bcd";
                ctx.textAlign = "center";
                ctx.fillText(capLabel, capX + capW / 2, midY);
                this.bounds.all = [capX, capW];

                // ◀ (왼쪽)
                const decX = capX - INNER - arrowW;
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                ctx.fill(new Path2D(
                    `M ${decX} ${midY} l ${arrowW} ${ARROW_H / 2} l 0 -${ARROW_H} L ${decX} ${midY} z`
                ));
                this.bounds.dec = [decX, arrowW];

                rightEdge = decX - INNER * 2;
            } else {
                this.bounds.all = this.bounds.dec = this.bounds.inc = null;
            }

            // 왼쪽: 제목
            ctx.font = "";
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
            ctx.textAlign = "left";
            const label = t("applyLora") + `  (${onCount}/${list.length})`;
            ctx.fillText(fitText(ctx, label, Math.max(10, rightEdge - posX)), posX, midY);

            ctx.restore();
        },

        /** 모든 로라 강도를 delta 만큼 함께 올리거나 내린다(상대 이동).
         *  전체 조절로 0 아래까지 끌려가면 효과가 반전돼버리므로 0 에서 멈춘다.
         *  (개별 값은 직접 입력으로 음수를 줄 수 있다) */
        shiftAll(delta) {
            let changed = false;
            for (const l of list) {
                const next = Math.max(0, roundStrength(l.strength + delta));
                if (next !== l.strength) {
                    l.strength = next;
                    changed = true;
                }
            }
            if (changed) {
                rowOpts.onChange?.();
                node.setDirtyCanvas(true, true);
            }
        },

        mouse(event, pos, n) {
            const gate = mouseGate(event);

            if (gate === "down") {
                headDrag.cancel();
                if (inBounds(pos, this.bounds.all)) headDrag.begin(pos);
                return;
            }

            // 캡슐을 누른 채 좌우로 끌면 전체가 상대적으로 움직인다
            if (gate === null && headDrag.active) {
                const delta = headDrag.move(pos);
                if (delta) this.shiftAll(delta);
                return true;
            }

            if (gate !== "up") return false;

            // up 이 오면 무조건 푼다(위와 같은 이유)
            const wasDragged = headDrag.active && headDrag.end();
            if (wasDragged) return true;

            if (inBounds(pos, this.bounds.toggle)) {
                setEnabled(!on);
                return true;
            }
            if (inBounds(pos, this.bounds.dec)) {
                this.shiftAll(-0.05);
                return true;
            }
            if (inBounds(pos, this.bounds.inc)) {
                this.shiftAll(0.05);
                return true;
            }
            return false;
        },
    };
    allW[rowFlag] = true;
    made.push(guardMouse(allW));

    // ② 로라 목록 — 가운데
    list.forEach((lora, idx) => {
        made.push(makeLoraRow(node, lora, idx, {
            rowFlag,
            bypassed: () => !on,
            ...rowOpts,
        }));
    });

    // ③ "＋ 로라 추가" — 맨 아래
    //
    //    addWidget("button") 을 쓰지 않는다. 네이티브 버튼의 콜백은
    //    CanvasPointer 의 onClick 으로 실행되는데, 누르고 있는 시간이
    //    bufferTime(32ms) 을 넘기면서 pointermove 가 한 번이라도 오면
    //    드래그로 승격돼(_setDragStarted) onClick 대신 onDragEnd 가 불린다.
    //    사람이 실제로 누르면 32ms 는 쉽게 넘기므로 콜백이 자주 씹힌다.
    //    그래서 로라 행들과 같은 방식(직접 그리고 up 에서 처리)으로 만든다.
    const openPicker = async () => {
        // 목록에서 고른 뒤에만 줄을 추가한다 (취소하면 아무 일도 없음)
        const choice = await pickLora();
        if (!choice) return;
        onAdd(choice);
    };

    const add = {
        type: "custom",
        name: "fla_lora_add",
        serialize: false,   // 버튼이라 저장할 값이 없다
        bounds: { all: null },

        computeSize() {
            return [0, ROW_HEIGHT];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const width = node.size?.[0] ?? widgetWidth;
            drawRoundedRect(
                ctx, margin, posY, width - margin * 2, height,
                on ? BOX_COLORS.action : BOX_COLORS.grey,
                on ? "#6b5333" : "#3a3a3a",
            );
            ctx.save();
            if (!on) ctx.globalAlpha = 0.45;
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(t("addLora"), width * 0.5, posY + height * 0.5);
            ctx.restore();
            this.bounds.all = [margin, width - margin * 2];
        },

        mouse(event, pos, n) {
            const gate = mouseGate(event);
            if (gate === "down") return;
            if (gate !== "up") return false;
            if (!inBounds(pos, this.bounds.all)) return false;
            openPicker();
            return true;
        },
    };
    add[rowFlag] = true;
    made.push(guardMouse(add));

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
        // 이 줄은 테두리만 그리고 자리는 차지하지 않아야 한다.
        //
        // 그런데 프론트엔드는 배치할 때 computeSize()[1] 에 +4 를 더하므로
        // (_arrangeWidgets) [0,0] 을 돌려줘도 4px 를 먹는다. 그리고
        // getWidgetOnPos 는 widgets 를 앞에서부터 훑는데 이 위젯이 맨 앞이라,
        // 그 4px 띠를 누르면 mouse 가 없는 이 위젯이 먼저 잡힌다.
        // 그러면 클릭이 그대로 사라지고, 프론트엔드는 위젯을 못 찾은 것으로
        // 보고 노드 본체를 끌기 시작한다.
        //
        // computeSize 로 -4 를 돌려주면 +4 와 상쇄되어 높이가 0 이 되고,
        // 히트 영역도 (h - mtop - mbot) = -4 + 2 - 2 = 0 이라 잡히지 않는다.
        computeSize() {
            return [0, -4];
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

/** 강도 값을 0.00~ 범위로 다듬는다. 소수 둘째 자리까지만 쓴다. */
export function roundStrength(v) {
    return Math.round(v * 100) / 100;
}

/** 캔버스 위에 숫자 입력칸을 띄운다.
 *
 *  bounds 는 [x, width](노드 기준), rowY 는 그 줄의 y(노드 기준)다.
 *  DOM 요소라 캔버스와 좌표계가 다르므로 화면 좌표로 변환해 얹는다.
 */
export function inlineEditNumber(node, bounds, rowY, value, onDone) {
    // 입력칸이 캔버스를 덮어 pointerup 이 오지 않는다
    releaseWidgetCaptureSoon();

    const canvas = app.canvas;
    const el = document.createElement("input");
    el.type = "number";
    el.step = "0.05";
    el.value = String(value ?? "");

    const scale = canvas.ds.scale;
    const [ox, oy] = canvas.ds.offset;
    const rect = canvas.canvas.getBoundingClientRect();
    const x = (node.pos[0] + bounds[0] + ox) * scale + rect.left;
    const y = (node.pos[1] + rowY + oy) * scale + rect.top;

    Object.assign(el.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: `${Math.max(40, bounds[1]) * scale}px`,
        height: `${ROW_HEIGHT * scale}px`,
        fontSize: `${12 * scale}px`,
        textAlign: "center",
        background: "#222",
        color: "#DDD",
        border: "1px solid #89B",
        borderRadius: "4px",
        zIndex: 10000,
        outline: "none",
    });

    document.body.appendChild(el);
    el.focus();
    el.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const num = parseFloat(el.value);
        el.remove();
        if (commit && !isNaN(num)) onDone(roundStrength(num));
        node.setDirtyCanvas(true, true);
    };
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
        e.stopPropagation();
    });
    el.addEventListener("blur", () => finish(true));
    return el;
}

/** 좌우 드래그로 값을 조절하는 상태 기계.
 *
 *  프론트엔드는 위젯을 누르고 있는 동안 pointermove 를 그 위젯의 mouse() 로
 *  계속 보내준다(LGraphCanvas.processMouseMove 의 node_widget 분기).
 *  그 점을 이용해 down 에서 시작점을 적어두고, move 마다 x 차이를 값으로 바꾼다.
 *
 *  step 픽셀만큼 움직일 때 amount 만큼 변한다.
 */
export function makeDragValue({ step = 6, amount = 0.01 } = {}) {
    let startX = null;
    let acc = 0;
    return {
        /** 드래그 시작. 눌린 지점을 기억한다. */
        begin(pos) {
            startX = pos[0];
            acc = 0;
        },
        /** 시작한 적 있는지. up 에서 "드래그였는지 클릭이었는지" 판단에 쓴다. */
        get active() {
            return startX !== null;
        },
        /** 실제로 값이 바뀔 만큼 움직였는지. 클릭과 구분한다. */
        get moved() {
            return Math.abs(acc) >= 1;
        },
        /** 이동량을 값 변화로 바꾼다. 바뀐 만큼(delta)을 돌려준다. */
        move(pos) {
            if (startX === null) return 0;
            const dx = pos[0] - startX;
            const steps = Math.trunc(dx / step);
            if (steps === 0) return 0;
            // 소비한 만큼 시작점을 옮겨 남은 픽셀이 누적되게 한다
            startX += steps * step;
            acc += steps;
            return steps * amount;
        },
        end() {
            const wasMoved = this.moved;
            startX = null;
            acc = 0;
            return wasMoved;
        },
        /** 값 판정 없이 상태만 버린다. 놓친 up 에서 회복할 때 쓴다. */
        cancel() {
            startX = null;
            acc = 0;
        },
    };
}
