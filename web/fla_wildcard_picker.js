/** 와일드카드 고르기 창.
 *
 *  로라 피커와 같은 모양·같은 조작이다(폴더 트리, 즐겨찾기, 검색, 빵부스러기).
 *  스타일도 로라 피커의 .fla-lp-* 를 그대로 쓴다. 두 창이 따로 놀면
 *  같은 버튼이 다르게 보여서 헷갈리기 때문이다.
 *
 *  로라와 다른 점은 미리보기 이미지가 없다는 것이다.
 *  대신 파일 앞부분 몇 줄을 카드에 보여준다.
 */

import { t } from "./fla_i18n.js";
import { releaseWidgetCaptureSoon } from "./fla_widget_mouse.js";
import { addStyles as addPickerStyles } from "./fla_lora_picker.js";

const SEARCH_DELAY = 300;

let libraryPromise;
let settingsCache = null;

// 카드에 보여줄 미리보기 줄. 한 번 읽은 파일은 다시 읽지 않는다.
const previewCache = new Map();

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

function saveSettings(patch) {
    settingsCache = { ...(settingsCache ?? {}), ...patch };
    fetch("/fla/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: patch }),
    }).catch(() => { /* 저장 실패해도 화면은 그대로 쓴다 */ });
}

/** 목록을 받아온다. 창을 다시 열어도 같은 결과를 쓴다. */
export async function library(refresh = false) {
    if (refresh) forgetWildcardLibrary();
    libraryPromise ??= fetch(`/fla/wildcard-library${refresh ? "?refresh=1" : ""}`).then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
    }).then((data) => data.items ?? []);
    return libraryPromise;
}

/** 폴더를 새로 만들었을 수 있으니 다시 읽게 한다. */
export function forgetWildcardLibrary() {
    libraryPromise = undefined;
    previewCache.clear();
}

async function saveFavorite(item, favorite) {
    const res = await fetch("/fla/wildcard-favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, favorite }),
    });
    if (!res.ok) throw new Error(res.statusText);
    item.favorite = (await res.json()).favorite;
}

async function previewLines(name) {
    if (previewCache.has(name)) return previewCache.get(name);
    const promise = fetch(`/fla/wildcard-preview?name=${encodeURIComponent(name)}`)
        .then((res) => (res.ok ? res.json() : { lines: [] }))
        .then((data) => data.lines ?? [])
        .catch(() => []);
    previewCache.set(name, promise);
    return promise;
}

