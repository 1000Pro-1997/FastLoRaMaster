import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { t } from "./fla_i18n.js";
import { mouseGate, dropCaptureFor, guardNodeWidgets } from "./fla_widget_mouse.js";
// 로라 목록 UI 는 FLALoraTheme 과 공용이다. 고치려면 fla_lora_ui.js 를 본다.
import {
    ROW_HEIGHT, LAYOUT_PAD, findWidget, drawRoundedRect,
    drawToggle, drawNumber, fitText, inBounds, isNodeOff,
    buildLoraBox,
} from "./fla_lora_ui.js";

const NODE_NAME = "FLAChecklist";

// ─────────── 그리기 헬퍼 ───────────

// 프롬프트 입력 칸 높이. 고정값이라 노드가 제멋대로 늘어나지 않는다.
// 내용이 넘치면 칸 안에서 스크롤된다.
// 강도 조절부(◀ 0.90 ▶) 치수. drawNumber 가 쓴다.

// 구역별 색.
const COLORS = {
    header: "#2d4a5e",    // 머리글 줄
    action: "#4a3a2a",    // 추가 버튼
    panel: "#242a30",     // 설정 패널 바탕
    panelEdge: "#3f5a70", // 설정 패널 테두리
    danger: "#5e2f2f",    // 삭제
};

/** 항목 제목이 비었을 때 프롬프트 앞부분으로 대신 보여준다. */
function itemLabel(item) {
    const title = (item.title ?? "").trim();
    if (title) return title;
    const prompt = (item.prompt ?? "").trim().replace(/\s+/g, " ");
    if (prompt) return prompt.length > 40 ? prompt.slice(0, 39) + "…" : prompt;
    return t("untitledItem");
}

// ─────────── 상태 ───────────

/** items_data 위젯에 들어 있는 항목 목록을 읽는다. 없거나 깨졌으면 빈 목록. */
function readItems(node) {
    const raw = node.flaHidden?.items_data?.value
        ?? findWidget(node, "items_data")?.value;
    if (typeof raw !== "string" || !raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? normalizeItems(parsed) : [];
    } catch (e) {
        return [];
    }
}

/** 파이썬으로 넘어갈 숨은 위젯을 갱신한다. */
function syncHidden(node) {
    if (node.flaHidden?.items_data) {
        node.flaHidden.items_data.value = JSON.stringify(node.flaItems ?? []);
    }
}

/** 항목 하나를 새로 만든다. */
function newItem() {
    return { title: "", prompt: "", loras: [], enabled: false };
}

/** 외부에서 온 항목 목록을 정리한다. 파이썬 checklist.normalize 와 짝이다. */
function normalizeItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((it) => ({
        title: typeof it?.title === "string" ? it.title : "",
        prompt: typeof it?.prompt === "string" ? it.prompt : "",
        loras: Array.isArray(it?.loras)
            ? it.loras
                .filter((l) => typeof l?.path === "string" && l.path.trim())
                .map((l) => ({
                    path: l.path.trim(),
                    strength: typeof l.strength === "number" ? l.strength : 1.0,
                    enabled: l.enabled !== false,
                }))
            : [],
        enabled: it?.enabled === true,
    }));
}

// ─────────── 위젯 만들기 ───────────

/** 체크리스트 한 줄.
 *  왼쪽 토글 / 가운데 제목 / 오른쪽 ⚙ 설정 버튼. */
