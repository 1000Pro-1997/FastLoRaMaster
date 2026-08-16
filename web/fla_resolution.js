import { app } from "../../scripts/app.js";
import { t } from "./fla_i18n.js";
import { mouseGate, releaseWidgetCapture, releaseWidgetCaptureSoon, guardNodeWidgets } from "./fla_widget_mouse.js";

const NODE_NAME = "FLAResolution";
const ROW_HEIGHT = 22;
const FAV_GROUP = () => t("favorites");

const ARROW_W = 9;
const ARROW_H = 10;
const NUM_W = 48;
const INNER = 3;

let cache = null;      // 평평한 목록(즐겨찾기 우선)
let groups = null;     // 원본 그룹 구조 {그룹: [{w,h,favorite}]}

/** 해상도 목록을 받아 캐시한다. force 면 다시 받는다. */
async function loadItems(force = false) {
    if (cache && !force) return cache;
    try {
        const res = await fetch("/fla/resolutions");
        const json = await res.json();
        cache = Array.isArray(json.items) ? json.items : [];
        groups = json.groups && typeof json.groups === "object" ? json.groups : {};
    } catch (e) {
        cache = cache ?? [];
        groups = groups ?? {};
    }
    return cache;
}

/** 목록을 기본값으로 되돌린다. */
async function resetGroups() {
    try {
        const res = await fetch("/fla/resolutions/reset", { method: "POST" });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.statusText);
        cache = Array.isArray(json.items) ? json.items : [];
        groups = json.groups ?? {};
        return true;
    } catch (e) {
        releaseWidgetCapture();
        alert(t("resetFailed") + e.message);
        return false;
    }
}

/** 편집한 목록을 서버에 저장하고 캐시를 갱신한다. */
async function saveGroups(next) {
    try {
        const res = await fetch("/fla/resolutions/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groups: next }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.statusText);
        cache = Array.isArray(json.items) ? json.items : [];
        groups = json.groups ?? {};
        return true;
    } catch (e) {
        releaseWidgetCapture();
        alert(t("saveFailed") + e.message);
        return false;
    }
}

/** 목록이 길어지면 스크롤이 생기도록 높이를 제한한다. */
function openMenu(values, event, onPick) {
    // 메뉴가 커서를 덮으면 캔버스가 pointerup 을 못 받아 위젯 캡처가 남는다
    releaseWidgetCaptureSoon();
    const menu = new LiteGraph.ContextMenu(values, {
        scale: Math.max(1, app.canvas.ds.scale),
        event,
        callback: (v) => {
            const val = typeof v === "string" ? v : v?.content;
            if (typeof val === "string") onPick(val);
        },
    });
    if (menu?.root) {
        menu.root.style.maxHeight = "60vh";
        menu.root.style.overflowY = "auto";
    }
    return menu;
}

function find(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

/** 화면에서만 감춘다. 배열에서 빼지 않으므로 저장 인덱스가 유지된다. */
function hide(widget) {
    if (!widget) return;
    widget.hidden = true;
    if (widget.options) widget.options.hidden = true;
    widget.computeSize = () => [0, -4];
    widget.draw = () => { };
    if (widget.element) widget.element.style.display = "none";
}

function drawRoundedRect(ctx, x, y, w, h, fill, stroke) {
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

/** 토글 스위치. 클릭 범위 [x, width] 를 돌려준다. */
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

/** ◀ 값 ▶ 묶음. [왼쪽화살표, 숫자, 오른쪽화살표] 의 [x, width] 를 돌려준다. */
function drawNumber(ctx, leftX, posY, height, text) {
    const midY = posY + height / 2;
    let posX = leftX;

    ctx.save();
    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";

    ctx.fill(new Path2D(
        `M ${posX} ${midY} l ${ARROW_W} ${ARROW_H / 2} l 0 -${ARROW_H} L ${posX} ${midY} z`
    ));
    const left = [posX, ARROW_W];
    posX += ARROW_W + INNER;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, posX + NUM_W / 2, midY);
    const num = [posX, NUM_W];
    posX += NUM_W + INNER;

    ctx.fill(new Path2D(
        `M ${posX} ${midY - ARROW_H / 2} l ${ARROW_W} ${ARROW_H / 2} l -${ARROW_W} ${ARROW_H / 2} v -${ARROW_H} z`
    ));
    const right = [posX, ARROW_W];

    ctx.restore();
    return [left, num, right];
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) {
        s = s.slice(0, -1);
    }
    return s + "…";
}

function inBounds(pos, bounds) {
    if (!bounds) return false;
    return pos[0] >= bounds[0] && pos[0] <= bounds[0] + bounds[1];
}

function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
}