function addStyles() {
    // 창 골격(.fla-lp-*)은 로라 피커가 들고 있다. 로라 창을 한 번도 열지 않았다면
    // 아직 문서에 없으므로 여기서 먼저 넣는다. 안 그러면 레이아웃이 무너진다.
    addPickerStyles();
    if (document.getElementById("fla-wc-picker-style")) return;
    const style = document.createElement("style");
    style.id = "fla-wc-picker-style";
    // 로라 피커의 카드가 이미지를 전제로 하므로, 글자 카드용 규칙만 더 얹는다.
    style.textContent = `
      .fla-wc-card{display:flex;flex-direction:column;min-height:132px}
      .fla-wc-head{display:flex;align-items:flex-start;gap:8px;padding:10px 10px 7px}
      .fla-wc-name{flex:1;min-width:0;color:#fff;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
      .fla-wc-star{flex:none;width:26px;height:26px;padding:0;color:#fff;background:#111a;border:0;border-radius:50%;font-size:17px;cursor:pointer}
      .fla-wc-star.on{color:#ffd34e}
      .fla-wc-lines{flex:1;margin:0 10px;padding:7px 9px;overflow:hidden;color:#9aa3ae;background:#1b1e24;border:1px solid #2f353e;border-radius:6px;font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:74px}
      .fla-wc-foot{display:flex;align-items:center;gap:6px;padding:8px 10px 10px;color:#7d858f;font-size:11px}
      .fla-wc-count{padding:2px 7px;color:#cfd6de;background:#2b3138;border-radius:4px;white-space:nowrap}
      .fla-wc-src{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fla-wc-token{padding:2px 7px;color:#8ec5ff;background:#1e2b3a;border-radius:4px;font-family:monospace;white-space:nowrap}
      .fla-wc-edit-bg{position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;background:#0009}
      .fla-wc-edit{width:min(680px,calc(100vw - 32px));height:min(620px,calc(100vh - 32px));display:flex;flex-direction:column;background:#202329;border:1px solid #4a5059;border-radius:10px;box-shadow:0 18px 60px #000b;overflow:hidden}
      .fla-wc-edit-head{display:flex;align-items:center;padding:12px 14px;color:#fff;font-size:16px;font-weight:700;border-bottom:1px solid #383d45}
      .fla-wc-edit-head span{flex:1}.fla-wc-edit-head button{width:30px;height:30px;border:0;background:transparent;color:#bbb;font-size:23px;cursor:pointer}
      .fla-wc-edit-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:7px;padding:15px}
      .fla-wc-edit-body label{color:#b9c0c9;font-size:12px}.fla-wc-edit-body input,.fla-wc-edit-body textarea{box-sizing:border-box;width:100%;color:#eee;background:#15171b;border:1px solid #454b54;border-radius:6px;padding:9px;font:13px sans-serif;outline:none}
      .fla-wc-edit-body textarea{flex:1;min-height:190px;resize:none;font-family:monospace;line-height:1.5}
      .fla-wc-edit-error{min-height:18px;color:#ff8585;font-size:12px}
      .fla-wc-edit-foot{display:flex;justify-content:flex-end;gap:8px;padding:0 15px 15px}.fla-wc-edit-foot button{padding:8px 16px;border:1px solid #505762;border-radius:6px;color:#eee;background:#343941;cursor:pointer}.fla-wc-edit-foot .delete{margin-right:auto;color:#ffaaaa;border-color:#7b3e42;background:#48272a}.fla-wc-edit-foot .save{border-color:#3978ad;background:#286493}
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

function highlighted(element, text, query) {
    if (!element) return;
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

/** 프롬프트에 넣을 표기. Impact Pack 등이 쓰는 __이름__ 형식이다. */
export function wildcardToken(name) {
    return `__${name}__`;
}

export async function pickWildcard() {
    // 전체 화면 모달이 커서를 덮어 캔버스가 pointerup 을 못 받는다.
    releaseWidgetCaptureSoon();
    const [items, saved] = await Promise.all([library(), loadSettings()]);
    addStyles();
    return new Promise((resolve) => {
        // 로라 창과 설정을 나눠 쓰면 서로 폴더가 튀므로 wc 접두사로 따로 저장한다.
        let folder = typeof saved.wcFolder === "string" ? saved.wcFolder : "";
        let favoritesOnly = saved.wcFavoritesOnly === true;
        let includeChildren = saved.wcIncludeChildren !== false;
        let allExpanded = saved.wcAllExpanded === true;
        // 새로고침 때 내용만 갈아끼우므로 배열 자체는 그대로 둔다
        const folders = allFolders(items);
        const expanded = new Set(Array.isArray(saved.wcExpanded) ? saved.wcExpanded : []);
        if (folder && !folders.includes(folder)) folder = "";

        const bg = document.createElement("div");
        bg.className = "fla-lp-bg";
        bg.innerHTML = `<div class="fla-lp" role="dialog" aria-modal="true"><div class="fla-lp-head"><input type="search" placeholder="${t("searchWildcard")}"><div class="fla-lp-hint">${t("wildcardHint")}</div><button class="fav">☆ ${t("loraFavorites")}</button><button class="new">＋ ${t("newWildcard")}</button><button class="reload" title="${t("wildcardReload")}">⟳</button><button class="close" title="${t("cancel")}">×</button></div><div class="fla-lp-main"><aside class="fla-lp-side"></aside><section class="fla-lp-content"><div class="fla-lp-path"></div><div class="fla-lp-grid"></div></section></div></div>`;
        document.body.appendChild(bg);
        const input = bg.querySelector("input");
        const fav = bg.querySelector(".fav");
        const reload = bg.querySelector(".reload");
        const newButton = bg.querySelector(".new");
        const side = bg.querySelector(".fla-lp-side");
        const path = bg.querySelector(".fla-lp-path");
        const grid = bg.querySelector(".fla-lp-grid");

        const closeMenus = () => bg.querySelectorAll(".fla-lp-menu").forEach((menu) => menu.remove());
        let searchTimer = null;
        const searchLater = () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(render, SEARCH_DELAY);
        };

        let closed = false;
        const close = (value = null) => {
            if (closed) return;
            closed = true;
            clearTimeout(searchTimer);
            document.removeEventListener("keydown", key);
            document.removeEventListener("click", outside);
            bg.remove();
            resolve(value);
        };
        const key = (event) => { if (event.key === "Escape") bg.querySelector(".fla-lp-menu") ? closeMenus() : close(); };
        const outside = (event) => { if (!event.target.closest(".fla-lp-crumb")) closeMenus(); };
        const choose = (value) => {
            folder = value;
            saveSettings({ wcFolder: folder });
            const parts = value.split("/").filter(Boolean);
            for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join("/"));
            closeMenus(); render();
        };

        async function refreshItems() {
            const fresh = await library(true);
            items.length = 0; items.push(...fresh);
            folders.length = 0; folders.push(...allFolders(items));
            if (folder && !folders.includes(folder)) folder = "";
            render();
        }

        async function openEditor(item = null) {
            let content = "";
            if (item) {
                const res = await fetch(`/fla/wildcard-content?name=${encodeURIComponent(item.name)}`);
                const data = await res.json();
                if (!res.ok) { alert(data.error || res.statusText); return; }
                content = data.content ?? "";
            }
            const overlay = document.createElement("div"); overlay.className = "fla-wc-edit-bg";
            overlay.innerHTML = `<div class="fla-wc-edit" role="dialog" aria-modal="true"><div class="fla-wc-edit-head"><span>${t(item ? "editWildcard" : "newWildcard")}</span><button class="x" title="${t("cancel")}">×</button></div><div class="fla-wc-edit-body"><label>${t("wildcardTitle")}</label><input class="title" type="text"><label>${t("wildcardContent")}</label><textarea class="content"></textarea><div class="fla-wc-edit-error"></div></div><div class="fla-wc-edit-foot">${item ? `<button class="delete">${t("delete")}</button>` : ""}<button class="cancel">${t("cancel")}</button><button class="save">${t("save")}</button></div></div>`;
            document.body.appendChild(overlay);
            const title = overlay.querySelector(".title"); const textarea = overlay.querySelector(".content"); const error = overlay.querySelector(".fla-wc-edit-error");
            title.value = item?.name ?? ""; textarea.value = content;
            const dismiss = () => overlay.remove();
            overlay.querySelector(".x").onclick = dismiss; overlay.querySelector(".cancel").onclick = dismiss;
            overlay.onclick = (event) => { if (event.target === overlay) dismiss(); };
            overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } });
            overlay.querySelector(".save").onclick = async () => {
                error.textContent = "";
                const res = await fetch("/fla/wildcard-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old_name: item?.name ?? null, name: title.value, content: textarea.value }) });
                const data = await res.json();
                if (!res.ok) { error.textContent = data.error || res.statusText; return; }
                dismiss(); await refreshItems();
            };
            const del = overlay.querySelector(".delete");
            if (del) del.onclick = async () => {
                if (!confirm(t("deleteWildcardConfirm").replace("{name}", item.name))) return;
                const res = await fetch("/fla/wildcard-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: item.name }) });
                const data = await res.json();
                if (!res.ok) { error.textContent = data.error || res.statusText; return; }
                dismiss(); await refreshItems();
            };
            title.focus();
        }

        function folderButton(label, value, depth, hasChildren = false) {
            const button = document.createElement("button");
            button.className = `fla-lp-folder${folder === value ? " on" : ""}`;
            const indent = document.createElement("span"); indent.className = "fla-lp-indent"; indent.style.width = `${depth * 15}px`;
            const fold = document.createElement("span"); fold.className = "fla-lp-fold"; fold.textContent = hasChildren ? (expanded.has(value) ? "⌄" : ">") : "";
            fold.onclick = (event) => { event.stopPropagation(); expanded.has(value) ? expanded.delete(value) : expanded.add(value); allExpanded = false; saveSettings({ wcAllExpanded: allExpanded, wcExpanded: [...expanded] }); renderSide(); };
            const name = document.createElement("span"); name.className = "fla-lp-folder-name"; name.textContent = `${value ? "📁" : "⌂"}  ${label}`;
            button.append(indent, fold, name);
            button.onclick = () => { folder = value; saveSettings({ wcFolder: folder }); render(); };
            side.appendChild(button);
        }

        function renderSide() {
            side.replaceChildren();
            const tools = document.createElement("div"); tools.className = "fla-lp-side-tools";
            const descendants = document.createElement("button"); descendants.textContent = "⑂"; descendants.title = t("includeSubfolders"); descendants.classList.toggle("on", includeChildren);
            descendants.onclick = () => { includeChildren = !includeChildren; saveSettings({ wcIncludeChildren: includeChildren }); render(); };
            const expand = document.createElement("button"); expand.textContent = "↗↙"; expand.title = t("expandFolders"); expand.classList.toggle("on", allExpanded);
            expand.onclick = () => {
                allExpanded = !allExpanded;
                expanded.clear();
                if (allExpanded) for (const value of folders.filter(Boolean)) expanded.add(value);
                saveSettings({ wcAllExpanded: allExpanded, wcExpanded: [...expanded] });
                renderSide();
            };
            const favButton = document.createElement("button");
            favButton.textContent = favoritesOnly ? "★" : "☆";
            favButton.title = t("loraFavorites");
            favButton.classList.toggle("star-on", favoritesOnly);
            favButton.onclick = () => { favoritesOnly = !favoritesOnly; saveSettings({ wcFavoritesOnly: favoritesOnly }); render(); };
            tools.append(favButton, descendants, expand); side.appendChild(tools);
            folderButton(t("wildcardRoot"), "", 0);
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
            for (const value of choices) { const button = document.createElement("button"); button.textContent = value.split("/").pop() || t("wildcardRoot"); button.onclick = () => choose(value); menu.appendChild(button); }
            host.appendChild(menu);
        }

        function renderPath(shown, total) {
            path.replaceChildren();
            const parts = folder.split("/").filter(Boolean);
            const crumbs = [[`⌂ ${t("wildcardRoot")}`, ""], ...parts.map((part, i) => [part, parts.slice(0, i + 1).join("/")])];
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

        function makeCard(item, query) {
            const card = document.createElement("div");
            card.className = "fla-lp-card fla-wc-card";
            card.tabIndex = 0;
            card.setAttribute("role", "button");
            card.title = `${wildcardToken(item.name)}\n${item.source}`;

            const head = document.createElement("div"); head.className = "fla-wc-head";
            const name = document.createElement("div"); name.className = "fla-wc-name";
            highlighted(name, item.title, query);
            const star = document.createElement("button");
            star.className = `fla-wc-star${item.favorite ? " on" : ""}`;
            star.textContent = item.favorite ? "★" : "☆";
            star.title = t("loraFavorites");
            star.onclick = async (event) => {
                event.stopPropagation();
                star.disabled = true;
                try {
                    await saveFavorite(item, !item.favorite);
                    render();
                } catch (e) {
                    star.disabled = false;
                }
            };
            head.append(name, star);

            const lines = document.createElement("div"); lines.className = "fla-wc-lines";
            lines.textContent = t("loading");
            previewLines(item.name).then((rows) => {
                lines.textContent = rows.length ? rows.join("\n") : t("wildcardEmpty");
            });

            const foot = document.createElement("div"); foot.className = "fla-wc-foot";
            const count = document.createElement("span"); count.className = "fla-wc-count";
            count.textContent = t("wildcardCount").replace("{n}", item.count);
            const src = document.createElement("span"); src.className = "fla-wc-src"; src.textContent = item.folder || item.source;
            foot.append(count, src);

            card.append(head, lines, foot);
            card.onclick = () => close(item.name);
            card.oncontextmenu = (event) => { event.preventDefault(); event.stopPropagation(); openEditor(item); };
            card.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") close(item.name); };
            return card;
        }

        function render() {
            const query = input.value.trim().toLocaleLowerCase();
            const scoped = items.filter((item) => includeChildren ? contains(item, folder) : item.folder === folder);
            const shown = scoped.filter((item) => {
                const text = `${item.name} ${item.source}`;
                return (!favoritesOnly || item.favorite)
                    && (!query || text.toLocaleLowerCase().includes(query));
            });
            fav.classList.toggle("on", favoritesOnly);
            fav.textContent = `${favoritesOnly ? "★" : "☆"} ${t("loraFavorites")}`;
            renderSide(); renderPath(shown.length, scoped.length); grid.replaceChildren();
            if (!shown.length) {
                const empty = document.createElement("div");
                empty.className = "fla-lp-empty";
                // 아예 하나도 없을 때는 폴더를 어떻게 만드는지 알려준다
                empty.textContent = items.length ? t("noWildcards") : t("noWildcardFolder");
                grid.appendChild(empty);
                return;
            }
            for (const item of shown) grid.appendChild(makeCard(item, query));
        }

        input.addEventListener("input", searchLater);
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            clearTimeout(searchTimer);
            render();
        });
        fav.onclick = () => { favoritesOnly = !favoritesOnly; saveSettings({ wcFavoritesOnly: favoritesOnly }); render(); };
        newButton.onclick = () => openEditor();
        // 폴더를 새로 만들었을 때 ComfyUI 를 다시 켜지 않아도 되게 한다
        reload.onclick = async () => {
            reload.disabled = true;
            try {
                await refreshItems();
            } finally {
                reload.disabled = false;
            }
        };
        bg.querySelector(".close").onclick = () => close();
        bg.onclick = (event) => { if (event.target === bg) close(); };
        document.addEventListener("keydown", key);
        document.addEventListener("click", outside);
        render(); input.focus();
    });
}