function makeItemRow(node, item, idx) {
    return {
        type: "custom",
        name: "fla_item_" + idx,
        serialize: false,   // 값이 없는 표시용 위젯
        flaRow: true,
        tooltip: t("tipItemRow"),
        bounds: { toggle: null, title: null, gear: null },

        computeSize() {
            return [0, ROW_HEIGHT - LAYOUT_PAD];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const margin = 10;
            const inner = margin * 0.33;
            const midY = posY + height * 0.5;
            const width = node.size?.[0] ?? widgetWidth;
            const off = isNodeOff(node);
            const open = node.flaOpen === idx;
            const live = item.enabled && !off;

            drawRoundedRect(
                ctx, margin, posY, width - margin * 2, height,
                live ? "#2a3a2c" : "#2a2a2a",
                open ? COLORS.panelEdge : (live ? "#3f6146" : "#3a3a3a"),
            );

            let posX = margin;
            this.bounds.toggle = drawToggle(ctx, posX, posY, height, item.enabled, !off);
            posX += this.bounds.toggle[1] + inner;

            ctx.save();
            if (!item.enabled) ctx.globalAlpha = 0.45;
            else if (off) ctx.globalAlpha = 0.5;

            // 오른쪽 끝: 설정 버튼
            const gearW = 16;
            const gearX = width - margin - inner - gearW;
            ctx.fillStyle = open ? "#9bd" : "#999";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("⚙", gearX + gearW / 2, midY);
            this.bounds.gear = [gearX, gearW];

            // 가운데: 제목.
            // 설정이 열려 있으면 같은 자리에 DOM 입력칸이 얹히므로 글자는 그리지 않는다.
            const titleLeft = posX;
            const titleW = Math.max(10, gearX - inner * 2 - titleLeft);
            if (!open) {
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                ctx.textAlign = "left";
                ctx.fillText(fitText(ctx, itemLabel(item), titleW), titleLeft, midY);
            }
            this.bounds.title = [titleLeft, titleW];
            // 제목 입력칸이 이 자리를 쓰도록 좌표를 남겨둔다
            this.flaTitleBox = [titleLeft, titleW];

            // 로라가 달린 항목은 오른쪽에 켜짐/꺼짐 개수를 나눠 표시한다.
            // 3개 중 2개가 켜져 있으면 "L2 L1" 처럼 노랑·회색으로 나란히 나온다.
            if (item.loras.length) {
                const on = item.loras.filter((l) => l.enabled).length;
                const off = item.loras.length - on;

                ctx.save();
                ctx.textAlign = "right";
                ctx.font = "10px Arial";

                // 오른쪽 끝부터 왼쪽으로 쌓는다. 꺼진 쪽이 뒤에 온다.
                let right = gearX - inner * 2;
                if (off) {
                    const text = `L${off}`;
                    ctx.fillStyle = "#777";      // 회색 — 꺼진 로라
                    ctx.fillText(text, right, midY);
                    right -= ctx.measureText(text).width + 4;
                }
                if (on) {
                    ctx.fillStyle = "#d9b43a";   // 노랑 — 켜진 로라
                    ctx.fillText(`L${on}`, right, midY);
                }
                ctx.restore();
            }

            ctx.restore();
        },

        activate(pos) {
            if (inBounds(pos, this.bounds.gear)) {
                // 같은 항목을 다시 누르면 닫는다
                node.flaOpen = (node.flaOpen === idx) ? -1 : idx;
                rebuildAfterPointer(node);
                return true;
            }
            // 설정이 열려 있으면 제목 자리는 입력칸이 차지하므로 토글에서 제외한다
            const hit = inBounds(pos, this.bounds.toggle)
                || (node.flaOpen !== idx && inBounds(pos, this.bounds.title));
            if (hit) {
                item.enabled = !item.enabled;
                syncHidden(node);
                node.setDirtyCanvas(true, true);
                return true;
            }
            return false;
        },

        mouse(event, pos, n) {
            // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
            const gate = mouseGate(event);
            if (gate === "down") return;
            if (gate !== "up") return false;
            return this.activate(pos);
        },
    };
}

/** 좌우로 나뉜 버튼 한 줄을 만든다. [라벨, 색, 동작] 을 받는다. */
function makeButtonRow(node, name, buttons) {
    return {
        type: "custom",
        name,
        serialize: false,   // 값이 없는 표시용 위젯
        flaRow: true,
        bounds: [],

        computeSize() {
            return [0, ROW_HEIGHT - LAYOUT_PAD];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const margin = 10;
            const gap = 6;
            const width = node.size?.[0] ?? widgetWidth;
            const midY = posY + height * 0.5;
            const each = (width - margin * 2 - gap * (buttons.length - 1)) / buttons.length;

            ctx.save();
            ctx.textBaseline = "middle";
            ctx.textAlign = "center";
            this.bounds = [];

            buttons.forEach((btn, i) => {
                const x = margin + (each + gap) * i;
                drawRoundedRect(ctx, x, posY, each, height, btn[1], btn[3] ?? null);
                this.bounds.push([x, each]);
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                ctx.fillText(fitText(ctx, btn[0], each - 8), x + each / 2, midY);
            });

            ctx.restore();
        },

        activate(pos, event) {
            for (let i = 0; i < this.bounds.length; i++) {
                if (inBounds(pos, this.bounds[i])) {
                    buttons[i][2](event);
                    return true;
                }
            }
            return false;
        },

        mouse(event, pos, n) {
            // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
            const gate = mouseGate(event);
            if (gate === "down") return;
            if (gate !== "up") return false;
            return this.activate(pos, event);
        },
    };
}