/** 1024x1024 → "1:1". 파이썬 ratio_text 와 같은 규칙. */
function ratioText(w, h) {
    if (w <= 0 || h <= 0) return "-";
    const g = gcd(w, h);
    const rw = w / g;
    const rh = h / g;
    if (rw <= 64 && rh <= 64) return `${rw}:${rh}`;
    return `${(w / h).toFixed(2)}:1`;
}

/** "9:7" → [9, 7]. 못 읽으면 null. */
function parseRatio(text) {
    const m = String(text ?? "").match(/(\d+)\s*:\s*(\d+)/);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    return (a > 0 && b > 0) ? [a, b] : null;
}

/** 캔버스 위에 임시 입력창을 띄운다. 팝업 대신 그 자리에서 고치는 느낌. */
function inlineEdit(node, bounds, rowY, value, onDone) {
    // 입력창이 캔버스를 덮어 pointerup 이 오지 않는다
    releaseWidgetCaptureSoon();
    const canvas = app.canvas;
    const el = document.createElement("input");
    el.type = "number";
    el.value = String(value ?? "");

    // 노드 좌표 → 화면 좌표
    const scale = canvas.ds.scale;
    const [ox, oy] = canvas.ds.offset;
    const rect = canvas.canvas.getBoundingClientRect();
    const x = (node.pos[0] + bounds[0] + ox) * scale + rect.left;
    const y = (node.pos[1] + rowY + oy) * scale + rect.top;

    Object.assign(el.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: `${bounds[1] * scale}px`,
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
        const num = parseInt(el.value, 10);
        el.remove();
        if (commit && !isNaN(num)) onDone(num);
        node.setDirtyCanvas(true, true);
    };
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
        e.stopPropagation();
    });
    el.addEventListener("blur", () => finish(true));
}

