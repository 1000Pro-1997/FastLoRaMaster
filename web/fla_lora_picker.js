import { t } from "./fla_i18n.js";
import { releaseWidgetCapture, releaseWidgetCaptureSoon } from "./fla_widget_mouse.js";

let libraryPromise;
let settingsCache = null;

/** 사용자 설정을 읽는다. 실패해도 UI 는 기본값으로 계속 돌아간다. */
async function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
        const res = await fetch("/fla/settings");
        settingsCache = res.ok ? ((await res.json()).settings ?? {}) : {};
    } catch (e) {
        settingsCache = {};
    }
    return settingsCache;
}

/** 바뀐 값만 서버에 저장한다. 저장 실패는 조용히 넘긴다(작업을 막지 않는다). */
function saveSettings(patch) {
    settingsCache = { ...(settingsCache ?? {}), ...patch };
    fetch("/fla/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: patch }),
    }).catch(() => { /* 저장 실패해도 화면은 그대로 쓴다 */ });
}

async function library() {
    libraryPromise ??= fetch("/fla/lora-library").then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
    }).then((data) => data.items);
    return libraryPromise;
}

async function saveFavorite(item, favorite) {
    const res = await fetch("/fla/lora-favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, favorite }),
    });
    if (!res.ok) throw new Error(res.statusText);
    item.favorite = (await res.json()).favorite;
}