/** 설정 패널을 감싸는 테두리. 높이를 차지하지 않고 영역만 그린다. */
function makePanelBox(node, first, last) {
    return {
        type: "custom",
        name: "fla_panel_box",
        serialize: false,   // 값이 없는 표시용 위젯
        flaRow: true,
        // 프론트엔드가 배치할 때 높이에 +4 를 더하므로(_arrangeWidgets)
        // -4 를 돌려줘야 실제로 0 이 된다. 그러지 않으면 이 줄이 4px 를 먹고,
        // getWidgetOnPos 에서 mouse 없는 이 위젯이 먼저 잡혀 클릭이 사라진다.
        computeSize() {
            return [0, -4];
        },
        draw(ctx, n, widgetWidth, posY) {
            const width = node.size?.[0] ?? widgetWidth;
            const top = (first.last_y ?? posY) - 4;
            // 마지막 위젯의 높이는 종류에 따라 다르므로 실제 크기를 물어본다
            const lastH = last.computeSize?.()?.[1] ?? ROW_HEIGHT;
            const bottom = (last.last_y ?? top) + lastH + 4;
            if (bottom <= top) return;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(6, top, Math.max(20, width - 12), bottom - top, 6);
            ctx.fillStyle = COLORS.panel;
            ctx.fill();
            ctx.strokeStyle = COLORS.panelEdge;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        },
    };
}

/** 캔버스 위에 얹는 DOM 입력 칸.
 *
 *  ComfyUI 의 multiline STRING 위젯과 같은 방식이다.
 *  addWidget("textarea", ...) 는 Node 2.0 전용이라 옛 캔버스에서는
 *  "Textarea: Node 2.0 전용" 자리표시만 나오므로 쓰지 않는다.
 *
 *  DOM 요소는 캔버스 좌표와 따로 놀기 때문에 draw 때마다 위치를 맞춰준다.
 *  height 를 함수로 주면 남는 공간에 맞춰 늘어나는 칸이 된다.
 */