app.registerExtension({
    name: "FLA.Resolution",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            const node = this;

            const wW = find(node, "width");
            const hW = find(node, "height");
            const presetW = find(node, "preset");
            const groupW = find(node, "group");
            const ratioW = find(node, "ratio");
            const linkW = find(node, "link_ratio");
            const swapW = find(node, "swap");
            [wW, hW, presetW, groupW, ratioW, linkW, swapW].forEach(hide);

            const getW = () => wW?.value ?? 1024;
            const getH = () => hW?.value ?? 1024;
            const isLinked = () => linkW?.value !== false;
            // swap 위젯은 값을 직접 맞바꾸는 방식으로 바뀌면서 쓰지 않게 되었다.
            // 파이썬 입력 순서를 유지해야 하므로 위젯 자체는 남겨둔다.

            /** 값을 8의 배수로 맞춰 넣는다.
             *  파이썬이 최종적으로 8의 배수로 내리므로, 화면에도 같은 값을 보여야 한다. */
            const setVal = (widget, v) => {
                if (!widget) return;
                const min = widget.options?.min ?? 64;
                const max = widget.options?.max ?? 8192;
                const snapped = Math.round(v / 8) * 8;
                widget.value = Math.min(max, Math.max(min, snapped));
                widget.callback?.(widget.value);
            };

            /** 지금 크기와 일치하는 목록 항목의 이름을 찾는다. 없으면 "" */
            const matchPreset = () => {
                const w = getW();
                const h = getH();
                const list = cache ?? [];
                // 같은 크기가 여러 그룹에 있을 수 있다. 지금 그룹 것을 먼저 찾는다.
                const g = groupW?.value || "";
                const here = list.find(
                    (it) => it.w === w && it.h === h && it.group === g);
                if (here) return here.label;
                const any = list.find((it) => it.w === w && it.h === h);
                return any ? any.label : "";
            };

            /** 목록에서 고른 항목을 노드에 반영한다. */
            const applyItem = (hit) => {
                setVal(wW, hit.w);
                setVal(hW, hit.h);
                if (ratioW) ratioW.value = ratioText(hit.w, hit.h);
                if (presetW) presetW.value = matchPreset();
                node.setDirtyCanvas(true, true);
            };

            /** 크기가 바뀐 뒤 비율/목록 표시를 다시 계산한다. */
            const sync = () => {
                if (ratioW) {
                    ratioW.value = ratioText(getW(), getH());
                }
                if (presetW) {
                    presetW.value = matchPreset();
                }
                node.setDirtyCanvas(true, true);
            };

            /** 한쪽을 바꿀 때 비율 연동이면 반대쪽을 맞춘다. */
            const setSide = (isWidth, value) => {
                const r = parseRatio(ratioW?.value);
                if (isWidth) {
                    setVal(wW, value);
                    if (isLinked() && r) setVal(hW, value * r[1] / r[0]);
                } else {
                    setVal(hW, value);
                    if (isLinked() && r) setVal(wW, value * r[0] / r[1]);
                }
                // 연동 중에는 비율이 유지되므로 목록 이름만 갱신한다
                if (isLinked() && r) {
                    if (presetW) presetW.value = matchPreset();
                    node.setDirtyCanvas(true, true);
                } else {
                    sync();
                }
            };

            // ── 1줄: 권장 목록 ──
            const listRow = {
                type: "custom",
                name: "fla_list_row",
                serialize: false,
                get tooltip() { return t("tipListRow"); },
                bounds: { group: null, name: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const gap = 4;
                    const width = node.size?.[0] ?? widgetWidth;
                    const midY = posY + height * 0.5;
                    this.lastY = posY;

                    const total = width - margin * 2;
                    const gW = Math.max(50, total / 3 - gap / 2);   // 왼쪽 1/3
                    const rW = total - gW - gap;                   // 오른쪽 2/3

                    // 왼쪽: 그룹
                    drawRoundedRect(ctx, margin, posY, gW, height, "#2f4258", "#456781");
                    // 오른쪽: 해상도
                    drawRoundedRect(ctx, margin + gW + gap, posY, rW, height,
                        "#2b3b4a", "#3f5a70");

                    ctx.save();
                    ctx.textBaseline = "middle";
                    ctx.textAlign = "left";

                    const gName = groupW?.value || t("group");
                    ctx.fillStyle = groupW?.value ? "#bcd4e6" : "#7a8c99";
                    ctx.fillText(fitText(ctx, gName, gW - 12), margin + 6, midY);
                    this.bounds.group = [margin, gW];

                    // 해상도는 그룹 부분을 뺀 이름만 보여준다
                    const full = presetW?.value || "";
                    const short = full.includes(" / ")
                        ? full.slice(full.lastIndexOf(" / ") + 3)
                        : (full || t("manual"));
                    const rx = margin + gW + gap;
                    ctx.fillStyle = full ? (LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD") : "#7a8c99";
                    ctx.fillText(fitText(ctx, short, rW - 12), rx + 6, midY);
                    this.bounds.name = [rx, rW];

                    ctx.restore();
                },
                /** 지금 그룹에 속한 항목만 추린다. 즐겨찾기 그룹이면 별표만 모은다. */
                itemsOfGroup(items) {
                    const g = groupW?.value || "";
                    if (g === FAV_GROUP()) return items.filter((it) => it.favorite);
                    return items.filter((it) => it.group === g);
                },
                mouse(event, pos) {
                    const g = mouseGate(event);
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    if (g === "down") return;
                    if (g !== "up") return false;

                    // ── 왼쪽: 그룹 → 항목 (폴더 구조) ──
                    if (inBounds(pos, this.bounds.group)) {
                        loadItems().then((items) => {
                            if (!items.length) return;
                            const map = new Map();
                            for (const it of items) {
                                if (!it.favorite) continue;
                                map.set(`${FAV_GROUP()} / ${it.name}   ·  ${it.group}`, it);
                            }
                            for (const it of items) {
                                const nm = it.favorite ? `★ ${it.name}` : it.name;
                                map.set(`${it.group} / ${nm}`, it);
                            }
                            openMenu([...map.keys()], event, (val) => {
                                const hit = map.get(val);
                                if (!hit) return;
                                // 즐겨찾기 쪽에서 골랐으면 그룹도 즐겨찾기로 둔다
                                if (groupW) {
                                    groupW.value = val.startsWith(FAV_GROUP() + " / ")
                                        ? FAV_GROUP()
                                        : hit.group;
                                }
                                applyItem(hit);
                            });
                        });
                        return true;
                    }

                    // ── 오른쪽: 현재 그룹 안에서 바로 고르기 ──
                    if (inBounds(pos, this.bounds.name)) {
                        loadItems().then((items) => {
                            let list = this.itemsOfGroup(items);
                            // 그룹이 아직 없으면 전체에서 고르게 한다
                            if (!list.length) list = items;
                            if (!list.length) return;

                            const fav = groupW?.value === FAV_GROUP();
                            const map = new Map();
                            for (const it of list) {
                                const nm = fav
                                    ? `${it.name}   ·  ${it.group}`
                                    : (it.favorite ? `★ ${it.name}` : it.name);
                                map.set(nm, it);
                            }
                            openMenu([...map.keys()], event, (val) => {
                                const hit = map.get(val);
                                if (!hit) return;
                                if (groupW && !groupW.value) groupW.value = hit.group;
                                applyItem(hit);
                            });
                        });
                        return true;
                    }
                    return false;
                },
            };

            // ── 2줄: H ◀ 값 ▶   W ◀ 값 ▶   (연동 토글) ──
            const sizeRow = {
                type: "custom",
                name: "fla_size_row",
                serialize: false,
                get tooltip() { return t("tipSizeRow"); },
                bounds: {
                    aDec: null, aVal: null, aInc: null,
                    bDec: null, bVal: null, bInc: null, toggle: null,
                },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const inner = margin * 0.33;
                    const width = node.size?.[0] ?? widgetWidth;
                    const midY = posY + height * 0.5;
                    this.lastY = posY;

                    drawRoundedRect(ctx, margin, posY, width - margin * 2, height,
                        "#333a45", "#454e5c");

                    ctx.save();
                    ctx.textBaseline = "middle";

                    // 오른쪽 끝: 비율 연동 토글
                    const tW = height * 1.5;
                    const tX = width - margin - inner - tW;
                    this.bounds.toggle = drawToggle(ctx, tX, posY, height, isLinked());

                    // 편집 칸은 항상 W(가로) / H(세로) 그대로 둔다.
                    // 스왑은 최종 출력에서만 바꾸므로 여기서 라벨을 뒤집으면
                    // 라벨과 값이 어긋나 엉뚱한 쪽이 수정된다.
                    const leftLabel = "W";
                    const rightLabel = "H";

                    const usable = tX - margin - 6;
                    const half = usable / 2;

                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                    ctx.textAlign = "left";
                    ctx.fillText(leftLabel, margin + 8, midY);
                    const [ad, av, ai] = drawNumber(ctx, margin + 24, posY, height, String(getW()));
                    this.bounds.aDec = ad; this.bounds.aVal = av; this.bounds.aInc = ai;

                    const rx = margin + half + 12;
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                    ctx.fillText(rightLabel, rx, midY);
                    const [bd, bv, bi] = drawNumber(ctx, rx + 16, posY, height, String(getH()));
                    this.bounds.bDec = bd; this.bounds.bVal = bv; this.bounds.bInc = bi;

                    ctx.restore();
                },
                mouse(event, pos) {
                    const g = mouseGate(event);
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    if (g === "down") return;
                    if (g !== "up") return false;

                    if (inBounds(pos, this.bounds.toggle)) {
                        if (linkW) {
                            linkW.value = linkW.value === false;
                            linkW.callback?.(linkW.value);
                        }
                        node.setDirtyCanvas(true, true);
                        return true;
                    }

                    const step = 8;
                    if (inBounds(pos, this.bounds.aDec)) { setSide(true, getW() - step); return true; }
                    if (inBounds(pos, this.bounds.aInc)) { setSide(true, getW() + step); return true; }
                    if (inBounds(pos, this.bounds.bDec)) { setSide(false, getH() - step); return true; }
                    if (inBounds(pos, this.bounds.bInc)) { setSide(false, getH() + step); return true; }

                    // 숫자 클릭
                    if (inBounds(pos, this.bounds.aVal)) {
                        if (isLinked()) {
                            // 연동 중이면 해상도 목록에서 고른다
                            this.pickNumber(event, true);
                        } else {
                            inlineEdit(node, this.bounds.aVal, this.lastY, getW(),
                                (v) => { setVal(wW, v); sync(); });
                        }
                        return true;
                    }
                    if (inBounds(pos, this.bounds.bVal)) {
                        if (isLinked()) {
                            this.pickNumber(event, false);
                        } else {
                            inlineEdit(node, this.bounds.bVal, this.lastY, getH(),
                                (v) => { setVal(hW, v); sync(); });
                        }
                        return true;
                    }
                    return false;
                },
                /** 연동 상태에서 숫자를 누르면 흔한 길이 목록을 띄운다. */
                pickNumber(event, isWidth) {
                    const nums = [512, 640, 704, 768, 832, 896, 960, 1024, 1088, 1152,
                        1216, 1280, 1344, 1408, 1536, 1664, 1792, 1920, 2048];
                    openMenu(nums.map(String), event, (v) => {
                        const val = parseInt(v, 10);
                        if (!isNaN(val)) setSide(isWidth, val);
                    });
                },
            };

            // ── 3줄: 비율 + 스왑 토글 ──
            const ratioRow = {
                type: "custom",
                name: "fla_ratio_row",
                serialize: false,
                get tooltip() { return t("tipRatioRow"); },
                bounds: { name: null, toggle: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const inner = margin * 0.33;
                    const width = node.size?.[0] ?? widgetWidth;
                    const midY = posY + height * 0.5;
                    const live = isLinked();

                    drawRoundedRect(ctx, margin, posY, width - margin * 2, height,
                        live ? "#2b3b4a" : "#2a2a2a",
                        live ? "#3f5a70" : "#3a3a3a");

                    ctx.save();
                    if (!live) ctx.globalAlpha = 0.45;

                    // 오른쪽 끝: 가로/세로 맞바꾸기.
                    // 토글 표시는 지금이 세로형(H > W)인지를 나타낸다.
                    const tW = height * 1.5;
                    const tX = width - margin - inner - tW;
                    const portrait = getH() > getW();
                    this.bounds.toggle = drawToggle(ctx, tX, posY, height, portrait, live);

                    // 가운데: 실제 크기에서 계산한 비율
                    const r = parseRatio(ratioW?.value) ?? [1, 1];
                    const shown = `${r[0]}:${r[1]}`;
                    const nameX = margin + 8;
                    const nameW = Math.max(10, tX - inner * 2 - nameX);
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(shown, nameX + nameW / 2, midY);
                    this.bounds.name = [nameX, nameW];

                    ctx.restore();
                },
                mouse(event, pos) {
                    const g = mouseGate(event);
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    if (g === "down") return;
                    if (g !== "up") return false;

                    // 스왑 토글은 연동이 꺼져 있어도 쓸 수 있게 둔다.
                    // 값 자체를 맞바꾸므로 W/H 칸과 비율 표기가 함께 뒤집힌다.
                    if (inBounds(pos, this.bounds.toggle)) {
                        const w = getW();
                        const h = getH();
                        setVal(wW, h);
                        setVal(hW, w);
                        if (ratioW) ratioW.value = ratioText(h, w);
                        if (presetW) presetW.value = matchPreset();
                        node.setDirtyCanvas(true, true);
                        return true;
                    }
                    if (!isLinked()) return false;      // 회색일 때는 비율 선택 불가
                    if (!inBounds(pos, this.bounds.name)) return false;

                    // 비율은 목록과 별개로 흔한 것들을 쓴다
                    const RATIOS = [
                        [1, 1], [4, 3], [3, 2], [16, 10], [16, 9], [21, 9],
                        [5, 4], [2, 1], [3, 4], [2, 3], [9, 16],
                    ];
                    openMenu(RATIOS.map(([a, b]) => `${a}:${b}`), event, (val) => {
                        const r = parseRatio(val);
                        if (!r) return;
                        if (ratioW) ratioW.value = `${r[0]}:${r[1]}`;
                        // 긴 변을 유지한 채 새 비율을 적용한다
                        const base = Math.max(getW(), getH());
                        const s = base / Math.max(r[0], r[1]);
                        setVal(wW, r[0] * s);
                        setVal(hW, r[1] * s);
                        if (presetW) presetW.value = matchPreset();
                        node.setDirtyCanvas(true, true);
                    });
                    return true;
                },
            };

            // ── 목록 편집기 ──
            // 편집 줄들은 토글이 켜졌을 때만 만들어진다.
            node.flaEditing = false;

            /** 편집 줄 하나. [★] W ◀값▶ H ◀값▶ [✕] 가 한 줄에 들어간다. */
            const makeEditRow = (group, idx) => ({
                type: "custom",
                name: `fla_edit_${group}_${idx}`,
                serialize: false,
                get tooltip() { return t("tipEditRow"); },
                flaEditRow: true,
                bounds: { fav: null, w: null, h: null, del: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const it = groups?.[group]?.[idx];
                    if (!it) return;
                    const margin = 10;
                    const inner = margin * 0.33;
                    const width = node.size?.[0] ?? widgetWidth;
                    const midY = posY + height * 0.5;
                    this.lastY = posY;

                    drawRoundedRect(ctx, margin, posY, width - margin * 2, height,
                        it.favorite ? "#2f3b2c" : "#2a2a2a",
                        it.favorite ? "#4a6146" : "#3a3a3a");

                    ctx.save();
                    ctx.textBaseline = "middle";

                    // 왼쪽: 즐겨찾기 별
                    const favW = 16;
                    const favX = margin + 6;
                    ctx.textAlign = "center";
                    ctx.fillStyle = it.favorite ? "#ffd479" : "#666";
                    ctx.fillText(it.favorite ? "★" : "☆", favX + favW / 2, midY);
                    this.bounds.fav = [favX, favW];

                    // 오른쪽 끝: 삭제
                    const delW = 14;
                    const delX = width - margin - inner - delW;
                    ctx.fillStyle = "#a66";
                    ctx.fillText("✕", delX + delW / 2, midY);
                    this.bounds.del = [delX, delW];

                    // 가운데: W / H 숫자 (클릭하면 그 자리에서 수정)
                    const avail = delX - (favX + favW) - 12;
                    const half = avail / 2;
                    const wx = favX + favW + 8;
                    ctx.textAlign = "left";
                    ctx.fillStyle = "#8a9aa6";
                    ctx.font = "10px Arial";
                    ctx.fillText("W", wx, midY);
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                    ctx.font = "12px Arial";
                    ctx.fillText(String(it.w), wx + 14, midY);
                    this.bounds.w = [wx + 14, half - 20];

                    const hx = wx + half;
                    ctx.fillStyle = "#8a9aa6";
                    ctx.font = "10px Arial";
                    ctx.fillText("H", hx, midY);
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR ?? "#DDD";
                    ctx.font = "12px Arial";
                    ctx.fillText(String(it.h), hx + 14, midY);
                    this.bounds.h = [hx + 14, half - 20];

                    ctx.restore();
                },
                mouse(event, pos) {
                    const g = mouseGate(event);
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    if (g === "down") return;
                    if (g !== "up") return false;
                    const it = groups?.[group]?.[idx];
                    if (!it) return false;

                    if (inBounds(pos, this.bounds.fav)) {
                        it.favorite = !it.favorite;
                        saveGroups(groups).then(() => rebuildEditor());
                        return true;
                    }
                    if (inBounds(pos, this.bounds.del)) {
                        groups[group].splice(idx, 1);
                        if (!groups[group].length) delete groups[group];
                        saveGroups(groups).then(() => rebuildEditor());
                        return true;
                    }
                    if (inBounds(pos, this.bounds.w)) {
                        inlineEdit(node, this.bounds.w, this.lastY, it.w, (v) => {
                            it.w = Math.max(64, Math.min(8192, Math.round(v / 8) * 8));
                            saveGroups(groups).then(() => rebuildEditor());
                        });
                        return true;
                    }
                    if (inBounds(pos, this.bounds.h)) {
                        inlineEdit(node, this.bounds.h, this.lastY, it.h, (v) => {
                            it.h = Math.max(64, Math.min(8192, Math.round(v / 8) * 8));
                            saveGroups(groups).then(() => rebuildEditor());
                        });
                        return true;
                    }
                    return false;
                },
            });

            /** 그룹 머리글 줄. */
            const makeGroupRow = (group) => ({
                type: "custom",
                name: `fla_group_${group}`,
                serialize: false,
                flaEditRow: true,
                computeSize() {
                    return [0, ROW_HEIGHT - 4];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const width = node.size?.[0] ?? widgetWidth;
                    ctx.save();
                    ctx.fillStyle = "#7a8c99";
                    ctx.font = "10px Arial";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillText(group, margin + 6, posY + height * 0.5);
                    ctx.strokeStyle = "#3a4550";
                    ctx.beginPath();
                    const tx = margin + 12 + ctx.measureText(group).width;
                    ctx.moveTo(tx, posY + height * 0.5);
                    ctx.lineTo(width - margin, posY + height * 0.5);
                    ctx.stroke();
                    ctx.restore();
                },
            });

            /** 편집 줄들을 다시 만든다. */
            const rebuildEditor = () => {
                const keep = node.size?.[0];
                node.widgets = node.widgets.filter((w) => !w.flaEditRow);

                if (node.flaEditing && groups) {
                    for (const group of Object.keys(groups)) {
                        node.widgets.push(makeGroupRow(group));
                        groups[group].forEach((_, i) => {
                            node.widgets.push(makeEditRow(group, i));
                        });
                    }
                    node.widgets.push(addRow);
                    node.widgets.push(resetRow);
                }

                // 폭은 그대로 두고 높이는 줄 수에 맞춰 다시 계산한다.
                // 계산하지 않으면 편집기를 닫아도 늘어난 높이가 그대로 남는다.
                if (keep) node.size[0] = keep;
                const needed = node.computeSize?.()?.[1];
                if (needed) node.size[1] = needed;

                // 예외가 새면 캡처가 남아 위젯이 전부 먹통이 된다
                guardNodeWidgets(node);

                node.setDirtyCanvas(true, true);
            };

            /** 항목 추가 버튼. */
            const addRow = {
                type: "custom",
                name: "fla_add_row",
                serialize: false,
                get tooltip() { return t("tipAddRow"); },
                flaEditRow: true,
                bounds: { add: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const width = node.size?.[0] ?? widgetWidth;
                    drawRoundedRect(ctx, margin, posY, width - margin * 2, height,
                        "#3a3a2a", "#5a5a3a");
                    ctx.save();
                    ctx.fillStyle = "#d5c98a";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(t("addCurrent"), width / 2, posY + height * 0.5);
                    ctx.restore();
                    this.bounds.add = [margin, width - margin * 2];
                },
                mouse(event, pos) {
                    const g = mouseGate(event);
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    if (g === "down") return;
                    if (g !== "up") return false;
                    if (!inBounds(pos, this.bounds.add)) return false;

                    releaseWidgetCaptureSoon();
                    const name = window.prompt(t("askGroup"),
                        Object.keys(groups ?? {})[0] ?? t("defaultGroup"));
                    if (!name) return true;
                    if (!groups[name]) groups[name] = [];
                    groups[name].push({ w: getW(), h: getH(), favorite: false });
                    saveGroups(groups).then(() => rebuildEditor());
                    return true;
                },
            };

            /** 초기화 버튼. 기본 목록으로 되돌린다. */
            const resetRow = {
                type: "custom",
                name: "fla_reset_row",
                serialize: false,
                get tooltip() { return t("tipResetRow"); },
                flaEditRow: true,
                bounds: { reset: null },
                computeSize() {
                    return [0, ROW_HEIGHT];
                },
                draw(ctx, n, widgetWidth, posY, height) {
                    const margin = 10;
                    const width = node.size?.[0] ?? widgetWidth;
                    drawRoundedRect(ctx, margin, posY, width - margin * 2, height,
                        "#3a2a2a", "#5e3a3a");
                    ctx.save();
                    ctx.fillStyle = "#e0a0a0";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(t("resetList"), width / 2, posY + height * 0.5);
                    ctx.restore();
                    this.bounds.reset = [margin, width - margin * 2];
                },
                mouse(event, pos) {
                    const g = mouseGate(event);
                    // 반환값은 dirty_canvas 로만 쓰인다. up 에서만 처리한다.
                    if (g === "down") return;
                    if (g !== "up") return false;
                    if (!inBounds(pos, this.bounds.reset)) return false;

                    releaseWidgetCaptureSoon();
                    if (!confirm(t("confirmReset"))) {
                        return true;
                    }
                    resetGroups().then((ok) => {
                        if (ok) rebuildEditor();
                    });
                    return true;
                },
            };

            // 편집 토글
            const editToggle = node.addWidget("toggle", t("editList"), false, (v) => {
                node.flaEditing = v;
                if (v) {
                    loadItems(true).then(() => rebuildEditor());
                } else {
                    rebuildEditor();
                }
            });
            editToggle.serialize = false;

            node.widgets.push(listRow, sizeRow, ratioRow);
            const order = [listRow, sizeRow, ratioRow, editToggle];
            node.widgets = node.widgets.filter((w) => !order.includes(w)).concat(order);
            guardNodeWidgets(node);

            if (!node.size?.[0] || node.size[0] < 300) {
                node.size = [320, node.size?.[1] ?? 0];
            }

            // 목록을 받아 온 뒤 현재 크기에 맞는 이름을 채운다
            loadItems().then((items) => {
                if (presetW && !presetW.value) presetW.value = matchPreset();
                if (ratioW && !parseRatio(ratioW.value)) {
                    ratioW.value = ratioText(getW(), getH());
                }
                // 그룹이 비어 있으면 현재 크기가 속한 그룹, 없으면 첫 그룹으로 맞춘다
                if (groupW && !groupW.value) {
                    const hit = items.find((it) => it.w === getW() && it.h === getH());
                    groupW.value = hit ? hit.group : (items[0]?.group ?? "");
                }
                node.setDirtyCanvas(true, true);
            });
        };
    },
});
