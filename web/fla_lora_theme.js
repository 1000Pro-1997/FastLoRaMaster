import { app } from "../../scripts/app.js";
import { t } from "./fla_i18n.js";
import { mouseGate, releaseWidgetCaptureSoon, dropCaptureFor, guardNodeWidgets } from "./fla_widget_mouse.js";
import { hitColors } from "./fla_hit.js";
import { attachWildcardAutocomplete } from "./fla_wildcard_autocomplete.js";
// 로라 목록 UI 는 FLAChecklist 와 공용이다. 고치려면 fla_lora_ui.js 를 본다.
import {
    ROW_HEIGHT, LAYOUT_PAD, api, findWidget, notify, pickFromList, drawRoundedRect,
    drawToggle, fitText, inBounds, isNodeOff,
    buildLoraBox, paint,
} from "./fla_lora_ui.js";

const NODE_NAME = "SN1000LoraTheme";
const NONE = "-";   // 언어와 무관한 표식. 파이썬 presets.NONE 과 같아야 한다.

const getThemes = () => api("/fla/themes").then(r => r.themes);
const getPresets = (theme) => api(`/fla/presets?theme=${encodeURIComponent(theme)}`).then(r => r.presets);
const getPreset = (theme, name) => api(`/fla/preset?theme=${encodeURIComponent(theme)}&name=${encodeURIComponent(name)}`);

const post = (url, body) => api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});


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
    node.flaSavedData = collect(node);
    updateSaveButton(node);
}

/** 주어진 프리셋 데이터를 "저장된 상태"의 기준으로 삼는다.
 *  화면 상태는 건드리지 않는다. 디스크 원본과 현재 상태가 다르면
 *  저장 버튼과 되돌리기가 살아난다. */