function makeInputWidget(node, opts) {
    const multiline = opts.multiline === true;
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) input.type = "text";
    // rows 기본값(2)이 최소 높이로 잡히지 않도록 1 로 둔다. 실제 높이는 style 로 준다.
    else input.rows = 1;
    input.className = multiline ? "comfy-multiline-input" : "comfy-input";
    input.value = opts.get() ?? "";
    input.placeholder = opts.placeholder ?? "";
    input.spellcheck = false;
    Object.assign(input.style, {
        position: "absolute",
        // 좌표가 정해지기 전에는 감춰둔다.
        // visibility 로 감추면 자리와 크기는 이미 잡혀 있어서, 보이는 순간
        // 엉뚱한 자리에서 커졌다 줄어드는 것처럼 보이지 않는다.
        visibility: "hidden",
        left: "-9999px",     // 첫 프레임에 화면 안에서 깜빡이지 않도록 밖에 둔다
        top: "-9999px",
        width: "0px",
        height: "0px",
        // textarea 는 rows 기본값(보통 2줄)이 최소 높이로 잡힌다.
        // min/max 를 함께 0 으로 두지 않으면 자리를 잡기 전 그 높이로 한 번 보인다.
        minHeight: "0px",
        maxHeight: "0px",
        boxSizing: "border-box",
        resize: "none",
        overflowY: multiline ? "auto" : "hidden",
        // 여러 줄 칸은 글자가 위에서부터 채워지게 한다
        verticalAlign: "top",
        lineHeight: "1.35",
        background: "#222",
        color: "#DDD",
        border: "1px solid #3f5a70",
        borderRadius: "4px",
        padding: "2px 6px",
        fontFamily: "inherit",
        // 테마의 전환 효과가 남아 있으면 크기·위치가 스르륵 따라와 잔상이 생긴다
        transition: "none",
        animation: "none",
    });
    document.body.append(input);

    input.addEventListener("input", () => {
        opts.set(input.value);
        syncHidden(node);
        // 제목이 비면 목록에 프롬프트 앞부분이 보이므로 다시 그린다
        node.setDirtyCanvas(true, true);
    });
    // 캔버스가 클릭과 키 입력을 가로채지 않도록 막는다
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => e.stopPropagation());
    // 한 줄 입력에서 엔터를 누르면 입력을 끝낸다
    if (!multiline) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
        });
    }

    return {
        type: "custom",
        name: opts.name,
        serialize: false,   // 값은 items_data 안에 들어간다
        flaRow: true,
        flaElement: input,  // 패널을 다시 그릴 때 치우기 위해 들고 있는다
        inputEl: input,

        computeSize() {
            // overlay 는 다른 줄 위에 겹쳐 그리므로 자기 높이를 갖지 않는다.
            // +4 가 더해지므로 -4 를 돌려줘야 실제 높이가 0 이 된다.
            if (opts.overlay) return [0, -4];
            return [0, typeof opts.height === "function" ? opts.height() : opts.height];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            // 노드가 접혔거나 그래프에서 빠지면 감춘다
            if (node.flags?.collapsed || !node.graph) {
                input.style.visibility = "hidden";
                return;
            }
            // rebuild 도중에는 노드 크기와 줄 위치가 아직 확정되지 않았다.
            // 이때 자리를 잡으면 엉뚱한 곳에 나타났다가 제자리로 튀어 보인다.
            if (node.flaBuilding) {
                input.style.visibility = "hidden";
                return;
            }

            // 겹쳐 그리는 칸은 대상 줄의 좌표를 그대로 쓴다
            const over = opts.overlay?.();
            if (opts.overlay && !over) {
                input.style.visibility = "hidden";
                return;
            }
            if (over) {
                posY = over.y;
                height = over.h;
            }

            const margin = over ? over.x : 18;
            const width = node.size?.[0] ?? widgetWidth;
            const canvas = app.canvas;
            const scale = canvas?.ds?.scale ?? 1;
            const offset = canvas?.ds?.offset ?? [0, 0];
            const rect = canvas?.canvas?.getBoundingClientRect?.();
            if (!rect) return;

            // 캔버스 좌표 → 화면 좌표.
            //
            // node.pos 는 제목 표시줄 아래(노드 몸통)를 가리키고 posY 는 거기서부터
            // 잰 값이므로 그대로 더하면 된다. 캔버스 자체가 rect 만큼 밀려 있고
            // ds.offset 만큼 이동, ds.scale 만큼 확대돼 있다.
            const x = rect.left + (node.pos[0] + offset[0] + margin) * scale;
            const y = rect.top + (node.pos[1] + offset[1] + posY) * scale;

            const boxW = Math.max(0, over ? over.w : width - margin * 2) * scale;
            const boxH = height * scale;

            // ① 자리부터 옮긴다.
            //    크기를 먼저 주면 아직 옛 자리에 있는 채로 커졌다가 이동하므로
            //    "위에서 크게 나타났다가 제자리로 가며 작아지는" 것처럼 보인다.
            input.style.left = `${x}px`;
            input.style.top = `${y}px`;

            // ② 자리를 잡은 뒤에 크기를 준다.
            //    height 하나만 주면 테마 CSS 기본값에 밀릴 수 있어 셋을 함께 못박는다.
            input.style.width = `${boxW}px`;
            input.style.height = `${boxH}px`;
            input.style.minHeight = `${boxH}px`;
            input.style.maxHeight = `${boxH}px`;

            // ③ 확대율에 맞춰 글자와 안쪽 여백을 맞춘다
            input.style.fontSize = `${11 * scale}px`;
            input.style.padding = `${2 * scale}px ${6 * scale}px`;
            input.style.borderRadius = `${4 * scale}px`;
            input.style.zIndex = 1;
            // 너무 작아지면 읽을 수 없으므로 숨긴다(ComfyUI 기본 동작과 같다)
            if (scale < 0.5) {
                input.style.visibility = "hidden";
                return;
            }
            // 캔버스 밖으로 밀려나면 감춘다. DOM 요소는 캔버스에 잘리지 않아
            // 그냥 두면 화면 위에 둥둥 떠 보인다.
            if (y + boxH < rect.top || y > rect.bottom
                || x + boxW < rect.left || x > rect.right) {
                input.style.visibility = "hidden";
                return;
            }

            // 좌표가 확정된 뒤에야 보여준다
            input.style.visibility = "visible";
        },

        onRemove() {
            input.remove();
        },
    };
}