function addStyles() {
    if (document.getElementById("fla-lora-picker-style")) return;
    const style = document.createElement("style");
    style.id = "fla-lora-picker-style";
    style.textContent = `
      .fla-lp-bg{position:fixed;inset:0;z-index:100000;background:#000a;display:grid;place-items:center;padding:3vh}.fla-lp{width:min(1400px,96vw);height:min(900px,94vh);display:flex;flex-direction:column;background:#181a1f;color:#ddd;border:1px solid #4b5360;border-radius:12px;overflow:hidden;box-shadow:0 22px 70px #000;font:14px Arial,sans-serif}
      .fla-lp-head{display:flex;gap:10px;padding:12px;background:#22262d;border-bottom:1px solid #383e48}.fla-lp-head input{flex:1;height:38px;min-width:100px;padding:0 12px;color:#eee;background:#111419;border:1px solid #454c58;border-radius:7px}.fla-lp-head button{height:38px;padding:0 13px;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;cursor:pointer}.fla-lp-head .fav.on{color:#ffd34e;background:#493d21;border-color:#9f7c23}.fla-lp-head .close{width:38px;padding:0;font-size:20px}
      .fla-lp-main{display:flex;flex:1;min-height:0}.fla-lp-side{width:230px;flex:none;padding:8px;overflow-y:scroll;scrollbar-gutter:stable;background:#20242a;border-right:1px solid #383e48}.fla-lp-side-tools{display:flex;justify-content:flex-end;gap:4px;height:31px;padding:0 4px 5px;border-bottom:1px solid #343a43;margin-bottom:5px}.fla-lp-side-tools button{display:grid;width:30px;height:27px;padding:0;place-items:center;color:#7d858f;background:transparent;border:0;border-radius:5px;font-size:17px;cursor:pointer}.fla-lp-side-tools button:hover{background:#303640}.fla-lp-side-tools button.on{color:#40a8ff;background:#263d52}.fla-lp-side-tools button.star-on{color:#ffd34e;background:#493d21}.fla-lp-folder{display:flex;align-items:center;width:100%;height:31px;padding:0 8px;color:#c8cdd5;background:transparent;border:0;border-radius:5px;text-align:left;white-space:nowrap;overflow:hidden;cursor:pointer}.fla-lp-folder:hover{background:#303640}.fla-lp-folder.on{color:#72baff;background:#283f55;font-weight:600}.fla-lp-indent{display:inline-block;flex:none}.fla-lp-fold{display:inline-grid;width:18px;height:24px;flex:none;place-items:center;color:#a8b0ba}.fla-lp-folder-name{overflow:hidden;text-overflow:ellipsis}
      .fla-lp-content{display:flex;flex:1;min-width:0;flex-direction:column}.fla-lp-path{display:flex;align-items:center;min-height:41px;padding:0 12px;gap:4px;background:#1d2026;border-bottom:1px solid #383e48}.fla-lp-crumb{position:relative;display:inline-flex;align-items:center}.fla-lp-crumb>button{padding:6px 2px;color:#72baff;background:transparent;border:0;cursor:pointer}.fla-lp-crumb .arrow{padding-left:5px}.fla-lp-menu{position:absolute;z-index:5;left:0;top:30px;min-width:175px;max-height:300px;padding:5px;overflow-y:auto;background:#292d34;border:1px solid #505763;border-radius:6px;box-shadow:0 8px 25px #000}.fla-lp-menu button{display:block;width:100%;padding:7px 10px;color:#ddd;background:transparent;border:0;border-radius:4px;text-align:left;cursor:pointer}.fla-lp-menu button:hover{background:#3a424e}.fla-lp-count{margin-left:auto;color:#929ba8}
      .fla-lp-grid{flex:1;min-height:0;padding:12px;overflow-x:hidden;overflow-y:scroll;scrollbar-gutter:stable;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));grid-auto-rows:max-content;align-content:start;align-items:start;gap:12px}.fla-lp-card{position:relative;display:block;min-width:0;height:auto;padding:0;overflow:hidden;color:#ddd;background:#242830;border:1px solid #3b424d;border-radius:9px;cursor:pointer;box-sizing:border-box}.fla-lp-card:hover{border-color:#79a9d1;box-shadow:0 3px 14px #0008}.fla-lp-preview{position:relative;display:grid;width:100%;height:auto;aspect-ratio:3 / 4;place-items:center;overflow:hidden;color:#59616d;background:#111318}.fla-lp-preview img,.fla-lp-preview video{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}.fla-lp-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(#000b,#0000 32%,#0000 55%,#000c)}
      .fla-lp-title{position:absolute;top:9px;left:9px;right:42px;overflow:hidden;color:#fff;font-weight:700;text-overflow:ellipsis;text-shadow:0 1px 3px #000;white-space:nowrap}.fla-lp-star{position:absolute;z-index:2;top:6px;right:7px;width:30px;height:30px;padding:0;color:#fff;background:#111a;border:0;border-radius:50%;font-size:20px;cursor:pointer}.fla-lp-star.on{color:#ffd34e}.fla-lp-badge{position:absolute;left:8px;bottom:8px;max-width:65%;padding:3px 6px;overflow:hidden;color:#fff;background:#111d;border-radius:4px;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.fla-lp-version{position:absolute;right:8px;bottom:8px;max-width:30%;overflow:hidden;color:#ddd;font-size:12px;text-overflow:ellipsis;text-shadow:0 1px 3px #000;white-space:nowrap}.fla-lp-file{padding:8px 10px;overflow:hidden;color:#aab2bd;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.fla-lp-mark{padding:0 1px;color:#171717;background:#ffd84d;border-radius:2px;text-shadow:none}.fla-lp-empty{padding:70px;text-align:center;color:#89919d}
      .fla-lp-blur{filter:blur(18px);transform:scale(1.06)}.fla-lp-veil{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;background:#0006}.fla-lp-veil span{padding:5px 11px;color:#fff;background:#000a;border-radius:6px;font-size:13px;font-weight:700}.fla-lp-veil button{padding:5px 15px;color:#fff;background:#2f6fd0;border:0;border-radius:6px;font-size:12px;cursor:pointer}.fla-lp-veil button:hover{background:#3b82f6}.fla-lp-head .adult.on{color:#fff;background:#c0392b;border-color:#e05c4a}
    `;
    document.head.appendChild(style);
}

function allFolders(items) {
    const result = new Set([""]);
    for (const item of items) {
        const parts = item.folder.split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) result.add(parts.slice(0, i).join("/"));
    }
    return [...result].sort((a, b) => a.localeCompare(b));
}

function contains(item, folder) {
    return !folder || item.folder === folder || item.folder.startsWith(folder + "/");
}

function modelBadge(base) {
    const match = String(base).match(/SDXL|SD\s*1(?:\.\d)?|SD\s*2(?:\.\d)?|Pony|Flux|Wan\s*\d(?:\.\d)?/i);
    return `LoRA${base ? ` | ${match ? match[0].replace(/\s/g, "") : base}` : ""}`;
}

