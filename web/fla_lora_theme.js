import { app } from "../../scripts/app.js";
import { t } from "./fla_i18n.js";
import { pickLora } from "./fla_lora_picker.js";

const NODE_NAME = "FLALoraTheme";
const NONE = "-";   // 언어와 무관한 표식. 파이썬 presets.NONE 과 같아야 한다.

async function api(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).error || msg; } catch (e) { /* 본문 없음 */ }
        throw new Error(msg);
    }
    return res.json();
}

const getThemes = () => api("/fla/themes").then(r => r.themes);
const getPresets = (theme) => api(`/fla/presets?theme=${encodeURIComponent(theme)}`).then(r => r.presets);
const getPreset = (theme, name) => api(`/fla/preset?theme=${encodeURIComponent(theme)}&name=${encodeURIComponent(name)}`);

const post = (url, body) => api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});


/** 위젯을 이름으로 찾는다. */
function findWidget(node, name) {
    return node.widgets?.find(w => w.name === name);
}

/** 현재 노드 상태를 프리셋 데이터로 만든다. */
function collect(node) {
    return {
        prompt: findWidget(node, "prompt")?.value ?? "",
        loras: node.flaLoras.map(l => ({
            path: l.path,
            strength: l.strength,
            enabled: l.enabled,
        })),
    };
}

/** 프리셋 데이터를 노드에 반영한다. */
function applyData(node, data) {
    const promptW = findWidget(node, "prompt");
    if (promptW) promptW.value = data.prompt ?? "";
    node.flaLoras = (data.loras ?? []).map(l => ({
        path: l.path,
        strength: typeof l.strength === "number" ? l.strength : 1.0,
        enabled: l.enabled !== false,
    }));
    syncHidden(node);
    node.setDirtyCanvas(true, true);
}

/** 현재 상태를 문자열로 만든다. 저장 시점과 비교해 수정 여부를 판단한다. */
function stateKey(node) {
    return JSON.stringify({
        prompt: findWidget(node, "prompt")?.value ?? "",
        loras: node.flaLoras ?? [],
    });
}

/** 지금 상태를 "저장된 상태"로 표시한다. */
function markClean(node) {
    node.flaSavedKey = stateKey(node);
    updateSaveButton(node);
}

/** 저장 상태가 바뀌었으면 버튼 줄을 다시 그리게 한다.
 *  실제 표시(버튼 색)는 버튼 줄의 draw 가 매번 계산한다. */
function updateSaveButton(node) {
    if (!node.flaSaveButton) return;
    const dirty = node.flaSavedKey !== stateKey(node);
    if (node.flaWasDirty === dirty) return;   // 상태가 그대로면 다시 그리지 않는다
    node.flaWasDirty = dirty;
    node.setDirtyCanvas(true, true);
}

/** 파이썬으로 넘어갈 숨은 위젯을 갱신한다.
 *  위젯은 node.widgets 에서 빼두었으므로 저장해둔 참조를 쓴다. */
function syncHidden(node) {
    updateSaveButton(node);
    if (node.flaHidden?.lora_data) {
        node.flaHidden.lora_data.value = JSON.stringify(node.flaLoras ?? []);
    }
    if (node.flaHidden?.preset) {
        node.flaHidden.preset.value = node.flaPreset ?? "";
    }
}

/** 간단한 입력 대화상자. */
function askName(title, initial = "") {
    return window.prompt(title, initial);
}

/** "자세/서있기" 를 { theme, name } 으로 나눈다.
 *  구분자가 없으면 현재 테마를 쓰도록 theme 을 비워 돌려준다. */
function splitPath(input) {
    const parts = String(input).split("/").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return { theme: "", name: "" };
    if (parts.length === 1) return { theme: "", name: parts[0] };
    return { theme: parts[0], name: parts.slice(1).join(" ") };
}

