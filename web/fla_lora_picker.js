import { t } from "./fla_i18n.js";
import { releaseWidgetCapture, releaseWidgetCaptureSoon } from "./fla_widget_mouse.js";

// 검색을 미루는 시간(ms). 이만큼 입력이 없으면 그때 한 번 거른다.
const SEARCH_DELAY = 300;

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
      .fla-lp-title{position:absolute;top:9px;left:9px;right:42px;overflow:hidden;color:#fff;font-weight:700;line-height:1.28;text-shadow:0 1px 3px #000;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}.fla-lp-star{position:absolute;z-index:2;top:6px;right:7px;width:30px;height:30px;padding:0;color:#fff;background:#111a;border:0;border-radius:50%;font-size:20px;cursor:pointer}.fla-lp-star.on{color:#ffd34e}.fla-lp-tags{position:absolute;left:8px;right:8px;bottom:8px;display:flex;flex-direction:column;align-items:flex-start;gap:3px}.fla-lp-badge{max-width:100%;padding:3px 6px;color:#fff;background:#111d;border-radius:4px;font-size:11px;white-space:normal;overflow-wrap:anywhere}.fla-lp-version{max-width:100%;padding:3px 6px;color:#ddd;background:#111d;border-radius:4px;font-size:11px;white-space:normal;overflow-wrap:anywhere}.fla-lp-mark{padding:0 1px;color:#171717;background:#ffd84d;border-radius:2px;text-shadow:none}.fla-lp-empty{padding:70px;text-align:center;color:#89919d}
      .fla-lp-dt-bg{position:fixed;inset:0;z-index:100010;background:#000b;display:grid;place-items:center;padding:3vh}.fla-lp-dt{width:min(1100px,94vw);height:min(860px,92vh);display:flex;flex-direction:column;background:#181a1f;color:#ddd;border:1px solid #4b5360;border-radius:12px;overflow:hidden;box-shadow:0 22px 70px #000;font:14px Arial,sans-serif}
      .fla-lp-dt-head{display:flex;align-items:flex-start;gap:10px;padding:13px 14px;background:#22262d;border-bottom:1px solid #383e48}.fla-lp-dt-head h2{flex:1;margin:0;font-size:16px;font-weight:700;color:#fff;overflow-wrap:anywhere}.fla-lp-dt-head .sub{margin-top:3px;color:#98a1ad;font-size:12px;overflow-wrap:anywhere}.fla-lp-dt-head button{flex:none;width:34px;height:34px;padding:0;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;font-size:19px;cursor:pointer}.fla-lp-dt-head button:hover{background:#3a424e}
      .fla-lp-dt-tabs{display:flex;gap:2px;padding:0 12px;background:#1d2026;border-bottom:1px solid #383e48}.fla-lp-dt-tabs button{position:relative;padding:11px 16px;color:#98a1ad;background:transparent;border:0;font-size:13px;font-weight:600;cursor:pointer}.fla-lp-dt-tabs button:hover{color:#c8cdd5}.fla-lp-dt-tabs button.on{color:#5aa9ff}.fla-lp-dt-tabs button.on::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:#5aa9ff;border-radius:2px}
      .fla-lp-dt-body{flex:1;min-height:0;padding:14px;overflow-y:auto}
      .fla-lp-dt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.fla-lp-dt-shot{position:relative;display:block;overflow:hidden;background:#111318;border:1px solid #3b424d;border-radius:9px}.fla-lp-dt-shot img{display:block;width:100%;height:auto}.fla-lp-dt-meta{padding:8px 10px;color:#aab2bd;font-size:11px;line-height:1.45;overflow-wrap:anywhere;border-top:1px solid #2c323b}.fla-lp-dt-meta b{color:#c8cdd5;font-weight:600}
      .fla-lp-dt-rows{display:grid;grid-template-columns:max-content 1fr;gap:9px 16px;align-items:start}.fla-lp-dt-rows dt{color:#8d95a1;font-size:12px}.fla-lp-dt-rows dd{margin:0;color:#dde2e8;font-size:13px;overflow-wrap:anywhere}
      .fla-lp-dt-desc{color:#c8cdd5;font-size:13px;line-height:1.65;overflow-wrap:anywhere}.fla-lp-dt-desc p{margin:0 0 9px}.fla-lp-dt-desc a{color:#5aa9ff}.fla-lp-dt-desc img{max-width:100%;height:auto;border-radius:6px}
      .fla-lp-dt-chips{display:flex;flex-wrap:wrap;gap:5px}.fla-lp-dt-chip{padding:3px 9px;color:#dbe3ea;background:#2b3138;border:1px solid #3d444e;border-radius:20px;font-size:12px;cursor:pointer}.fla-lp-dt-chip:hover{background:#3a424e;border-color:#5a6472}
      .fla-lp-dt-sec{margin-bottom:18px}.fla-lp-dt-sec>h3{margin:0 0 8px;color:#8d95a1;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
      .fla-lp-dt-link{display:inline-block;margin-top:4px;padding:7px 14px;color:#fff;background:#2f6fd0;border-radius:7px;font-size:13px;text-decoration:none}.fla-lp-dt-link:hover{background:#3b82f6}
      .fla-lp-dt-empty{padding:60px;text-align:center;color:#89919d}
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
    // 배지와 버전은 한 줄에 나란히 둔다. 길면 줄바꿈되어 전부 보인다.
    const tags = document.createElement("div"); tags.className = "fla-lp-tags";
    const badge = document.createElement("div"); badge.className = "fla-lp-badge"; badge.textContent = modelBadge(item.base_model);
    const version = document.createElement("div"); version.className = "fla-lp-version"; version.textContent = item.version || "";
    if (item.version) tags.append(version);
    tags.append(badge);
    preview.append(shade, title, star, tags);

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

/** 바이트를 사람이 읽는 크기로. */
function prettySize(bytes) {
    if (!bytes) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** ISO 날짜를 YYYY-MM-DD 로. 못 읽으면 그대로 둔다. */
function prettyDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toISOString().slice(0, 10);
}

/** 설명은 Civitai 가 준 HTML 이다. 태그를 직접 넣지 않고 텍스트로만 푼다.
 *  (남이 준 HTML 을 innerHTML 에 그대로 넣으면 스크립트가 딸려올 수 있다) */
function renderDescription(host, html) {
    host.replaceChildren();
    const showEmpty = () => {
        const empty = document.createElement("div");
        empty.className = "fla-lp-dt-empty";
        empty.textContent = t("detailNoDesc");
        host.appendChild(empty);
    };
    if (!html) { showEmpty(); return; }
    const text = String(html)
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\s*\/\s*p\s*>/gi, "\n\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'");
    for (const para of text.split(/\n{2,}/)) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const p = document.createElement("p");
        p.textContent = trimmed;
        host.appendChild(p);
    }
    if (!host.children.length) showEmpty();
}

/** 누르면 클립보드로 복사되는 알약. 트리거 단어·태그에 쓴다. */
function copyChip(text) {
    const chip = document.createElement("button");
    chip.className = "fla-lp-dt-chip";
    chip.textContent = text;
    chip.title = text;
    chip.onclick = async (event) => {
        event.stopPropagation();
        try { await navigator.clipboard.writeText(text); } catch (e) { return; }
        const old = chip.textContent;
        chip.textContent = t("detailCopied");
        setTimeout(() => { chip.textContent = old; }, 900);
    };
    return chip;
}

/** 모델 상세 창. 카드에서 우클릭하면 열린다.
 *  blurAdult 가 참이면 성인 등급 예시 이미지를 흐리게 보여준다. */
export async function showLoraDetail(name, blurAdult = true) {
    addStyles();

    let data;
    try {
        const res = await fetch(`/fla/lora-detail?name=${encodeURIComponent(name)}`);
        if (!res.ok) return;
        data = await res.json();
    } catch (e) {
        return;
    }
    if (!data?.ok) return;

    const bg = document.createElement("div");
    bg.className = "fla-lp-dt-bg";
    bg.innerHTML = `<div class="fla-lp-dt" role="dialog" aria-modal="true"><div class="fla-lp-dt-head"><div><h2></h2><div class="sub"></div></div><button class="close" title="${t("cancel")}">×</button></div><div class="fla-lp-dt-tabs"></div><div class="fla-lp-dt-body"></div></div>`;
    document.body.appendChild(bg);

    bg.querySelector("h2").textContent = data.title || name;
    const subParts = [data.version, data.base_model, data.creator && `@${data.creator}`].filter(Boolean);
    bg.querySelector(".sub").textContent = subParts.join("  ·  ");

    const tabsHost = bg.querySelector(".fla-lp-dt-tabs");
    const body = bg.querySelector(".fla-lp-dt-body");

    const close = () => { document.removeEventListener("keydown", key); bg.remove(); };
    // 상세 창이 열려 있으면 Esc 가 로라 목록까지 닫지 않도록 여기서 막는다
    const key = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    bg.querySelector(".close").onclick = close;
    bg.onclick = (event) => { if (event.target === bg) close(); };
    document.addEventListener("keydown", key, true);

    /** 예시 이미지 탭. */
    function renderSamples() {
        body.replaceChildren();
        if (!data.images?.length) {
            const empty = document.createElement("div");
            empty.className = "fla-lp-dt-empty";
            empty.textContent = t("detailNoSamples");
            body.appendChild(empty);
            return;
        }
        const grid = document.createElement("div");
        grid.className = "fla-lp-dt-grid";
        for (const shot of data.images) {
            const box = document.createElement("div");
            box.className = "fla-lp-dt-shot";
            const img = document.createElement("img");
            img.src = shot.url;
            img.loading = "lazy";
            // 예시 이미지도 카드와 같은 기준(R 등급 이상)으로 가린다
            if (blurAdult && shot.nsfw_level >= 4) img.classList.add("fla-lp-blur");
            img.onerror = () => box.remove();
            box.appendChild(img);

            if (shot.prompt) {
                const meta = document.createElement("div");
                meta.className = "fla-lp-dt-meta";
                const label = document.createElement("b");
                label.textContent = t("detailPrompt") + ": ";
                meta.append(label, document.createTextNode(shot.prompt));
                box.appendChild(meta);
            }
            grid.appendChild(box);
        }
        body.appendChild(grid);
    }

    /** 모델 설명 탭. */
    function renderAbout() {
        body.replaceChildren();
        const section = (titleText, node) => {
            const sec = document.createElement("div");
            sec.className = "fla-lp-dt-sec";
            const h = document.createElement("h3");
            h.textContent = titleText;
            sec.append(h, node);
            body.appendChild(sec);
        };
        const chipRow = (words) => {
            const chips = document.createElement("div");
            chips.className = "fla-lp-dt-chips";
            for (const word of words) chips.appendChild(copyChip(word));
            return chips;
        };
        if (data.trained_words?.length) section(t("detailTrained"), chipRow(data.trained_words));
        if (data.tags?.length) section(t("detailTags"), chipRow(data.tags));

        const desc = document.createElement("div");
        desc.className = "fla-lp-dt-desc";
        renderDescription(desc, data.description || data.notes);
        section(t("tabAbout"), desc);
    }

    /** 버전·파일 정보 탭. */
    function renderVersion() {
        body.replaceChildren();
        const rows = document.createElement("dl");
        rows.className = "fla-lp-dt-rows";
        const add = (label, value) => {
            if (value === undefined || value === null || value === "") return;
            const dt = document.createElement("dt"); dt.textContent = label;
            const dd = document.createElement("dd"); dd.textContent = String(value);
            rows.append(dt, dd);
        };
        add(t("tabVersion"), data.version);
        add(t("detailBase"), data.base_model);
        add(t("detailFile"), data.file_name);
        add(t("detailSize"), prettySize(data.size));
        add(t("detailPublished"), prettyDate(data.published));
        add(t("detailCreator"), data.creator);
        if (typeof data.downloads === "number") add(t("detailDownloads"), data.downloads.toLocaleString());
        if (typeof data.likes === "number") add(t("detailLikes"), data.likes.toLocaleString());
        add(t("detailHash"), data.sha256);
        body.appendChild(rows);

        if (data.model_id) {
            const link = document.createElement("a");
            link.className = "fla-lp-dt-link";
            link.href = `https://civitai.com/models/${data.model_id}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = t("detailOpenCivitai");
            body.appendChild(link);
        }
    }

    const tabs = [
        [t("tabSamples"), renderSamples],
        [t("tabAbout"), renderAbout],
        [t("tabVersion"), renderVersion],
    ];
    const buttons = tabs.map(([label, render]) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.onclick = () => {
            buttons.forEach((b) => b.classList.remove("on"));
            button.classList.add("on");
            render();
        };
        tabsHost.appendChild(button);
        return button;
    });
    // 첫 탭(예시)을 펼친 상태로 연다
    buttons[0].onclick();
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
        // 타이핑하는 동안에는 목록을 다시 그리지 않는다.
        // 입력이 멈추고 SEARCH_DELAY 만큼 지나야 한 번 검색한다.
        let searchTimer = null;
        const searchLater = () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(render, SEARCH_DELAY);
        };

        const close = (value = null) => { clearTimeout(searchTimer); document.removeEventListener("keydown", key); document.removeEventListener("click", outside); bg.remove(); resolve(value); };
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
                // 우클릭하면 모델 상세 창을 연다(고르지는 않는다)
                card.oncontextmenu = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    showLoraDetail(item.name, blurAdult);
                };
                // 토글이 켜져 있고, 성인물이며, 아직 "보기" 로 열지 않은 카드만 가린다
                const hide = blurAdult && item.adult && !revealed.has(item.name);
                const preview = makePreview(item, true, hide, () => {
                    revealed.add(item.name);
                    render();
                });
                highlighted(preview.querySelector(".fla-lp-title"), item.title, query);
                highlighted(preview.querySelector(".fla-lp-badge"), modelBadge(item.base_model), query);
                highlighted(preview.querySelector(".fla-lp-version"), item.version || "", query);
                card.append(preview); grid.appendChild(card);
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

        input.addEventListener("input", searchLater);
        // 엔터를 누르면 기다리지 않고 바로 거른다
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            clearTimeout(searchTimer);
            render();
        }); fav.onclick = () => { favoritesOnly = !favoritesOnly; saveSettings({ favoritesOnly }); render(); }; bg.querySelector(".close").onclick = () => close(); bg.onclick = (event) => { if (event.target === bg) close(); };
        document.addEventListener("keydown", key); document.addEventListener("click", outside); render(); input.focus();
    });
}