/** 제목 입력 칸.
 *
 *  설정을 펼치면 **항목 줄의 제목 자리에 그대로 겹쳐** 나타난다.
 *  줄을 따로 만들지 않으므로 패널이 한 덩어리로 보인다.
 *  row 는 겹쳐 그릴 대상(항목 줄) 위젯이다.
 */
function makeTitleWidget(node, item, row) {
    return makeInputWidget(node, {
        name: "fla_title",
        placeholder: t("itemTitle"),
        height: ROW_HEIGHT,
        // 항목 줄이 그려지며 남겨둔 좌표를 따라간다.
        // 아직 한 번도 안 그려졌으면 null 을 줘서 잠시 숨긴다.
        overlay: () => {
            const box = row.flaTitleBox;
            if (!box || row.last_y == null) return null;
            return { x: box[0], w: box[1], y: row.last_y, h: ROW_HEIGHT };
        },
        get: () => item.title ?? "",
        set: (v) => { item.title = v; },
    });
}

/** 항목 하나가 쓰는 프롬프트 위젯을 얻는다. 없으면 만든다.
 *
 *  항목마다 **자기 위젯을 따로** 가진다. 하나를 돌려쓰면 위젯이 어느 항목을
 *  가리키는지가 열고 닫는 순서에 따라 달라져서, 닫은 뒤 뒤늦게 들어온 입력이
 *  엉뚱한 항목에 쓰이는 문제가 생긴다.
 *
 *  ComfyUI 기본 multiline 위젯이라 FLA 로라 테마의 프롬프트 칸과 똑같이
 *  최소 높이가 있고 노드를 늘리면 함께 늘어난다.
 *
 *  값의 정본은 items_data 다. 이 위젯들은 화면 편집용이라 저장하지 않는다.
 */
function itemPromptWidget(node, item, idx) {
    node.flaPromptWidgets = node.flaPromptWidgets ?? [];

    let w = node.flaPromptWidgets[idx];
    if (!w) {
        const created = ComfyWidgets.STRING(
            node,
            `fla_item_prompt_${idx}`,
            ["STRING", { default: "", multiline: true, placeholder: t("itemPrompt") }],
            app,
        );
        w = created?.widget ?? created;
        if (!w) return null;
        node.flaPromptWidgets[idx] = w;
    }

    const at = node.widgets.indexOf(w);
    if (at >= 0) node.widgets.splice(at, 1);

    w.flaRow = true;
    w.serialize = false;
    w.value = item.prompt ?? "";
    w.callback = (value) => {
        item.prompt = value ?? "";
        syncHidden(node);
        node.setDirtyCanvas(true, true);
    };
    const el = w.inputEl ?? w.element;
    if (el && !el.flaBound) {
        el.flaBound = true;
        el.addEventListener("input", () => {
            item.prompt = el.value;
            syncHidden(node);
        });
    }
    if (el) el.style.display = "";
    w.hidden = false;
    if (w.options) w.options.hidden = false;
    return w;
}

function hideItemPromptWidgets(node, keep) {
    for (const w of node.flaPromptWidgets ?? []) {
        if (!w || w === keep) continue;
        w.hidden = true;
        if (w.options) w.options.hidden = true;
        const el = w.inputEl ?? w.element;
        if (el) el.style.display = "none";
    }
}

function dropPromptWidget(node, idx) {
    const list = node.flaPromptWidgets;
    if (!list) return;
    const w = list[idx];
    if (w) {
        const el = w.inputEl ?? w.element;
        if (el) el.remove();
        const at = node.widgets.indexOf(w);
        if (at >= 0) node.widgets.splice(at, 1);
    }
    list.splice(idx, 1);
}