function highlighted(element, text, query) {
    element.replaceChildren();
    if (!query) {
        element.textContent = text;
        return;
    }
    const lower = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let start = 0;
    let found;
    while ((found = lower.indexOf(needle, start)) !== -1) {
        element.append(document.createTextNode(text.slice(start, found)));
        const mark = document.createElement("span");
        mark.className = "fla-lp-mark";
        mark.textContent = text.slice(found, found + needle.length);
        element.appendChild(mark);
        start = found + needle.length;
    }
    element.append(document.createTextNode(text.slice(start)));
}

function makePreview(item, interactive = false, blur = false, onReveal = null) {
    const preview = document.createElement("div"); preview.className = "fla-lp-preview";
    if (item.preview) {
        const media = document.createElement(item.preview_type === "video" ? "video" : "img"); media.src = item.preview;
        if (blur) media.classList.add("fla-lp-blur");
        if (media.tagName === "VIDEO") { media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true; media.preload = "metadata"; }
        media.onerror = () => { media.remove(); preview.prepend("LoRA"); }; preview.appendChild(media);
    } else preview.append("LoRA");
    const shade = document.createElement("div"); shade.className = "fla-lp-shade";
    const title = document.createElement("div"); title.className = "fla-lp-title"; title.textContent = item.title;
    const star = document.createElement("button"); star.className = `fla-lp-star${item.favorite ? " on" : ""}`;
    star.textContent = item.favorite ? "★" : "☆";
    star.title = t("loraFavorites");
    star.onclick = async (event) => {
        event.stopPropagation(); star.disabled = true;
        try { await saveFavorite(item, !item.favorite); star.classList.toggle("on", item.favorite); star.textContent = item.favorite ? "★" : "☆"; }
        finally { star.disabled = false; }
    };
    const badge = document.createElement("div"); badge.className = "fla-lp-badge"; badge.textContent = modelBadge(item.base_model);
    const version = document.createElement("div"); version.className = "fla-lp-version"; version.textContent = item.version || "";
    preview.append(shade, title, star, badge, version);

    // 성인물 가림막. "보기" 를 누르면 이 카드만 풀린다.
    if (blur) {
        const veil = document.createElement("div"); veil.className = "fla-lp-veil";
        const label = document.createElement("span"); label.textContent = t("adultLabel");
        const show = document.createElement("button"); show.textContent = t("adultShow");
        show.onclick = (event) => { event.stopPropagation(); onReveal?.(); };
        veil.append(label, show);
        preview.appendChild(veil);
    }

    if (!interactive) star.tabIndex = -1;
    return preview;
}