function notify(msg, error = false) {
    if (error) {
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

/** 로라 선택 팝업. 클릭한 자리에서 열리도록 이벤트를 넘겨준다.
 *  event 를 주지 않으면 마지막 캔버스 클릭 위치를 쓴다.
 *  메뉴를 그냥 닫으면 문자열이 아닌 값이 오므로 null 로 정규화한다. */
function pickFromList(list, event) {
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

/** 이 노드 뒤에 같은 노드를 하나 더 만들어 체인으로 끼워 넣는다.
 *
 *  이 노드의 출력(MODEL/CLIP/prompt)에 걸려 있던 링크를 모두 새 노드의
 *  같은 출력으로 옮기고, 이 노드 → 새 노드로 다시 이어 붙인다.
 *  결과적으로 흐름이 끊기지 않고 사이에 한 칸이 늘어난 모양이 된다.
 *
 *      전:  A ─▶ [이 노드] ─▶ C
 *      후:  A ─▶ [이 노드] ─▶ [새 노드] ─▶ C
 */
function insertAfter(node) {
    const graph = node.graph ?? app.graph;
    if (!graph) return null;

    const fresh = LiteGraph.createNode(NODE_NAME);
    if (!fresh) return null;

    // 겹치지 않도록 이 노드 바로 오른쪽에 놓는다
    const GAP = 40;
    fresh.pos = [
        node.pos[0] + (node.size?.[0] ?? 400) + GAP,
        node.pos[1],
    ];
    graph.add(fresh);

    // 폭은 원본을 따라가는 편이 체인이 가지런해 보인다
    if (node.size?.[0]) fresh.size[0] = node.size[0];

    // 이 노드의 출력과 새 노드의 입력을 짝지어 준다.
    // 이름이 서로 다르므로(MODEL→model, prompt→prompt_in) 표로 둔다.
    const PAIRS = [
        ["MODEL", "model"],
        ["CLIP", "clip"],
        ["prompt", "prompt_in"],
    ];

    for (const [outName, inName] of PAIRS) {
        const slot = node.findOutputSlot(outName);
        if (slot < 0) continue;
        const output = node.outputs[slot];

        // 원래 이 출력이 향하던 곳들을 먼저 적어둔다.
        // 아래에서 연결을 바꾸면 links 배열이 변하므로 미리 복사한다.
        const targets = [];
        for (const linkId of (output.links ?? []).slice()) {
            const link = graph.links?.[linkId];
            if (!link) continue;
            const target = graph.getNodeById(link.target_id);
            if (target) targets.push([target, link.target_slot]);
        }

        const freshIn = fresh.findInputSlot(inName);
        const freshOut = fresh.findOutputSlot(outName);
        if (freshIn < 0 || freshOut < 0) continue;

        // 새 노드 → 원래 가던 곳들.
        // 입력 슬롯은 하나만 받으므로 이 연결이 옛 링크를 밀어낸다.
        for (const [target, targetSlot] of targets) {
            fresh.connect(freshOut, target, targetSlot);
        }

        // 이 노드 → 새 노드
        node.connect(slot, fresh, freshIn);
    }

    // 테마만 맞춰준다. 프리셋·프롬프트·로라는 빈 상태로 둔다.
    // onNodeCreated 가 100ms 뒤 프리셋 목록을 읽으므로 그 전에 값을 넣어두면
    // 새 노드가 같은 테마의 목록을 그대로 받아온다.
    const themeW = findWidget(node, "theme");
    const freshTheme = findWidget(fresh, "theme");
    if (themeW && freshTheme && themeW.value !== NONE) {
        freshTheme.options.values = (themeW.options?.values ?? []).slice();
        freshTheme.value = themeW.value;
    }

    graph.setDirtyCanvas(true, true);
    return fresh;
}

// 구역별 색. 로라 영역을 시각적으로 묶어준다.
const COLORS = {
    header: "#2d4a5e",   // 구분선 머리글
    on: "#2f4f34",       // 켜진 로라
    off: "#3a3a3a",      // 꺼진 로라
    strength: "#333a45", // 강도 줄
    action: "#4a3a2a",   // 추가 버튼
};

// 버튼 색. 성격이 같은 것끼리 묶어서 구분한다.
const BTN = {
    save: "#2f4f34",     // 저장 — 초록
    new: "#8a4b2a",      // 새로만들기 — 주황
    rename: "#3a4a6a",   // 이름 변경 — 파랑
    delete: "#5e2f2f",   // 삭제 — 빨강
    theme: "#4a3a5e",    // 테마 관련 — 보라
};

/** 위젯 배경색을 개별로 덮어쓴다. background_color 는 프로토타입 getter라 재정의가 필요하다. */
function paint(widget, color) {
    Object.defineProperty(widget, "background_color", {
        get: () => color,
        configurable: true,
    });
    return widget;
}

// ─────────── 캔버스 그리기 헬퍼 (rgthree 파워 로라 로더 방식) ───────────

const ARROW_W = 9;
const ARROW_H = 10;
const NUM_W = 32;
const INNER = 3;
const NUM_TOTAL = ARROW_W + INNER + NUM_W + INNER + ARROW_W;

// 로라 한 줄의 높이와 노드 최소 폭. 줄 높이를 고정해 크기가 튀지 않게 한다.
const ROW_HEIGHT = 22;
const MIN_NODE_WIDTH = 340;

/** 이 노드 전체가 꺼진 상태인지(프롬프트 토글 off). 꺼지면 색을 모두 회색으로 만든다. */
function isNodeOff(node) {
    return node?.flaHidden?.prompt_enabled?.value === false;
}

/** 노드가 꺼져 있으면 회색을, 아니면 원래 색을 돌려준다. */
function tone(node, color, grey = "#2a2a2a") {
    return isNodeOff(node) ? grey : color;
}

/** 둥근 사각 배경. */
function drawRoundedRect(ctx, x, y, w, h, fill, stroke) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [h * 0.25]);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();
}

/** 좌측 토글 스위치. 클릭 범위 [x, width] 를 돌려준다. */
function drawToggle(ctx, posX, posY, height, value, live = true) {
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

/** 우측 숫자 조절부(◀ 0.90 ▶). 오른쪽 끝 기준으로 왼쪽으로 그린다.
 *  [왼쪽화살표, 숫자, 오른쪽화살표] 각각의 [x, width] 를 돌려준다. */
function drawNumber(ctx, rightX, posY, height, value) {
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
    ctx.fillText(value.toFixed(2), posX + NUM_W / 2, midY);
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

/** 폭에 맞게 문자열을 줄인다. 앞을 자르고 … 를 붙인다. */
function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText("…" + s).width > maxWidth) {
        s = s.slice(1);
    }
    return "…" + s;
}

/** 클릭 좌표가 [x, width] 범위 안인지. */
function inBounds(pos, bounds) {
    if (!bounds) return false;
    return pos[0] >= bounds[0] && pos[0] <= bounds[0] + bounds[1];
}

/** 로라 이름을 보기 좋게 줄인다. 폴더는 남기고 확장자는 뗀다. */
function prettyLora(path) {
    const noExt = path.replace(/\.safetensors$|\.ckpt$|\.pt$/i, "");
    const parts = noExt.split(/[\\/]/);
    const file = parts.pop();
    const dir = parts.length ? parts[parts.length - 1] + "/" : "";
    const full = dir + file;
    return full.length > 30 ? "…" + full.slice(-29) : full;
}

/** 로라 한 줄을 담당하는 커스텀 위젯을 만든다.
 *  왼쪽 토글 / 가운데 이름(클릭하면 교체) / 오른쪽 강도 조절. */
function makeLoraRow(node, lora, idx) {
    const widget = {
        type: "custom",
        name: "fla_lora_" + idx,
        serialize: false,   // 값이 없는 표시용 위젯
        value: lora,
        flaLoraRow: true,
        // 마우스를 올리면 전체 경로를 보여준다. 이름은 폭에 맞춰 잘리기 때문이다.
        tooltip: "",
        // 클릭 판정 영역. draw 때마다 갱신된다.
        bounds: { toggle: null, name: null, dec: null, num: null, inc: null, del: null },

        // 폭은 요구하지 않는다(0). 0 을 돌려줘야 사용자가 좁혀놓은 폭이 유지된다.
        computeSize() {
            return [0, ROW_HEIGHT];
        },

        draw(ctx, n, widgetWidth, posY, height) {
            const margin = 10;
            const inner = margin * 0.33;
            const midY = posY + height * 0.5;
            // 노드 실제 폭을 기준으로 그린다. 인자로 오는 폭은 버전마다 다르다.
            const width = node.size?.[0] ?? widgetWidth;
            // 로라 전체 바이패스거나 노드 전체가 꺼지면 초록을 회색으로 바꾼다
            const bypassed = node.flaHidden?.loras_enabled?.value === false
                || isNodeOff(node);

            const live = lora.enabled && !bypassed;
            drawRoundedRect(
                ctx, margin, posY, width - margin * 2, height,
                live ? "#2a3a2c" : "#2a2a2a",
                live ? "#3f6146" : "#3a3a3a",
            );

            let posX = margin;
            this.bounds.toggle = drawToggle(ctx, posX, posY, height, lora.enabled, !bypassed);
            posX += this.bounds.toggle[1] + inner;

            ctx.save();
            // 꺼진 로라, 또는 전체 바이패스 상태면 흐리게 보여준다
            if (!lora.enabled) ctx.globalAlpha = 0.45;
            else if (bypassed) ctx.globalAlpha = 0.5;

            // 오른쪽 끝: 삭제 버튼
            const delW = 14;
            const delX = width - margin - inner - delW;
            ctx.fillStyle = "#a66";
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
            const nameRight = dec[0] - inner * 2;
            const nameW = Math.max(10, nameRight - nameLeft);
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
            ctx.textAlign = "left";
            ctx.fillText(fitText(ctx, prettyLora(lora.path), nameW), nameLeft, midY);
            this.bounds.name = [nameLeft, nameW];

            ctx.restore();
        },

        mouse(event, pos, n) {
            // 최신 프론트엔드는 widget.mouse 를 pointerup 으로 호출한다.
            // down 도 오는 구버전을 위해 둘 다 받되, 같은 클릭이 두 번 처리되지 않도록
            // down 은 눌린 위치만 기억하고 실제 동작은 up 에서 한 번만 한다.
            const t = event.type;
            if (t === "pointerdown" || t === "mousedown") {
                this.flaDown = true;
                return true;
            }
            if (t !== "pointerup" && t !== "mouseup") return false;
            this.flaDown = false;

            if (inBounds(pos, this.bounds.toggle)) {
                lora.enabled = !lora.enabled;
                syncHidden(node);
                node.setDirtyCanvas(true, true);
                return true;
            }
            if (inBounds(pos, this.bounds.del)) {
                node.flaLoras.splice(idx, 1);
                rebuildLoraWidgets(node);
                syncHidden(node);
                return true;
            }
            if (inBounds(pos, this.bounds.dec)) {
                lora.strength = Math.round((lora.strength - 0.05) * 100) / 100;
                syncHidden(node);
                node.setDirtyCanvas(true, true);
                return true;
            }
            if (inBounds(pos, this.bounds.inc)) {
                lora.strength = Math.round((lora.strength + 0.05) * 100) / 100;
                syncHidden(node);
                node.setDirtyCanvas(true, true);
                return true;
            }
            if (inBounds(pos, this.bounds.num)) {
                // 숫자를 직접 입력받는다
                const v = window.prompt(t("strength"), String(lora.strength));
                if (v !== null && !isNaN(parseFloat(v))) {
                    lora.strength = parseFloat(v);
                    syncHidden(node);
                    node.setDirtyCanvas(true, true);
                }
                return true;
            }
            if (inBounds(pos, this.bounds.name)) {
                // 이름을 누르면 그 자리에서 로라 교체 목록을 연다
                pickLora().then((choice) => {
                        if (!choice) return;
                        lora.path = choice;
                        syncHidden(node);
                        node.setDirtyCanvas(true, true);
                });
                return true;
            }
            return false;
        },
    };
    return widget;
}

/** 로라 목록 UI를 다시 그린다. */
function rebuildLoraWidgets(node) {
    // 다시 그리는 동안 노드 크기가 튀지 않도록 현재 크기를 기억해둔다
    const keepWidth = node.size?.[0] ?? MIN_NODE_WIDTH;
    const keepHeight = node.size?.[1] ?? 0;

    // 기존 로라 관련 위젯만 걷어낸다
    node.widgets = (node.widgets ?? []).filter((w) => !w.flaLoraRow);

    const loras = node.flaLoras ?? [];
    const onCount = loras.filter((l) => l.enabled).length;
    const lorasW = findWidget(node, "loras_enabled");
    // 노드 전체가 꺼져 있으면 로라 영역도 회색으로 본다
    const bypassOn = (lorasW ? lorasW.value !== false : true) && !isNodeOff(node);

    // ① 로라 적용 토글 — 맨 위
    const allW = node.addWidget(
        "toggle",
        t("applyLora") + `  (${onCount}/${loras.length})`,
        bypassOn,
        (v) => {
            if (lorasW) lorasW.value = v;
            rebuildLoraWidgets(node);
            node.setDirtyCanvas(true, true);
        },
    );
    allW.flaLoraRow = true;
    allW.flaBoxTop = true;   // 박스의 시작
    // 실제 값은 파이썬의 loras_enabled 위젯이 들고 있다. 저장 슬롯을 차지하지 않게 한다.
    allW.serialize = false;
    allW.tooltip = t("tipLoraBypass");
    paint(allW, bypassOn ? COLORS.header : "#2a2a2a");

    // ② 로라 목록 — 가운데
    loras.forEach((lora, idx) => {
        node.widgets.push(makeLoraRow(node, lora, idx));
    });

    const add = node.addWidget("button", t("addLora"), null, async (v, canvas, n, pos, event) => {
        // 목록에서 고른 뒤에만 줄을 추가한다 (취소하면 아무 일도 없음)
        const choice = await pickLora();
        if (!choice) return;
        node.flaLoras.push({ path: choice, strength: 0.9, enabled: true });
        rebuildLoraWidgets(node);
        syncHidden(node);
    });
    add.flaLoraRow = true;
    add.serialize = false;   // 버튼이라 저장할 값이 없다
    paint(add, bypassOn ? COLORS.action : "#2a2a2a");

    // 로라 영역을 감싸는 테두리.
    // 높이를 차지하지 않는 위젯을 맨 앞에 두고, 거기서 영역 전체를 한 번에 그린다.
    // 각 위젯의 last_y 는 프론트엔드가 배치할 때 채워준다.
    const boxW = {
        type: "custom",
        name: "fla_lora_box",
        serialize: false,   // 값이 없는 표시용 위젯
        flaLoraRow: true,
        computeSize() {
            return [0, 0];
        },
        draw(ctx, n, widgetWidth, posY) {
            const width = node.size?.[0] ?? widgetWidth;
            const top = (allW.last_y ?? posY) - 3;
            const bottom = (add.last_y ?? top) + ROW_HEIGHT + 3;
            if (bottom <= top) return;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(6, top, Math.max(20, width - 12), bottom - top, 6);
            ctx.strokeStyle = bypassOn ? "#3f6146" : "#4a4a4a";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        },
    };
    node.widgets.push(boxW);
    // 박스는 다른 로라 위젯보다 먼저 그려지도록 맨 앞으로 보낸다
    node.widgets.splice(node.widgets.indexOf(boxW), 1);
    node.widgets.splice(node.widgets.indexOf(allW), 0, boxW);

    // 폭은 사용자가 정한 값을 그대로 둔다. 좁혀놨으면 좁은 채로 유지한다.
    // 높이는 줄 수에 맞춰 계산하되, 사용자가 늘려둔 여백은 존중한다.
    node.size[0] = keepWidth;

    const needed = node.computeSize?.()?.[1] ?? keepHeight;
    const prevNeeded = node.flaNeededHeight ?? needed;
    // 사용자가 직접 늘려둔 만큼(여백)을 유지한 채 내용 높이 변화만 반영한다
    const slack = Math.max(0, keepHeight - prevNeeded);
    node.size[1] = needed + slack;
    node.flaNeededHeight = needed;

    node.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "FLA.LoraTheme",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            const node = this;

            node.flaLoras = [];
            node.flaPreset = "";

            // 파이썬으로 값을 넘기기만 하는 위젯은 화면에서 감춘다.
            // node.widgets 에서 빼버리면 실행 시 값이 전달되지 않으므로
            // 배열에는 남겨두고 높이와 그리기만 없앤다.
            node.flaHidden = {};
            const hide = (name) => {
                const w = findWidget(node, name);
                if (!w) return;
                node.flaHidden[name] = w;
                w.hidden = true;
                if (w.options) w.options.hidden = true;
                w.computeSize = () => [0, -4];
                w.computeLayoutSize = () => ({
                    minHeight: 0, maxHeight: 0, minWidth: 0,
                });
                w.draw = () => { };
                if (w.element) w.element.style.display = "none";
            };
            hide("lora_data");
            hide("preset");
            hide("loras_enabled");    // t("applyLora") 토글이 대신한다
            hide("prompt_enabled");   // 프리셋 줄의 토글이 대신한다

            // 프롬프트를 고치면 저장 버튼이 살아나도록 감시한다
            const promptW = findWidget(node, "prompt");
            if (promptW) {
                const origCb = promptW.callback;
                promptW.callback = function () {
                    origCb?.apply(this, arguments);
                    updateSaveButton(node);
                };
                // 텍스트 영역은 콜백이 늦게 오므로 입력 이벤트도 함께 본다
                if (promptW.element) {
                    promptW.element.addEventListener("input", () => updateSaveButton(node));
                } else {
                    // element 가 나중에 생기는 경우를 대비
                    setTimeout(() => {
                        promptW.element?.addEventListener("input", () => updateSaveButton(node));
                    }, 300);
                }
            }

            const themeW = findWidget(node, "theme");

            const presetW = node.addWidget("combo", t("preset"), NONE, async (v) => {
                if (v === NONE) return;
                node.flaPreset = v;
                try {
                    const data = await getPreset(themeW.value, v);
                    applyData(node, data);
                    rebuildLoraWidgets(node);
                    // 막 불러온 상태가 곧 저장된 상태다
                    markClean(node);
                } catch (e) {
                    notify(t("loadFailed") + e.message, true);
                }
            }, { values: [NONE] });

            node.flaPresetWidget = presetW;

            // 콤보 자체는 값 보관용으로만 남기고 화면에서는 감춘다.
            // 대신 아래 커스텀 행이 토글 + 프리셋 이름을 그린다.
            // serialize:false 가 없으면 저장 슬롯을 차지해 파이썬 입력 인덱스가 밀린다.
            // (프리셋 이름은 파이썬의 preset 위젯에 따로 담긴다)
            presetW.serialize = false;
            presetW.hidden = true;
            if (presetW.options) presetW.options.hidden = true;
            presetW.computeSize = () => [0, -4];
            presetW.draw = () => { };

            const enabledW = findWidget(node, "prompt_enabled");

            // 프롬프트 on/off 토글 + 프리셋 선택을 한 줄에 그린다
            const rowW = {
                type: "custom",
                name: "fla_preset_row",
                serialize: false,   // 값이 없는 표시용 위젯
                tooltip: t("tipPromptToggle"),
                bounds: { toggle: null, name: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const inner = margin * 0.33;
                    const midY = posY + height * 0.5;
                    const on = enabledW ? enabledW.value !== false : true;
                    const width = node.size?.[0] ?? widgetWidth;

                    drawRoundedRect(
                        ctx, margin, posY, width - margin * 2, height,
                        on ? "#2b3b4a" : "#2a2a2a",
                        on ? "#3f5a70" : "#3a3a3a",
                    );

                    let posX = margin;
                    this.bounds.toggle = drawToggle(ctx, posX, posY, height, on);
                    posX += this.bounds.toggle[1] + inner;

                    ctx.save();
                    if (!on) ctx.globalAlpha = 0.45;
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    const label = presetW.value ?? NONE;
                    const nameW = Math.max(10, width - margin - inner - posX);
                    ctx.fillText(fitText(ctx, label, nameW), posX, midY);
                    this.bounds.name = [posX, nameW];
                    ctx.restore();
                },
                mouse(event, pos, n) {
                    // 최신 프론트엔드는 widget.mouse 를 pointerup 으로 호출한다.
            // down 도 오는 구버전을 위해 둘 다 받되, 같은 클릭이 두 번 처리되지 않도록
            // down 은 눌린 위치만 기억하고 실제 동작은 up 에서 한 번만 한다.
            const t = event.type;
            if (t === "pointerdown" || t === "mousedown") {
                this.flaDown = true;
                return true;
            }
            if (t !== "pointerup" && t !== "mouseup") return false;
            this.flaDown = false;
                    if (inBounds(pos, this.bounds.toggle)) {
                        if (enabledW) {
                            enabledW.value = enabledW.value === false;
                            enabledW.callback?.(enabledW.value);
                        }
                        // 로라 영역 버튼 색은 addWidget 으로 칠해둔 값이라
                        // 다시 만들어야 회색/원래색이 반영된다.
                        rebuildLoraWidgets(node);
                        node.setDirtyCanvas(true, true);
                        return true;
                    }
                    if (inBounds(pos, this.bounds.name)) {
                        // 프리셋 목록을 그 자리에서 연다
                        const list = presetW.options?.values ?? [NONE];
                        pickFromList(list, event).then((choice) => {
                            if (!choice) return;
                            presetW.value = choice;
                            presetW.callback?.(choice);
                        });
                        return true;
                    }
                    return false;
                },
            };
            node.widgets.push(rowW);
            node.flaPresetRow = rowW;

            // 화면 배치를 위해 프리셋 줄을 theme 아래로 옮긴다.
            // 다만 configure/serialize 는 widgets_values[i] 를 인덱스로 다루므로,
            // 저장·복원 시에는 파이썬이 정의한 원래 순서로 되돌려야 한다.
            node.flaOriginalOrder = node.widgets.slice();

            node.flaArrange = () => {
                const move = (w) => {
                    const i = node.widgets.indexOf(w);
                    if (i >= 0) node.widgets.splice(i, 1);
                    node.widgets.splice(node.widgets.indexOf(themeW) + 1, 0, w);
                };
                move(presetW);
                move(rowW);   // rowW 가 presetW 보다 위에 오도록 나중에 넣는다
                node.setDirtyCanvas(true, true);
            };
            node.flaArrange();

            // prompt_enabled 는 위에서 hide() 로 이미 감췄다.

            /** 테마의 프리셋 목록을 다시 읽는다.
             *  keep 이 true 면 이미 고른 프리셋을 유지한다(워크플로 복원용). */
            async function refreshPresets(theme, keep = false) {
                try {
                    const list = await getPresets(theme);
                    presetW.options.values = list.length ? list : [NONE];

                    // 복원 중이고 저장된 프리셋이 목록에 있으면 그대로 둔다
                    if (keep && node.flaPreset && list.includes(node.flaPreset)) {
                        presetW.value = node.flaPreset;
                        node.setDirtyCanvas(true, true);
                        return;
                    }
                    presetW.value = list.length ? list[0] : NONE;
                    if (list.length) presetW.callback(presetW.value);
                    node.setDirtyCanvas(true, true);
                } catch (e) {
                    notify(t("listFailed") + e.message, true);
                }
            }
            node.flaRefreshPresets = refreshPresets;

            // 테마가 바뀌면 프리셋 목록을 새로 읽는다
            const origTheme = themeW.callback;
            themeW.callback = function (v) {
                origTheme?.apply(this, arguments);
                refreshPresets(v);
            };

            const btn = (label, color, fn) => {
                const w = node.addWidget("button", label, null, fn);
                paint(w, color);
                return w;
            };

            const actSave = async () => {
                // 바뀐 게 없으면 아무 일도 하지 않는다
                if (node.flaSavedKey === stateKey(node)) return;
                let name = node.flaPreset;
                if (!name) {
                    name = askName(t("presetName"), "");
                    if (!name) return;
                }
                try {
                    const r = await post("/fla/preset/save", {
                        theme: themeW.value, name, data: collect(node),
                    });
                    node.flaPreset = name;
                    presetW.options.values = r.presets;
                    presetW.value = name;
                    markClean(node);
                    notify(t("savedAs") + name);
                } catch (e) {
                    notify(t("saveFailed") + e.message, true);
                }
            };

            // t("askThemePresetShort") 형식으로 입력받는다. 테마가 없으면 새로 만든다.
            const actNew = async () => {
                const input = askName(t("askThemePreset"), themeW.value + "/");
                if (!input) return;
                const parsed = splitPath(input);
                // 테마를 안 적었으면 현재 테마에 넣는다
                const theme = parsed.theme || (themeW.value !== NONE ? themeW.value : "");
                const name = parsed.name;
                if (!theme || !name) {
                    notify(t("formatHint"), true);
                    return;
                }
                try {
                    // 빈 프리셋을 바로 만들어 저장한다 (테마 폴더는 자동 생성)
                    const r = await post("/fla/preset/save", {
                        theme, name, data: { prompt: "", loras: [] },
                    });
                    const themes = await getThemes();
                    themeW.options.values = themes;
                    themeW.value = theme;
                    node.flaPreset = name;
                    presetW.options.values = r.presets;
                    presetW.value = name;
                    applyData(node, { prompt: "", loras: [] });
                    rebuildLoraWidgets(node);
                    notify(t("createdAs") + theme + "/" + name);
                } catch (e) {
                    notify(t("createFailed") + e.message, true);
                }
            };

            // 이름 변경도 t("askThemePresetShort") 형식. 테마를 바꾸면 프리셋이 그리로 옮겨간다.
            const actRename = async () => {
                const old = node.flaPreset;
                if (!old) {
                    notify(t("noPresetSelected"), true);
                    return;
                }
                const oldTheme = themeW.value;
                const input = askName(t("askThemePresetShort"), oldTheme + "/" + old);
                if (!input) return;
                const parsed = splitPath(input);
                const theme = parsed.theme || oldTheme;
                const name = parsed.name;
                if (!theme || !name) {
                    notify(t("formatHint"), true);
                    return;
                }
                if (theme === oldTheme && name === old) return;
                try {
                    if (theme === oldTheme) {
                        // 같은 테마 안에서 이름만 변경
                        const r = await post("/fla/preset/rename", {
                            theme, old, new: name,
                        });
                        presetW.options.values = r.presets;
                    } else {
                        // 테마가 바뀌면 새 위치에 저장하고 옛 것을 지운다
                        await post("/fla/preset/save", {
                            theme, name, data: collect(node),
                        });
                        await post("/fla/preset/delete", { theme: oldTheme, name: old });
                        const themes = await getThemes();
                        themeW.options.values = themes;
                        themeW.value = theme;
                        presetW.options.values = await getPresets(theme);
                    }
                    node.flaPreset = name;
                    presetW.value = name;
                    syncHidden(node);
                    notify(t("renamedTo") + theme + "/" + name);
                } catch (e) {
                    notify(t("renameFailed") + e.message, true);
                }
            };

            const actDelete = async () => {
                const name = node.flaPreset;
                if (!name) {
                    notify(t("noPresetSelected"), true);
                    return;
                }
                if (!confirm(t("confirmDelete", name))) return;
                const oldTheme = themeW.value;
                try {
                    const r = await post("/fla/preset/delete", { theme: oldTheme, name });
                    node.flaPreset = "";

                    // 마지막 프리셋이었으면 테마도 사라지므로 테마 목록을 다시 읽는다
                    const themes = await getThemes();
                    themeW.options.values = themes.length ? themes : [NONE];
                    if (!themes.includes(oldTheme)) {
                        themeW.value = themes.length ? themes[0] : NONE;
                        await refreshPresets(themeW.value);
                        notify(t("deletedWithTheme"));
                    } else {
                        presetW.options.values = r.presets.length ? r.presets : [NONE];
                        presetW.value = NONE;
                        applyData(node, { prompt: "", loras: [] });
                        rebuildLoraWidgets(node);
                        notify(t("deleted"));
                    }
                    markClean(node);
                } catch (e) {
                    notify(t("deleteFailed") + e.message, true);
                }
            };

            // 이 노드 뒤에 같은 노드를 하나 더 붙인다.
            // 프리셋을 여러 개 겹쳐 쓸 때 선을 일일이 잇지 않아도 되게 한다.
            const actChain = () => {
                const fresh = insertAfter(node);
                if (!fresh) {
                    notify(t("chainFailed"), true);
                    return;
                }
                notify(t("chained"));
            };

            // 노드 추가 / 새로만들기 / 이름 바꾸기 / 삭제를 옵션 하나에 모은다.
            // 테마 이름 변경은 "이름 바꾸기"에서 테마/프리셋 형식으로 할 수 있어 따로 두지 않는다.
            const OPTS = [
                ["➕ " + t("chainNode"), actChain],
                ["✨ " + t("newPreset"), actNew],
                ["✏ " + t("rename"), actRename],
                ["🗑 " + t("remove"), actDelete],
            ];

            // 저장 / 옵션을 한 줄에 좌우로 나눠 그린다.
            const btnRow = {
                type: "custom",
                name: "fla_btn_row",
                serialize: false,   // 값이 없는 표시용 위젯
                bounds: { save: null, opts: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const gap = 6;
                    const width = node.size?.[0] ?? widgetWidth;
                    const off = isNodeOff(node);
                    const dirty = node.flaSavedKey !== stateKey(node);
                    const half = (width - margin * 2 - gap) / 2;
                    const midY = posY + height * 0.5;

                    ctx.save();
                    ctx.textBaseline = "middle";
                    ctx.textAlign = "center";

                    // 왼쪽: 저장
                    const sx = margin;
                    drawRoundedRect(ctx, sx, posY, half, height,
                        off ? "#2a2a2a" : (dirty ? BTN.save : "#2f2f2f"),
                        off ? "#3a3a3a" : (dirty ? "#4a7a52" : "#3a3a3a"));
                    this.bounds.save = [sx, half];
                    // 디스크 모양은 항상 보여준다. 변경 여부는 버튼 색으로 알 수 있다.
                    ctx.fillStyle = off ? "#666" : (LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD");
                    ctx.fillText("💾 " + t("save"), sx + half / 2, midY);

                    // 오른쪽: 옵션
                    const ox = sx + half + gap;
                    drawRoundedRect(ctx, ox, posY, half, height,
                        off ? "#2a2a2a" : BTN.rename,
                        off ? "#3a3a3a" : "#4a5a7a");
                    this.bounds.opts = [ox, half];
                    ctx.fillStyle = off ? "#666" : (LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD");
                    ctx.fillText("⚙ " + t("options"), ox + half / 2, midY);

                    ctx.restore();
                },
                mouse(event, pos, n) {
                    const t = event.type;
                    if (t === "pointerdown" || t === "mousedown") return true;
                    if (t !== "pointerup" && t !== "mouseup") return false;
                    if (inBounds(pos, this.bounds.save)) {
                        actSave();
                        return true;
                    }
                    if (inBounds(pos, this.bounds.opts)) {
                        pickFromList(OPTS.map((o) => o[0]), event).then((choice) => {
                            OPTS.find((o) => o[0] === choice)?.[1]();
                        });
                        return true;
                    }
                    return false;
                },
            };
            node.widgets.push(btnRow);
            node.flaSaveButton = btnRow;

            // 새로 놓을 때만 기본 폭을 준다. 이후에는 사용자가 정한 폭을 건드리지 않는다.
            if (!node.size?.[0]) {
                node.size = [400, node.size?.[1] ?? 0];
            }

            rebuildLoraWidgets(node);
            markClean(node);
            // 복원된 노드라면(onConfigure 가 먼저 실행됨) 고른 프리셋을 덮어쓰지 않는다
            setTimeout(() => refreshPresets(themeW.value, !!node.flaPreset), 100);
        };

        // 워크플로 저장 시 상태를 함께 담는다
        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            o.flaLoras = this.flaLoras ?? [];
            o.flaPreset = this.flaPreset ?? "";

            // widgets_values 는 화면 순서로 만들어져 파이썬 위젯이 밀려 있다.
            // 파이썬이 정의한 순서로 다시 세워 저장한다.
            const order = this.flaOriginalOrder;
            if (order && Array.isArray(o.widgets_values)) {
                const vals = [];
                for (const w of order) {
                    if (w.serialize === false) continue;
                    const v = w?.value;
                    vals.push(v === undefined ? null : v);
                }
                o.widgets_values = vals;
            }
        };

        // 워크플로를 다시 열 때 상태를 복원한다
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (o) {
            const node = this;

            // configure 는 widgets_values[i] 를 위젯 배열 인덱스로 대입한다.
            // 화면용으로 바꿔둔 순서 그대로면 값이 엉뚱한 위젯에 들어가므로
            // 파이썬 정의 순서로 되돌린 뒤 값을 받고, 다시 화면 순서로 세운다.
            const arranged = node.widgets;
            if (node.flaOriginalOrder) node.widgets = node.flaOriginalOrder.slice();

            onConfigure?.apply(this, arguments);

            node.widgets = arranged;
            node.flaArrange?.();

            // 파이썬 위젯(preset / lora_data)이 정본이다.
            // flaPreset/flaLoras 는 예전 워크플로를 위한 보조 수단으로만 쓴다.
            const presetVal = node.flaHidden?.preset?.value;
            node.flaPreset = (typeof presetVal === "string" && presetVal)
                ? presetVal
                : (o.flaPreset ?? "");

            const dataVal = node.flaHidden?.lora_data?.value;
            let loras = null;
            if (typeof dataVal === "string" && dataVal.trim()) {
                try { loras = JSON.parse(dataVal); } catch (e) { loras = null; }
            }
            node.flaLoras = Array.isArray(loras) ? loras : (o.flaLoras ?? []);

            // 감춘 콤보의 표시값을 복원된 프리셋 이름에 맞춘다
            if (node.flaPresetWidget && node.flaPreset) {
                node.flaPresetWidget.options.values = [node.flaPreset];
                node.flaPresetWidget.value = node.flaPreset;
                const themeW = findWidget(node, "theme");
                // 목록만 서버에서 다시 채운다(고른 프리셋은 유지)
                setTimeout(() => {
                    node.flaRefreshPresets?.(themeW?.value, true);
                }, 150);
            }

            // 워크플로에 저장된 크기를 그대로 되살린다
            const saved = o.size ? [o.size[0], o.size[1]] : null;
            rebuildLoraWidgets(node);
            if (saved) {
                node.size[0] = saved[0];
                node.size[1] = saved[1];
                node.flaNeededHeight = node.computeSize?.()?.[1] ?? saved[1];
            }
            syncHidden(node);
            markClean(node);
        };
    },
});