/** 머리글 줄. 전체 토글 + "n/m 켜짐" 표시. */
function makeHeaderRow(node) {
    return {
        type: "custom",
        name: "fla_header",
        serialize: false,   // 값이 없는 표시용 위젯
        flaRow: true,
        tooltip: t("tipHeaderRow"),
        bounds: { toggle: null, lora: null },

        computeSize() {
            return [0, ROW_HEIGHT - LAYOUT_PAD];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const margin = 10;
            const inner = margin * 0.33;
            const midY = posY + height * 0.5;
            const width = node.size?.[0] ?? widgetWidth;
            const on = !isNodeOff(node);
            const lorasOn = node.flaHidden?.loras_enabled?.value !== false;

            const items = node.flaItems ?? [];
            const onCount = items.filter((i) => i.enabled).length;

            drawRoundedRect(ctx, margin, posY, width - margin * 2, height,
                on ? "#2b3b4a" : "#2a2a2a",
                on ? "#3f5a70" : "#3a3a3a");

            let posX = margin;
            this.bounds.toggle = drawToggle(ctx, posX, posY, height, on);
            posX += this.bounds.toggle[1] + inner;

            ctx.save();
            if (!on) ctx.globalAlpha = 0.45;
            ctx.textBaseline = "middle";

            // 오른쪽 끝: 로라 일괄 토글. 로라가 하나도 없으면 그리지 않는다.
            const hasLora = items.some((i) => i.loras.length);
            let rightEdge = width - margin - inner;
            if (hasLora) {
                const label = "LoRA";
                ctx.font = "11px Arial";
                const labelW = ctx.measureText(label).width;
                const boxW = labelW + 8;
                const boxX = rightEdge - boxW;
                drawRoundedRect(ctx, boxX, posY + 4, boxW, height - 8,
                    lorasOn ? "#2f4f34" : "#3a3a3a",
                    lorasOn ? "#4a7a52" : "#4a4a4a");
                ctx.fillStyle = lorasOn ? "#cec" : "#888";
                ctx.textAlign = "center";
                ctx.fillText(label, boxX + boxW / 2, midY);
                this.bounds.lora = [boxX, boxW];
                rightEdge = boxX - inner * 2;
            } else {
                this.bounds.lora = null;
            }

            ctx.font = "";
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
            ctx.textAlign = "left";
            const text = `${t("checklist")}  (${onCount}/${items.length})`;
            ctx.fillText(fitText(ctx, text, Math.max(10, rightEdge - posX)), posX, midY);

            ctx.restore();
        },

        activate(pos) {
            if (inBounds(pos, this.bounds.lora)) {
                const w = node.flaHidden?.loras_enabled;
                if (w) {
                    w.value = w.value === false;
                    w.callback?.(w.value);
                }
                node.setDirtyCanvas(true, true);
                return true;
            }
            if (inBounds(pos, this.bounds.toggle)) {
                const w = node.flaHidden?.prompt_enabled;
                if (w) {
                    w.value = w.value === false;
                    w.callback?.(w.value);
                }
                rebuildAfterPointer(node);
                return true;
            }
            return false;
        },

        mouse(event, pos, n) {
            // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
            const gate = mouseGate(event);
            if (gate === "down") return;
            if (gate !== "up") return false;
            return this.activate(pos);
        },
    };
}

// ─────────── 전체 다시 그리기 ───────────

/** 화면 전체를 다시 만든다.
 *  머리글 → 항목들(열려 있으면 그 아래 설정 패널) → 추가 버튼. */