function markBaseline(node, data) {
    const base = {
        prompt: data.prompt ?? "",
        loras: (data.loras ?? []).map(l => ({
            path: l.path,
            strength: typeof l.strength === "number" ? l.strength : 1.0,
            enabled: l.enabled !== false,
        })),
    };
    node.flaSavedData = base;
    node.flaSavedKey = JSON.stringify(base);
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

/** 간단한 입력 대화상자.
 *  실행을 멈추는 동안 pointerup 이 사라지므로 위젯 캡처를 먼저 풀어준다. */
function askName(title, initial = "") {
    releaseWidgetCaptureSoon();
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

// ─────────── 캔버스 그리기 헬퍼 (rgthree 파워 로라 로더 방식) ───────────


// 로라 한 줄의 높이와 노드 최소 폭. 줄 높이를 고정해 크기가 튀지 않게 한다.
const MIN_NODE_WIDTH = 340;

/** 노드가 꺼져 있으면 회색을, 아니면 원래 색을 돌려준다. */
function tone(node, color, grey = "#2a2a2a") {
    return isNodeOff(node) ? grey : color;
}

/** 포인터 콜백이 끝난 뒤 화면 위젯을 교체한다.
 *
 *  마우스 처리 도중에 위젯을 갈아치우면 ComfyUI 가 방금 없어진 위젯을
 *  계속 잡고 있게 된다(canvas.node_widget). 그러면 그 뒤의 클릭·드래그가
 *  화면에 없는 위젯으로 전달돼 아무 반응이 없다.
 *  FLAChecklist 의 rebuildAfterPointer 와 같은 이유다.
 */
function rebuildAfterPointer(node) {
    if (node.flaRebuildPending) return;
    node.flaRebuildPending = true;
    setTimeout(() => {
        node.flaRebuildPending = false;
        if (node.graph) rebuildLoraWidgets(node);
    }, 0);
}

/** 로라 목록 UI를 다시 그린다. */
function rebuildLoraWidgets(node) {
    // 위젯을 새로 만들면 프론트엔드가 잡아둔 옛 위젯은 죽은 참조가 된다
    dropCaptureFor(node);

    // 다시 그리는 동안 노드 크기가 튀지 않도록 현재 크기를 기억해둔다
    const keepWidth = node.size?.[0] ?? MIN_NODE_WIDTH;
    const keepHeight = node.size?.[1] ?? 0;

    // 기존 로라 관련 위젯만 걷어낸다
    node.widgets = (node.widgets ?? []).filter((w) => !w.flaLoraRow);

    const lorasW = findWidget(node, "loras_enabled");

    // 로라 적용 토글 ~ 로라 추가 버튼까지 한 박스로. FLAChecklist 와 공용이다.
    const box = buildLoraBox(node, {
        // 배열을 붙잡아두지 않는다. 프리셋을 불러오면 통째로 갈리기 때문이다.
        loras: () => node.flaLoras ?? [],
        enabled: () => (lorasW ? lorasW.value !== false : true),
        setEnabled: (v) => {
            if (lorasW) lorasW.value = v;
            // 마우스 처리 도중이므로 위젯 교체는 뒤로 미룬다
            rebuildAfterPointer(node);
            node.setDirtyCanvas(true, true);
        },
        onAdd: (choice) => {
            node.flaLoras.push({ path: choice, strength: 0.9, enabled: true });
            rebuildAfterPointer(node);
            syncHidden(node);
        },
        // 와일드카드는 노드에 매달지 않고 프롬프트 끝에 글자로 넣는다
        onAddWildcard: (token) => {
            const promptW = findWidget(node, "prompt");
            if (!promptW) return;
            const current = String(promptW.value ?? "").trim();
            promptW.value = current ? `${current}, ${token}` : token;
            promptW.callback?.(promptW.value);
            // 여러 줄 위젯은 DOM 쪽 값도 같이 맞춰야 화면에 보인다
            const el = promptW.inputEl ?? promptW.element;
            if (el) el.value = promptW.value;
            syncHidden(node);
            node.setDirtyCanvas(true, true);
        },
        rowFlag: "flaLoraRow",
        rowOpts: {
            margin: 10,
            onChange: () => syncHidden(node),
            onCopyWords: (text) => {
                const promptW = findWidget(node, "prompt");
                if (!promptW) return;
                const current = String(promptW.value ?? "").trim();
                promptW.value = current ? `${current}, ${text}` : text;
                promptW.callback?.(promptW.value);
                syncHidden(node);
            },
            onRemove: (idx) => {
                node.flaLoras.splice(idx, 1);
                rebuildAfterPointer(node);
                syncHidden(node);
            },
        },
        tooltip: t("tipLoraBypass"),
    });
    // addWidget 이 이미 node.widgets 에 넣어둔 것들을 걷어내고 박스 순서대로 다시 넣는다
    node.widgets = node.widgets.filter((w) => !box.includes(w));
    node.widgets.push(...box);

    // 폭은 사용자가 정한 값을 그대로 둔다. 좁혀놨으면 좁은 채로 유지한다.
    // 높이는 줄 수에 맞춰 계산하되, 사용자가 늘려둔 여백은 존중한다.
    node.size[0] = keepWidth;

    const needed = node.computeSize?.()?.[1] ?? keepHeight;
    const prevNeeded = node.flaNeededHeight ?? needed;
    // 사용자가 직접 늘려둔 만큼(여백)을 유지한 채 내용 높이 변화만 반영한다
    const slack = Math.max(0, keepHeight - prevNeeded);
    node.size[1] = needed + slack;
    node.flaNeededHeight = needed;

    // 어느 위젯이든 예외를 던지면 캡처가 남아 전부 먹통이 된다. 한 번에 감싼다.
    guardNodeWidgets(node);

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
                const onEdit = () => updateSaveButton(node);
                // __ 를 치면 와일드카드 목록이 뜨게 한다
                const attach = () => {
                    const el = promptW.inputEl ?? promptW.element;
                    if (el) attachWildcardAutocomplete(el, onEdit);
                };
                attach();
                setTimeout(attach, 300);
                if (promptW.element) {
                    promptW.element.addEventListener("input", onEdit);
                } else {
                    // element 가 나중에 생기는 경우를 대비
                    setTimeout(() => {
                        promptW.element?.addEventListener("input", onEdit);
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
                    markBaseline(node, data);
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
                    return [0, ROW_HEIGHT - LAYOUT_PAD];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const inner = margin * 0.33;
                    const midY = posY + height * 0.5;
                    const on = enabledW ? enabledW.value !== false : true;
                    const width = node.size?.[0] ?? widgetWidth;

                    drawRoundedRect(
                        ctx, margin, posY, width - margin * 2, height,
                        ...hitColors(this, "name",
                            on ? "#2b3b4a" : "#2a2a2a",
                            on ? "#3f5a70" : "#3a3a3a"),
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
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    const gate = mouseGate(event);
                    if (gate === "down") {
                        this.flaDown = true;
                        return;
                    }
                    if (gate !== "up") return false;
                    this.flaDown = false;

                    if (inBounds(pos, this.bounds.toggle)) {
                        if (enabledW) {
                            enabledW.value = enabledW.value === false;
                            enabledW.callback?.(enabledW.value);
                        }
                        // 로라 영역 색은 다시 만들어야 회색/원래색이 반영된다.
                        rebuildAfterPointer(node);
                        node.setDirtyCanvas(true, true);
                        return true;
                    }
                    if (inBounds(pos, this.bounds.name)) {
                        // 프리셋 목록을 그 자리에서 연다.
                        // (pickFromList 가 위젯 캡처를 풀어준다)
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

            const actRevert = () => {
                if (node.flaSavedKey === stateKey(node) || !node.flaSavedData) return;
                applyData(node, node.flaSavedData);
                rebuildLoraWidgets(node);
                markClean(node);
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
                releaseWidgetCaptureSoon();
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

            // 지금 고른 테마 폴더를 파일 탐색기로 연다.
            // ComfyUI 가 도는 PC 에서 열리므로 원격 접속 중이면 안내만 한다.
            const actOpenFolder = async () => {
                const theme = findWidget(node, "theme")?.value ?? "";
                try {
                    await post("/fla/open-folder", { theme });
                } catch (e) {
                    notify(t("openFolderFailed") + e.message, true);
                }
            };

            // 노드 추가 / 새로만들기 / 이름 바꾸기 / 삭제를 옵션 하나에 모은다.
            // 테마 이름 변경은 "이름 바꾸기"에서 테마/프리셋 형식으로 할 수 있어 따로 두지 않는다.
            const OPTS = [
                ["➕ " + t("chainNode"), actChain],
                ["✨ " + t("newPreset"), actNew],
                ["✏ " + t("rename"), actRename],
                ["📂 " + t("openFolder"), actOpenFolder],
                ["🗑 " + t("remove"), actDelete],
            ];

            // 저장 / 되돌리기 / 옵션을 한 줄에 나눠 그린다.
            const btnRow = {
                type: "custom",
                name: "fla_btn_row",
                serialize: false,   // 값이 없는 표시용 위젯
                bounds: { save: null, revert: null, opts: null },
                computeSize() {
                    return [0, ROW_HEIGHT - LAYOUT_PAD];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const gap = 6;
                    const width = node.size?.[0] ?? widgetWidth;
                    const off = isNodeOff(node);
                    const dirty = node.flaSavedKey !== stateKey(node);
                    const third = (width - margin * 2 - gap * 2) / 3;
                    const midY = posY + height * 0.5;

                    ctx.save();
                    ctx.textBaseline = "middle";
                    ctx.textAlign = "center";

                    // 왼쪽: 저장
                    const sx = margin;
                    drawRoundedRect(ctx, sx, posY, third, height,
                        ...hitColors(this, "save",
                            off ? "#2a2a2a" : (dirty ? BTN.save : "#2f2f2f"),
                            off ? "#3a3a3a" : (dirty ? "#4a7a52" : "#3a3a3a"), !off));
                    this.bounds.save = [sx, third];
                    // 디스크 모양은 항상 보여준다. 변경 여부는 버튼 색으로 알 수 있다.
                    ctx.fillStyle = off || !dirty ? "#666" : (LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD");
                    ctx.fillText("💾 " + t("save"), sx + third / 2, midY);

                    // 가운데: 최근 저장 상태로 되돌리기
                    const rx = sx + third + gap;
                    drawRoundedRect(ctx, rx, posY, third, height,
                        ...hitColors(this, "revert",
                            off ? "#2a2a2a" : (dirty ? BTN.new : "#2f2f2f"),
                            off ? "#3a3a3a" : (dirty ? "#7a5a3a" : "#3a3a3a"), !off));
                    this.bounds.revert = [rx, third];
                    ctx.fillStyle = off || !dirty ? "#666" : (LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD");
                    ctx.fillText("↶ " + t("revert"), rx + third / 2, midY);

                    // 오른쪽: 옵션
                    const ox = rx + third + gap;
                    drawRoundedRect(ctx, ox, posY, third, height,
                        ...hitColors(this, "opts",
                            off ? "#2a2a2a" : BTN.rename,
                            off ? "#3a3a3a" : "#4a5a7a", !off));
                    this.bounds.opts = [ox, third];
                    ctx.fillStyle = off ? "#666" : (LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD");
                    ctx.fillText("⚙ " + t("options"), ox + third / 2, midY);

                    ctx.restore();
                },
                mouse(event, pos, n) {
                    const gate = mouseGate(event);
                    if (gate === "down") return;
                    if (gate !== "up") return false;
                    if (inBounds(pos, this.bounds.save)) {
                        // askName 이 필요할 때 캡처를 풀어준다
                        actSave();
                        return true;
                    }
                    if (inBounds(pos, this.bounds.revert)) {
                        actRevert();
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

            // 워크플로에 담겨 온 상태는 프리셋 파일과 다를 수 있다.
            // (저장 버튼을 누르지 않고 워크플로만 저장한 경우)
            // 그러므로 복원된 상태를 그대로 "저장됨"으로 보지 않고,
            // 디스크의 프리셋을 읽어 그것을 기준으로 삼는다.
            // 파일을 못 읽으면 되돌릴 원본이 없으므로 현재 상태를 기준으로 둔다.
            markClean(node);
            if (node.flaPreset) {
                const themeName = findWidget(node, "theme")?.value;
                if (themeName && themeName !== NONE) {
                    getPreset(themeName, node.flaPreset)
                        .then(data => markBaseline(node, data))
                        .catch(() => { });
                }
            }
        };
    },
});