export async function pickLora() {
    // 전체 화면 모달이 커서를 덮어 캔버스가 pointerup 을 못 받는다.
    // 위젯 캡처를 미리 풀지 않으면 닫은 뒤 다른 버튼이 눌리지 않는다.
    releaseWidgetCaptureSoon();
    const [items, saved] = await Promise.all([library(), loadSettings()]);
    if (!items.length) return null;
    addStyles();
    return new Promise((resolve) => {
        // 저장해둔 사용자 설정에서 시작한다
        let folder = typeof saved.folder === "string" ? saved.folder : "";
        let favoritesOnly = saved.favoritesOnly === true;
        let includeChildren = saved.includeChildren !== false;
        let allExpanded = saved.allExpanded === true;
        // 성인물 가리기. 기본은 켜둔다(실수로 노출되지 않게).
        let blurAdult = saved.blurAdult !== false;
        // "보기" 로 개별 확인한 것들. 토글을 다시 켜면 비워서 전부 도로 가린다.
        const revealed = new Set();
        const folders = allFolders(items);
        const expanded = new Set(Array.isArray(saved.expanded) ? saved.expanded : []);
        if (folder && !folders.includes(folder)) folder = "";

        const bg = document.createElement("div");
        bg.className = "fla-lp-bg";
        bg.innerHTML = `<div class="fla-lp" role="dialog" aria-modal="true"><div class="fla-lp-head"><input type="search" placeholder="${t("searchLora")}"><button class="fav">☆ ${t("loraFavorites")}</button><button class="adult" title="${t("adultBlur")}">19</button><button class="close" title="${t("cancel")}">×</button></div><div class="fla-lp-main"><aside class="fla-lp-side"></aside><section class="fla-lp-content"><div class="fla-lp-path"></div><div class="fla-lp-grid"></div></section></div></div>`;
        document.body.appendChild(bg);
        const input = bg.querySelector("input");
        const fav = bg.querySelector(".fav");
        const adultBtn = bg.querySelector(".adult");
        const side = bg.querySelector(".fla-lp-side");
        const path = bg.querySelector(".fla-lp-path");
        const grid = bg.querySelector(".fla-lp-grid");

        const closeMenus = () => bg.querySelectorAll(".fla-lp-menu").forEach((menu) => menu.remove());
        const close = (value = null) => { document.removeEventListener("keydown", key); document.removeEventListener("click", outside); bg.remove(); resolve(value); };
        const key = (event) => { if (event.key === "Escape") bg.querySelector(".fla-lp-menu") ? closeMenus() : close(); };
        const outside = (event) => { if (!event.target.closest(".fla-lp-crumb")) closeMenus(); };
        const choose = (value) => {
            folder = value;
            saveSettings({ folder });
            const parts = value.split("/").filter(Boolean);
            for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join("/"));
            closeMenus(); render();
        };

        function folderButton(label, value, depth, hasChildren = false) {
            const button = document.createElement("button");
            button.className = `fla-lp-folder${folder === value ? " on" : ""}`;
            const indent = document.createElement("span"); indent.className = "fla-lp-indent"; indent.style.width = `${depth * 15}px`;
            const fold = document.createElement("span"); fold.className = "fla-lp-fold"; fold.textContent = hasChildren ? (expanded.has(value) ? "⌄" : ">") : "";
            fold.onclick = (event) => { event.stopPropagation(); expanded.has(value) ? expanded.delete(value) : expanded.add(value); allExpanded = false; saveSettings({ allExpanded, expanded: [...expanded] }); renderSide(); };
            const name = document.createElement("span"); name.className = "fla-lp-folder-name"; name.textContent = `${value ? "📁" : "⌂"}  ${label}`;
            button.append(indent, fold, name);
            button.onclick = () => { folder = value; saveSettings({ folder }); render(); };
            side.appendChild(button);
        }

        function renderSide() {
            side.replaceChildren();
            const tools = document.createElement("div"); tools.className = "fla-lp-side-tools";
            const descendants = document.createElement("button"); descendants.textContent = "⑂"; descendants.title = t("includeSubfolders"); descendants.classList.toggle("on", includeChildren);
            descendants.onclick = () => { includeChildren = !includeChildren; saveSettings({ includeChildren }); render(); };
            const expand = document.createElement("button"); expand.textContent = "↗↙"; expand.title = t("expandFolders"); expand.classList.toggle("on", allExpanded);
            expand.onclick = () => {
                allExpanded = !allExpanded;
                expanded.clear();
                if (allExpanded) for (const value of folders.filter(Boolean)) expanded.add(value);
                saveSettings({ allExpanded, expanded: [...expanded] });
                renderSide();
            };
            // 즐겨찾기 필터는 폴더 목록이 아니라 도구 줄에 별표로만 둔다
            const fav = document.createElement("button");
            fav.textContent = favoritesOnly ? "★" : "☆";
            fav.title = t("loraFavorites");
            fav.classList.toggle("star-on", favoritesOnly);
            fav.onclick = () => { favoritesOnly = !favoritesOnly; saveSettings({ favoritesOnly }); render(); };
            tools.append(fav, descendants, expand); side.appendChild(tools);
            folderButton(t("loraRoot"), "", 0);
            for (const value of folders.filter(Boolean)) {
                const parts = value.split("/");
                const parent = parts.slice(0, -1).join("/");
                if (parts.length > 1 && !expanded.has(parent)) continue;
                const hasChildren = folders.some((candidate) => candidate.startsWith(value + "/") && candidate.split("/").length === parts.length + 1);
                folderButton(parts.at(-1), value, parts.length - 1, hasChildren);
            }
        }

        function crumbMenu(host, choices) {
            closeMenus();
            const menu = document.createElement("div"); menu.className = "fla-lp-menu";
            for (const value of choices) { const button = document.createElement("button"); button.textContent = value.split("/").pop() || t("loraRoot"); button.onclick = () => choose(value); menu.appendChild(button); }
            host.appendChild(menu);
        }

        function renderPath(shown, total) {
            path.replaceChildren();
            const parts = folder.split("/").filter(Boolean);
            const crumbs = [[`⌂ ${t("loraRoot")}`, ""], ...parts.map((part, i) => [part, parts.slice(0, i + 1).join("/")])];
            crumbs.forEach(([label, value], index) => {
                if (index) path.append(document.createTextNode(" / "));
                const host = document.createElement("span"); host.className = "fla-lp-crumb";
                const button = document.createElement("button"); button.textContent = label; button.onclick = () => choose(value);
                const arrow = document.createElement("button"); arrow.className = "arrow"; arrow.textContent = "▾";
                arrow.onclick = (event) => { event.stopPropagation(); const parent = index < 2 ? "" : parts.slice(0, index - 1).join("/"); const depth = index || 1; const choices = folders.filter((f) => f !== value && f.split("/").filter(Boolean).length === depth && (!parent || f.startsWith(parent + "/"))); crumbMenu(host, choices); };
                host.append(button, arrow); path.appendChild(host);
            });
            path.append(document.createTextNode(" / "));
            const next = document.createElement("span"); next.className = "fla-lp-crumb";
            const nextButton = document.createElement("button"); nextButton.textContent = "-- ▾";
            const nextDepth = parts.length + 1;
            const children = folders.filter((value) => value.split("/").filter(Boolean).length === nextDepth && (!folder || value.startsWith(folder + "/")));
            nextButton.onclick = (event) => { event.stopPropagation(); crumbMenu(next, children); };
            next.appendChild(nextButton); path.appendChild(next);
            const count = document.createElement("span"); count.className = "fla-lp-count"; count.textContent = `${shown} / ${total}`; path.appendChild(count);
        }

        function render() {
            const query = input.value.trim().toLocaleLowerCase();
            const scoped = items.filter((item) => includeChildren ? contains(item, folder) : item.folder === folder);
            const shown = scoped.filter((item) => (!favoritesOnly || item.favorite) && (!query || `${item.name} ${item.title} ${item.version} ${item.base_model} ${(item.tags || []).join(" ")}`.toLocaleLowerCase().includes(query)));
            fav.classList.toggle("on", favoritesOnly); fav.textContent = `${favoritesOnly ? "★" : "☆"} ${t("loraFavorites")}`;
            renderSide(); renderPath(shown.length, scoped.length); grid.replaceChildren();
            if (!shown.length) { const empty = document.createElement("div"); empty.className = "fla-lp-empty"; empty.textContent = t("noLoras"); grid.appendChild(empty); return; }
            for (const item of shown) {
                const card = document.createElement("div"); card.className = "fla-lp-card"; card.title = item.name; card.tabIndex = 0; card.setAttribute("role", "button"); card.onclick = () => close(item.name); card.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") close(item.name); };
                // 토글이 켜져 있고, 성인물이며, 아직 "보기" 로 열지 않은 카드만 가린다
                const hide = blurAdult && item.adult && !revealed.has(item.name);
                const preview = makePreview(item, true, hide, () => {
                    revealed.add(item.name);
                    render();
                });
                highlighted(preview.querySelector(".fla-lp-title"), item.title, query);
                highlighted(preview.querySelector(".fla-lp-badge"), modelBadge(item.base_model), query);
                highlighted(preview.querySelector(".fla-lp-version"), item.version || "", query);
                const file = document.createElement("div"); file.className = "fla-lp-file"; highlighted(file, item.name, query);
                card.append(preview, file); grid.appendChild(card);
            }
        }

        const syncAdultButton = () => {
            adultBtn.classList.toggle("on", blurAdult);
            adultBtn.title = blurAdult ? t("adultBlurOn") : t("adultBlurOff");
        };
        adultBtn.onclick = () => {
            blurAdult = !blurAdult;
            // 다시 켜면 그동안 열어본 것들을 모두 도로 가린다
            if (blurAdult) revealed.clear();
            saveSettings({ blurAdult });
            syncAdultButton();
            render();
        };
        syncAdultButton();

        input.addEventListener("input", render); fav.onclick = () => { favoritesOnly = !favoritesOnly; saveSettings({ favoritesOnly }); render(); }; bg.querySelector(".close").onclick = () => close(); bg.onclick = (event) => { if (event.target === bg) close(); };
        document.addEventListener("keydown", key); document.addEventListener("click", outside); render(); input.focus();
    });
}