function rebuild(node) {
    // 위젯을 새로 만들면 프론트엔드가 잡아둔 옛 위젯은 죽은 참조가 된다
    dropCaptureFor(node);

    // 크기와 줄 위치가 확정될 때까지 DOM 입력칸을 감춰둔다
    node.flaBuilding = true;

    // 다시 그리는 동안 노드 크기가 튀지 않도록 현재 크기를 기억해둔다
    const keepWidth = node.size?.[0] ?? 340;
    const keepHeight = node.size?.[1] ?? 0;

    // 파이썬 위젯만 남기고 화면용 위젯을 걷어낸다.
    // 걷어내기 전에 DOM 요소를 붙여둔 위젯을 정리한다.
    // 그냥 버리면 <textarea> 가 화면에 남는다.
    for (const w of node.widgets ?? []) {
        if (w.flaRow && w.flaElement) w.flaElement.remove();
    }
    node.widgets = (node.widgets ?? []).filter((w) => !w.flaRow);

    const items = node.flaItems ?? [];
    const off = isNodeOff(node);
    let openPrompt = null;
    node.widgets.push(makeHeaderRow(node));

    items.forEach((item, idx) => {
        const row = makeItemRow(node, item, idx);
        node.widgets.push(row);

        // 설정 버튼을 누른 항목 아래에만 편집 패널을 펼친다
        if (node.flaOpen !== idx) return;

        const panel = [];

        // 제목 — 항목 줄의 제목 자리에 겹쳐 나타난다. 높이를 차지하지 않으므로
        // 패널 테두리 계산(panel)에는 넣지 않는다.
        // 목록에서 구분하기 위한 이름일 뿐 출력에는 안 나간다.
        node.widgets.push(makeTitleWidget(node, item, row));

        // 프롬프트 — 이 항목 전용 위젯(ComfyUI 기본 여러 줄 위젯)
        const promptW = itemPromptWidget(node, item, idx);
        if (promptW) {
            node.widgets.push(promptW);
            panel.push(promptW);
            openPrompt = promptW;
        }

        // 로라 적용 토글 ~ 로라 추가 버튼까지 한 박스로. FLALoraTheme 과 공용이다.
        const lorasW = node.flaHidden?.loras_enabled;
        const loraBox = buildLoraBox(node, {
            loras: () => item.loras,
            enabled: () => lorasW?.value !== false,
            setEnabled: (v) => {
                if (lorasW) {
                    lorasW.value = v;
                    lorasW.callback?.(v);
                }
                rebuildAfterPointer(node);
            },
            onAdd: (choice) => {
                item.loras.push({ path: choice, strength: 0.9, enabled: true });
                rebuildAfterPointer(node);
            },
            rowFlag: "flaRow",
            rowOpts: {
                margin: 18,
                onChange: () => syncHidden(node),
                onRemove: (li) => {
                    item.loras.splice(li, 1);
                    rebuildAfterPointer(node);
                },
            },
        });
        // addWidget 이 이미 넣어둔 것들을 걷어내고 박스 순서대로 다시 넣는다
        node.widgets = node.widgets.filter((w) => !loraBox.includes(w));
        node.widgets.push(...loraBox);
        panel.push(...loraBox);

        // 박스 아래: 항목 삭제
        const actions = makeButtonRow(node, "fla_item_actions", [
            ["🗑 " + t("removeItem"), COLORS.danger, () => {
                node.flaItems.splice(idx, 1);
                dropPromptWidget(node, idx);
                node.flaOpen = -1;
                rebuildAfterPointer(node);
            }],
        ]);
        node.widgets.push(actions);
        panel.push(actions);

        // 패널을 감싸는 배경. 다른 패널 위젯보다 먼저 그려야 하므로 앞에 끼운다.
        const box = makePanelBox(node, panel[0], panel[panel.length - 1]);
        node.widgets.splice(node.widgets.indexOf(panel[0]), 0, box);
    });

    // 맨 아래: 항목 추가
    const add = makeButtonRow(node, "fla_add", [
        ["＋ " + t("addItem"), off ? "#2a2a2a" : COLORS.action, () => {
            node.flaItems.push(newItem());
            // 새 항목은 바로 편집할 수 있도록 펼쳐준다
            node.flaOpen = node.flaItems.length - 1;
            rebuildAfterPointer(node);
        }],
    ]);
    node.widgets.push(add);

    hideItemPromptWidgets(node, openPrompt);

    syncHidden(node);

    // 폭은 사용자가 정한 값을 그대로 둔다.
    node.size[0] = keepWidth;

    // 높이는 줄 수에 맞춰 계산하되, 사용자가 늘려둔 여백은 존중한다.
    //
    // 여백(slack)은 "직전 크기 - 직전에 필요했던 높이" 다.
    // 로라를 추가·삭제하면 필요한 높이가 달라지므로, 직전 값을 기준으로 재야
    // 늘려둔 여백이 그대로 남는다. 여기서 직전 값을 안 쓰면 로라 줄만큼
    // 여백이 잘못 계산돼 노드가 덜 줄거나 더 줄어든다.
    const needed = node.computeSize?.()?.[1] ?? keepHeight;
    const prevNeeded = node.flaNeededHeight ?? needed;
    const slack = Math.max(0, keepHeight - prevNeeded);
    node.size[1] = needed + slack;
    node.flaNeededHeight = needed;

    // 어느 위젯이든 예외를 던지면 캡처가 남아 전부 먹통이 된다. 한 번에 감싼다.
    guardNodeWidgets(node);

    // 크기가 정해졌으니 이제 입력칸이 제자리를 잡아도 된다
    node.flaBuilding = false;

    node.setDirtyCanvas(true, true);
}

/** 포인터 콜백이 끝난 뒤 화면 위젯을 교체한다.
 *  콜백 안에서 즉시 교체하면 ComfyUI가 제거된 위젯을 활성 상태로 계속 잡는다. */
function rebuildAfterPointer(node) {
    if (node.flaRebuildPending) return;
    node.flaRebuildPending = true;
    setTimeout(() => {
        node.flaRebuildPending = false;
        if (node.graph) rebuild(node);
    }, 0);
}

app.registerExtension({
    name: "FLA.Checklist",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            const node = this;

            // onConfigure 가 먼저 실행되는 경우가 있다(워크플로를 다시 열 때).
            // 그때는 items_data 에 복원된 값이 이미 들어 있으므로 덮어쓰면 안 된다.
            // 무턱대고 [] 로 두면 아래 rebuild 의 syncHidden 이 빈 값을 써버려
            // 새로고침할 때마다 항목이 통째로 사라진다.
            node.flaItems = readItems(node);
            node.flaOpen = -1;   // 펼쳐진 항목 번호. -1 이면 모두 닫힘.

            // 파이썬으로 값을 넘기기만 하는 위젯은 화면에서 감춘다.
            // node.widgets 에서 빼버리면 실행 시 값이 전달되지 않으므로
            // 배열에는 남겨두고 높이와 그리기만 없앤다.
            node.flaHidden = {};
            const hide = (name) => {
                const w = findWidget(node, name);
                if (!w) return;
                node.flaHidden[name] = w;
                // 나중에 되살릴 수 있도록 원본을 보관해둔다(prompt 가 쓴다)
                w.flaOrig = {
                    computeSize: w.computeSize,
                    computeLayoutSize: w.computeLayoutSize,
                    draw: w.draw,
                };
                w.hidden = true;
                if (w.options) w.options.hidden = true;
                w.computeSize = () => [0, -4];
                w.computeLayoutSize = () => ({
                    minHeight: 0, maxHeight: 0, minWidth: 0,
                });
                w.draw = () => { };
                if (w.element) w.element.style.display = "none";
            };
            hide("items_data");
            hide("prompt");        // 더는 쓰지 않는다. 저장 슬롯만 지킨다.
            hide("delimiter");        // 기본값 ", " 로 충분하다. 속성 패널에서 고칠 수 있다.
            hide("prompt_enabled");   // 머리글 토글이 대신한다
            hide("loras_enabled");    // 머리글의 LoRA 배지가 대신한다

            // 새로 놓을 때만 기본 폭을 준다. 이후에는 사용자가 정한 폭을 건드리지 않는다.
            if (!node.size?.[0]) {
                node.size = [340, node.size?.[1] ?? 0];
            }

            rebuild(node);
        };

        // 노드를 지우면 붙여둔 DOM 요소도 함께 치운다
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            for (const w of this.widgets ?? []) {
                if (w.flaElement) w.flaElement.remove();
            }
            onRemoved?.apply(this, arguments);
        };

        // 워크플로 저장 시 항목을 함께 담는다.
        // 정본은 파이썬 위젯 items_data 지만, 예전 워크플로를 위해 남긴다.
        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            o.flaItems = this.flaItems ?? [];
        };

        // 워크플로를 다시 열 때 항목을 복원한다
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (o) {
            const node = this;
            onConfigure?.apply(this, arguments);

            // 파이썬 위젯(items_data)이 정본이다.
            // 비어 있으면 예전 워크플로가 남긴 flaItems 를 쓴다.
            const restored = readItems(node);
            node.flaItems = restored.length
                ? restored
                : normalizeItems(o.flaItems ?? []);
            node.flaOpen = -1;

            // 워크플로에 저장된 크기를 그대로 되살린다.
            //
            // flaNeededHeight 는 rebuild 가 "지금 내용에 필요한 높이"로 이미 채워뒀다.
            // 여기서 다시 계산해 덮어쓰면 안 된다. 크기를 saved 로 바꾼 뒤의 값이라
            // 다음 rebuild 때 여백이 잘못 잡힌다.
            const saved = o.size ? [o.size[0], o.size[1]] : null;
            rebuild(node);
            if (saved) {
                node.size[0] = saved[0];
                node.size[1] = saved[1];
            }
        };
    },
});
