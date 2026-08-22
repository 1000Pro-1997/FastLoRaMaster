import { t } from "./fla_i18n.js";
import { releaseWidgetCapture, releaseWidgetCaptureSoon } from "./fla_widget_mouse.js";
import { civitaiStatus, fetchLoraInfo, openCivitaiPanel } from "./fla_civitai.js";
import { clearCache, createModelDetail } from "./fla_civitai_detail.js";

// 검색을 미루는 시간(ms). 이만큼 입력이 없으면 그때 한 번 거른다.
const SEARCH_DELAY = 300;
// Civitai nsfwLevel 비트마스크에서 R 등급 이상만 성인 이미지로 가린다.
const ADULT_LEVEL = 4;
// 버전 탭에서 받기 진행률을 물어보는 간격(ms).
const DOWNLOAD_POLL = 700;

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

/** 창 골격(.fla-lp-*) 스타일. 와일드카드 창도 같은 뼈대를 쓰므로 내보낸다. */
export function addStyles() {
    if (document.getElementById("fla-lora-picker-style")) return;
    const style = document.createElement("style");
    style.id = "fla-lora-picker-style";
    style.textContent = `
      .fla-lp-bg{position:fixed;inset:0;z-index:100000;background:#000a;display:grid;place-items:center;padding:3vh}.fla-lp{width:min(1400px,96vw);height:min(900px,94vh);display:flex;flex-direction:column;background:#181a1f;color:#ddd;border:1px solid #4b5360;border-radius:12px;overflow:hidden;box-shadow:0 22px 70px #000;font:14px Arial,sans-serif}
      .fla-lp-head{display:flex;gap:10px;padding:12px;background:#22262d;border-bottom:1px solid #383e48}.fla-lp-head input{flex:0 1 50%;height:38px;min-width:100px;padding:0 12px;color:#eee;background:#111419;border:1px solid #454c58;border-radius:7px}.fla-lp-hint{flex:1;min-width:0;align-self:center;overflow:hidden;color:#7d858f;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.fla-lp-head button{height:38px;padding:0 13px;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;cursor:pointer}.fla-lp-head .fav.on{color:#ffd34e;background:#493d21;border-color:#9f7c23}.fla-lp-head .civitai{display:flex;align-items:center;gap:7px;color:#fff;background:linear-gradient(180deg,#2181d6,#1971c2);border-color:#1864ab;font-weight:700}.fla-lp-head .civitai:hover{background:linear-gradient(180deg,#2f92e8,#1c7ed6);border-color:#1c7ed6}.fla-lp-head .civitai .dot{width:7px;height:7px;background:#ffd34e;border-radius:50%;box-shadow:0 0 0 2px #0003}.fla-lp-head .close{width:38px;padding:0;font-size:20px}
      .fla-lp-main{display:flex;flex:1;min-height:0}.fla-lp-side{width:230px;flex:none;padding:8px;overflow-y:scroll;scrollbar-gutter:stable;background:#20242a;border-right:1px solid #383e48}.fla-lp-side-tools{display:flex;justify-content:flex-end;gap:4px;height:31px;padding:0 4px 5px;border-bottom:1px solid #343a43;margin-bottom:5px}.fla-lp-side-tools button{display:grid;width:30px;height:27px;padding:0;place-items:center;color:#7d858f;background:transparent;border:0;border-radius:5px;font-size:17px;cursor:pointer}.fla-lp-side-tools button:hover{background:#303640}.fla-lp-side-tools button.on{color:#40a8ff;background:#263d52}.fla-lp-side-tools button.star-on{color:#ffd34e;background:#493d21}.fla-lp-folder{display:flex;align-items:center;width:100%;height:31px;padding:0 8px;color:#c8cdd5;background:transparent;border:0;border-radius:5px;text-align:left;white-space:nowrap;overflow:hidden;cursor:pointer}.fla-lp-folder:hover{background:#303640}.fla-lp-folder.on{color:#72baff;background:#283f55;font-weight:600}.fla-lp-indent{display:inline-block;flex:none}.fla-lp-fold{display:inline-grid;width:18px;height:24px;flex:none;place-items:center;color:#a8b0ba}.fla-lp-folder-name{overflow:hidden;text-overflow:ellipsis}
      .fla-lp-content{display:flex;flex:1;min-width:0;flex-direction:column}.fla-lp-path{display:flex;align-items:center;min-height:41px;padding:0 12px;gap:4px;background:#1d2026;border-bottom:1px solid #383e48}.fla-lp-crumb{position:relative;display:inline-flex;align-items:center}.fla-lp-crumb>button{padding:6px 2px;color:#72baff;background:transparent;border:0;cursor:pointer}.fla-lp-crumb .arrow{padding-left:5px}.fla-lp-menu{position:absolute;z-index:5;left:0;top:30px;min-width:175px;max-height:300px;padding:5px;overflow-y:auto;background:#292d34;border:1px solid #505763;border-radius:6px;box-shadow:0 8px 25px #000}.fla-lp-menu button{display:block;width:100%;padding:7px 10px;color:#ddd;background:transparent;border:0;border-radius:4px;text-align:left;cursor:pointer}.fla-lp-menu button:hover{background:#3a424e}.fla-lp-count{margin-left:auto;color:#929ba8}
      .fla-lp-grid{flex:1;min-height:0;padding:12px;overflow-x:hidden;overflow-y:scroll;scrollbar-gutter:stable;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));grid-auto-rows:max-content;align-content:start;align-items:start;gap:12px}.fla-lp-card{position:relative;display:block;min-width:0;height:auto;padding:0;overflow:hidden;color:#ddd;background:#242830;border:1px solid #3b424d;border-radius:9px;cursor:pointer;box-sizing:border-box}.fla-lp-card:hover{border-color:#79a9d1;box-shadow:0 3px 14px #0008}.fla-lp-preview{position:relative;display:grid;width:100%;height:auto;aspect-ratio:3 / 4;place-items:center;overflow:hidden;color:#59616d;background:#111318}.fla-lp-preview img,.fla-lp-preview video{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}.fla-lp-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(#000b,#0000 32%,#0000 55%,#000c)}
      .fla-lp-title{position:absolute;top:9px;left:9px;right:42px;pointer-events:none;overflow:hidden;color:#fff;font-weight:700;line-height:1.28;text-shadow:0 1px 3px #000;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}.fla-lp-star,.fla-lp-copy{position:absolute;z-index:2;right:7px;width:30px;height:30px;padding:0;color:#fff;background:#111a;border:0;border-radius:50%;cursor:pointer}.fla-lp-star{top:6px;font-size:20px}.fla-lp-star.on{color:#ffd34e}.fla-lp-copy{top:40px;display:grid;place-items:center}.fla-lp-copy svg{width:21px;height:21px}.fla-lp-copy:hover{background:#2f6fd0}.fla-lp-tags{position:absolute;left:8px;right:8px;bottom:8px;pointer-events:none;display:flex;flex-direction:column;align-items:flex-start;gap:3px}.fla-lp-badge{max-width:100%;padding:3px 6px;color:#fff;background:#111d;border-radius:4px;font-size:11px;white-space:normal;overflow-wrap:anywhere}.fla-lp-version{max-width:100%;padding:3px 6px;color:#ddd;background:#111d;border-radius:4px;font-size:11px;white-space:normal;overflow-wrap:anywhere}.fla-lp-noinfo{color:#ffcf6b;background:#000d}.fla-lp-mark{padding:0 1px;color:#171717;background:#ffd84d;border-radius:2px;text-shadow:none}.fla-lp-empty{padding:70px;text-align:center;color:#89919d}
      .fla-lp-dt-bg{position:fixed;inset:0;z-index:100010;background:#000b;display:grid;place-items:center;padding:3vh}.fla-lp-dt{width:min(1400px,96vw);height:min(900px,94vh);display:flex;flex-direction:column;background:#181a1f;color:#ddd;border:1px solid #4b5360;border-radius:12px;overflow:hidden;box-shadow:0 22px 70px #000;font:14px Arial,sans-serif}
      .fla-lp-dt-head{display:flex;align-items:flex-start;gap:10px;padding:13px 14px;background:#22262d;border-bottom:1px solid #383e48}.fla-lp-dt-titles{flex:1;min-width:0}.fla-lp-dt-head h2{margin:0;font-size:16px;font-weight:700;color:#fff;overflow-wrap:anywhere}.fla-lp-dt-head .sub{margin-top:3px;color:#98a1ad;font-size:12px;overflow-wrap:anywhere}.fla-lp-dt-head button{flex:none;width:34px;height:34px;padding:0;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;font-size:19px;cursor:pointer}.fla-lp-dt-head button:hover{background:#3a424e}
      .fla-lp-dt-tabs{display:flex;gap:2px;padding:0 12px;background:#1d2026;border-bottom:1px solid #383e48}.fla-lp-dt-tabs button{position:relative;padding:11px 16px;color:#98a1ad;background:transparent;border:0;font-size:13px;font-weight:600;cursor:pointer}.fla-lp-dt-tabs button:hover{color:#c8cdd5}.fla-lp-dt-tabs button.on{color:#5aa9ff}.fla-lp-dt-tabs button.on::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:#5aa9ff;border-radius:2px}
      .fla-lp-dt-split{display:flex;flex:1;min-height:0}
      .fla-lp-dt-body{flex:1;min-width:0;min-height:0;padding:14px;overflow-y:auto}
      .fla-lp-dt-split>.fla-cv-detail{width:420px}
      .fla-lp-dt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.fla-lp-dt-shot{position:relative;display:block;overflow:hidden;background:#111318;border:1px solid #3b424d;border-radius:9px}.fla-lp-dt-frame{position:relative;overflow:hidden}.fla-lp-dt-shot img,.fla-lp-dt-shot video{display:block;width:100%;height:auto}.fla-lp-dt-meta{padding:8px 10px;color:#aab2bd;font-size:11px;line-height:1.45;border-top:1px solid #2c323b}.fla-lp-dt-meta b{color:#c8cdd5;font-weight:600}.fla-lp-dt-metahead{display:flex;align-items:center;gap:8px;margin-bottom:5px}.fla-lp-dt-metahead b{flex:1}.fla-lp-dt-copy{flex:none;padding:3px 9px;color:#dbe3ea;background:#2b3138;border:1px solid #3d444e;border-radius:5px;font-size:11px;cursor:pointer}.fla-lp-dt-copy:hover{background:#3a424e;border-color:#5a6472}.fla-lp-dt-prompt{max-height:74px;overflow-y:auto;overflow-wrap:anywhere}
      .fla-lp-dt-rows{display:grid;grid-template-columns:max-content 1fr;gap:9px 16px;align-items:start}.fla-lp-dt-rows dt{color:#8d95a1;font-size:12px}.fla-lp-dt-rows dd{margin:0;color:#dde2e8;font-size:13px;overflow-wrap:anywhere}
      .fla-lp-dt-desc{color:#c8cdd5;font-size:13px;line-height:1.65;overflow-wrap:anywhere}.fla-lp-dt-desc p{margin:0 0 9px}.fla-lp-dt-desc a{color:#5aa9ff}.fla-lp-dt-desc img{max-width:100%;height:auto;border-radius:6px}
      .fla-lp-dt-chips{display:flex;flex-wrap:wrap;gap:5px}.fla-lp-dt-chip{padding:3px 9px;color:#dbe3ea;background:#2b3138;border:1px solid #3d444e;border-radius:20px;font-size:12px;cursor:pointer}.fla-lp-dt-chip:hover{background:#3a424e;border-color:#5a6472}
      .fla-lp-dt-sec{margin-bottom:18px}.fla-lp-dt-sec>h3{margin:0 0 8px;color:#8d95a1;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
      .fla-lp-dt-link{display:inline-block;margin-top:4px;padding:7px 14px;color:#fff;background:#2f6fd0;border-radius:7px;font-size:13px;text-decoration:none}.fla-lp-dt-link:hover{background:#3b82f6}
      .fla-lp-dt-empty{padding:60px;text-align:center;color:#89919d}
      .fla-lp-vr-list{display:flex;flex-direction:column;gap:8px}
      .fla-lp-vr{display:flex;gap:11px;padding:9px;background:#242830;border:1px solid #3b424d;border-radius:9px;cursor:pointer}.fla-lp-vr.on{background:#2d2a21;border-color:#4a4230}.fla-lp-vr:hover{border-color:#4d5666}.fla-lp-vr.picked{border-color:#5aa9ff;box-shadow:0 0 0 2px #2f6fd0aa}
      .fla-lp-vr-shot{position:relative;flex:none;display:grid;width:74px;height:74px;place-items:center;overflow:hidden;background:#111318;border-radius:7px}.fla-lp-vr-shot img,.fla-lp-vr-shot video{width:100%;height:100%;object-fit:cover}
      .fla-lp-vr-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;justify-content:center}
      .fla-lp-vr-name{display:flex;align-items:center;gap:7px;color:#fff;font-size:13px;font-weight:700;overflow-wrap:anywhere}.fla-lp-vr-name a{flex:none;color:#5aa9ff;font-size:12px;text-decoration:none}.fla-lp-vr-name a:hover{color:#8cc4ff}
      .fla-lp-vr-tags{display:flex;flex-wrap:wrap;gap:4px}.fla-lp-vr-tag{padding:2px 8px;border-radius:20px;font-size:11px;color:#c8cdd5;background:#2b3138;border:1px solid #3d444e}.fla-lp-vr-tag.new{color:#9dcbff;background:#1c3450;border-color:#2f5c8f}.fla-lp-vr-tag.mine{color:#ffd88a;background:#3a2f18;border-color:#7a5f23}.fla-lp-vr-tag.have{color:#8ee0a1;background:#1c3526;border-color:#2f6b45}
      .fla-lp-vr-meta{color:#98a1ad;font-size:12px}
      .fla-lp-vr-file{color:#7d858f;font-size:11px;overflow-wrap:anywhere}
      .fla-lp-vr-acts{flex:none;display:flex;flex-direction:column;justify-content:center;gap:6px}
      .fla-lp-vr-btn{min-width:92px;height:32px;padding:0 14px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer}.fla-lp-vr-btn:disabled{opacity:.45;cursor:default}
      .fla-lp-vr-btn.get{color:#fff;background:#2f6fd0;border:1px solid #3b82f6}.fla-lp-vr-btn.get:hover:not(:disabled){background:#3b82f6}
      .fla-lp-vr-btn.del{color:#ff8477;background:transparent;border:1px solid #a8483c}.fla-lp-vr-btn.del:hover:not(:disabled){color:#fff;background:#a83426}
      .fla-lp-vr-bar{display:flex;align-items:center;gap:10px;margin-bottom:9px;padding:8px 11px;background:#1d2026;border:1px solid #3b424d;border-radius:8px;font-size:12px;color:#98a1ad}.fla-lp-vr-bar .who{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fla-lp-vr-bar .track{flex:1;min-width:60px;height:8px;overflow:hidden;background:#111419;border:1px solid #3b424d;border-radius:5px}.fla-lp-vr-bar .fill{width:0;height:100%;background:#1971c2;transition:width .2s}.fla-lp-vr-bar .pct{flex:none;white-space:nowrap}
      .fla-lp-vr-note{padding:22px;text-align:center;color:#89919d;font-size:13px;line-height:1.6}
      .fla-lp-dt-model{display:grid;grid-template-columns:minmax(200px,300px) 1fr;gap:20px;align-items:start}@media (max-width:640px){.fla-lp-dt-model{grid-template-columns:1fr}}.fla-lp-dt-cover{display:flex;flex-direction:column;gap:8px}.fla-lp-dt-cover>h3{margin:0;color:#8d95a1;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}.fla-lp-dt-coverbox{display:grid;place-items:center;overflow:hidden;background:#111318;border:1px solid #3b424d;border-radius:9px}.fla-lp-dt-coverbox img,.fla-lp-dt-coverbox video{display:block;width:100%;height:auto}.fla-lp-dt-setcover{position:absolute;z-index:4;left:8px;top:8px;padding:5px 10px;color:#fff;background:#000a;border:1px solid #ffffff33;border-radius:6px;font-size:11px;cursor:pointer}.fla-lp-dt-setcover:hover{background:#2f6fd0;border-color:#3b82f6}.fla-lp-dt-setcover:disabled{opacity:.5;cursor:default}
      .fla-lp-toast{position:fixed;z-index:100020;left:50%;bottom:38px;transform:translateX(-50%);padding:9px 16px;color:#fff;background:#2f6fd0;border-radius:8px;font:13px Arial,sans-serif;box-shadow:0 8px 26px #0009}.fla-lp-toast.bad{background:#c0392b}
      .fla-lp-blur{filter:blur(18px);transform:scale(1.06)}.fla-lp-veil{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;background:#0006;pointer-events:none}.fla-lp-veil button{pointer-events:auto}.fla-lp-veil span{padding:5px 11px;color:#fff;background:#000a;border-radius:6px;font-size:13px;font-weight:700}.fla-lp-veil button{padding:5px 15px;color:#fff;background:#2f6fd0;border:0;border-radius:6px;font-size:12px;cursor:pointer}.fla-lp-veil button:hover{background:#3b82f6}.fla-lp-head .adult.on{color:#fff;background:#c0392b;border-color:#e05c4a}
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

function searchableBaseModel(base) {
    return modelBadge(base).replace(/^LoRA\s*(?:\|\s*)?/, "");
}

function highlighted(element, text, query) {
    // 버전처럼 없을 수도 있는 칸은 요소 자체가 안 만들어진다
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

function makePreview(item, interactive = false, blur = false, onReveal = null, onCopyWords = null) {
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
    const words = (item.trained_words ?? []).filter(Boolean);
    const copy = document.createElement("button"); copy.className = "fla-lp-copy";
    copy.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 2h16v11h-2V4H5v16h7v2H3V2Z"/><path fill="currentColor" d="M7 7h8v2H7V7Zm0 4h8v2H7v-2Zm0 4h5v2H7v-2Zm9-1 5 4-5 4v-3h-4v-2h4v-3Z"/></svg>`;
    copy.title = t("copyTriggers");
    copy.onclick = async (event) => {
        event.stopPropagation();
        const text = words.join(", ");
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            onCopyWords?.(text);
            toast(t("triggersCopied"));
        } catch (e) { /* 클립보드 권한이 없으면 아무 상태도 바꾸지 않는다 */ }
    };
    // 배지와 버전은 한 줄에 나란히 둔다. 길면 줄바꿈되어 전부 보인다.
    const tags = document.createElement("div"); tags.className = "fla-lp-tags";
    const badge = document.createElement("div"); badge.className = "fla-lp-badge"; badge.textContent = modelBadge(item.base_model);
    const version = document.createElement("div"); version.className = "fla-lp-version"; version.textContent = item.version || "";
    if (item.version) tags.append(version);
    tags.append(badge);
    // 아직 Civitai 정보가 없는 카드는 표시해 둔다(우클릭 → 가져오기)
    if (item.has_info === false) {
        const noInfo = document.createElement("div");
        noInfo.className = "fla-lp-badge fla-lp-noinfo";
        noInfo.textContent = t("civitaiNoInfo");
        tags.append(noInfo);
    }
    preview.append(shade, title, star);
    if (words.length) preview.append(copy);
    preview.append(tags);

    // 성인물 가림막. "보기" 를 누르면 이 카드만 풀린다.
    if (blur) {
        const veil = document.createElement("div"); veil.className = "fla-lp-veil";
        const label = document.createElement("span"); label.textContent = t("adultLabel");
        const show = document.createElement("button"); show.textContent = t("adultShow");
        show.onclick = (event) => { event.stopPropagation(); onReveal?.(); };
        veil.append(label, show);
        preview.appendChild(veil);
    }

    if (!interactive) {
        star.tabIndex = -1;
        copy.tabIndex = -1;
    }
    return preview;
}

/** 다른 노드 UI에서도 선택창과 같은 LoRA 카드 모양을 쓸 수 있게 한다. */
export async function makeLoraCardPreview(item, revealed = false, onReveal = null, onCopyWords = null) {
    addStyles();
    const settings = await loadSettings();
    const blur = !revealed && settings.blurAdult !== false && item.adult;
    return makePreview(item, false, blur, onReveal, onCopyWords);
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

/** 창 아래쪽에 잠깐 떴다 사라지는 알림. */
function toast(message, error = false) {
    const el = document.createElement("div");
    el.className = `fla-lp-toast${error ? " bad" : ""}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
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
 *  blurAdult 가 참이면 성인 등급 예시 이미지를 흐리게 보여준다.
 *  onInfoChanged 는 Civitai 에서 정보를 새로 받아 제목·태그까지 바뀌었을 때 부른다. */
export async function showLoraDetail(name, blurAdult = true, onPreviewChanged = null, onInfoChanged = null) {
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
    bg.innerHTML = `<div class="fla-lp-dt" role="dialog" aria-modal="true"><div class="fla-lp-dt-head"><div class="fla-lp-dt-titles"><h2></h2><div class="sub"></div></div><button class="close" title="${t("cancel")}">×</button></div><div class="fla-lp-dt-tabs"></div><div class="fla-lp-dt-split"><div class="fla-lp-dt-body"></div></div></div>`;
    document.body.appendChild(bg);

    const paintHead = () => {
        bg.querySelector("h2").textContent = data.title || name;
        const subParts = [data.version, data.base_model, data.creator && `@${data.creator}`].filter(Boolean);
        bg.querySelector(".sub").textContent = subParts.join("  ·  ");
    };
    paintHead();

    const tabsHost = bg.querySelector(".fla-lp-dt-tabs");
    const body = bg.querySelector(".fla-lp-dt-body");

    // 버전 줄을 누르면 오른쪽에 펴는 모델 상세 칸(모델 찾기 탭과 같은 것).
    const side = createModelDetail({
        onQueued: () => {
            if (versionHost?.isConnected) {
                watchDownloads(versionHost, versionHost.querySelector(".fla-lp-vr-bar"));
            }
        },
        onClose: () => markPicked(null),
    });
    bg.querySelector(".fla-lp-dt-split").appendChild(side.root);

    // 오른쪽에 펴 놓은 버전. 목록을 다시 그려도 표시가 남게 기억해 둔다.
    let pickedVersion = null;

    /** 지금 펴 놓은 버전 줄에 표시를 남긴다. */
    function markPicked(versionId) {
        pickedVersion = versionId ?? null;
        for (const row of bg.querySelectorAll(".fla-lp-vr")) {
            row.classList.toggle("picked",
                pickedVersion !== null && Number(row.dataset.version) === pickedVersion);
        }
    }

    // 지금 그려 둔 버전 목록 칸. 받기가 끝나면 이 칸만 다시 그린다.
    let versionHost = null;
    // 버전 탭에서 받기 진행률을 물어보는 타이머. 창을 닫으면 같이 멈춘다.
    let dlTimer = null;
    // 등록할 때와 같은 capture 플래그로 지워야 실제로 떨어진다
    const close = () => {
        clearTimeout(dlTimer);
        side.dispose();
        clearCache();
        document.removeEventListener("keydown", key, true);
        bg.remove();
    };
    // 상세 창이 열려 있으면 Esc 가 로라 목록까지 닫지 않도록 여기서 막는다
    const key = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    bg.querySelector(".close").onclick = close;
    bg.onclick = (event) => { if (event.target === bg) close(); };
    document.addEventListener("keydown", key, true);

    /** 대표 이미지를 바꾸고 화면을 새로 그린다.
     *  라이브러리 캐시에도 반영해 목록으로 돌아갔을 때 옛 그림이 남지 않게 한다. */
    async function applyPreview(request) {
        let result;
        try {
            const res = await request();
            result = await res.json();
        } catch (e) {
            result = null;
        }
        if (!result?.ok) {
            toast(t("detailPreviewFail"), true);
            return;
        }
        // 캐시 무효화용 값이 바뀌면 브라우저가 새 파일을 받아온다
        const stamp = result.stamp ?? Date.now();
        data.preview = `/fla/lora-preview?name=${encodeURIComponent(name)}&v=${stamp}`;
        data.preview_type = result.preview_type ?? data.preview_type ?? "image";
        // 목록 쪽 캐시도 같이 고쳐둔다
        const cached = (await library()).find((it) => it.name === name);
        if (cached) {
            cached.preview = data.preview;
            cached.preview_type = data.preview_type;
        }
        onPreviewChanged?.();
        toast(t("detailPreviewDone"));
        buttons[0].onclick();
    }

    /** 서버에서 정보를 다시 읽어 열려 있는 탭을 새로 그린다.
     *  Civitai 에서 받아오면 제목·트리거·예시가 통째로 바뀐다. */
    async function reload() {
        let fresh;
        try {
            const res = await fetch(`/fla/lora-detail?name=${encodeURIComponent(name)}`);
            if (!res.ok) return;
            fresh = await res.json();
        } catch (e) {
            return;
        }
        if (!fresh?.ok) return;
        data = fresh;
        // 정보를 새로 받으면 다른 모델을 가리킬 수도 있다. 버전 목록도 다시 읽는다.
        versions = null;
        paintHead();
        onInfoChanged?.();
        // 보고 있던 탭을 그대로 다시 그린다
        const active = buttons.findIndex((button) => button.classList.contains("on"));
        buttons[active < 0 ? 0 : active].onclick();
    }

    /** 모델 탭 — 대표 이미지와 기본 정보. */
    function renderModel() {
        body.replaceChildren();

        const wrap = document.createElement("div");
        wrap.className = "fla-lp-dt-model";

        // 왼쪽: 대표 이미지
        const left = document.createElement("div");
        left.className = "fla-lp-dt-cover";
        const coverHead = document.createElement("h3");
        coverHead.textContent = t("detailPreview");
        left.appendChild(coverHead);

        const coverBox = document.createElement("div");
        coverBox.className = "fla-lp-dt-coverbox";
        if (data.preview) {
            const media = document.createElement(data.preview_type === "video" ? "video" : "img");
            media.src = data.preview;
            if (data.preview_type === "video") {
                media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true;
            }
            coverBox.appendChild(media);
        } else {
            const empty = document.createElement("div");
            empty.className = "fla-lp-dt-empty";
            empty.textContent = t("detailNoPreview");
            coverBox.appendChild(empty);
        }
        left.appendChild(coverBox);

        // 파일에서 직접 올리기
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*,video/mp4,video/webm";
        picker.style.display = "none";
        picker.onchange = () => {
            const file = picker.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.append("name", name);
            form.append("file", file);
            applyPreview(() => fetch("/fla/lora-preview-upload", { method: "POST", body: form }));
        };
        const upload = document.createElement("button");
        upload.className = "fla-lp-dt-link";
        upload.textContent = t("detailUpload");
        upload.onclick = () => picker.click();

        // Civitai 에서 정보와 대표 이미지를 새로 받아온다.
        // 파일 해시로 찾으므로 이름을 바꾼 로라도 그대로 붙는다.
        const grab = document.createElement("button");
        grab.className = "fla-lp-dt-link";
        grab.textContent = t("civitaiFetch");
        grab.onclick = async () => {
            grab.disabled = true;
            grab.textContent = t("civitaiFetching");
            try {
                if (await fetchLoraInfo(name)) await reload();
            } finally {
                // 성공하면 탭을 새로 그리면서 이 버튼도 다시 만들어진다
                grab.disabled = false;
                grab.textContent = t("civitaiFetch");
            }
        };

        left.append(upload, grab, picker);
        wrap.appendChild(left);

        // 오른쪽: 기본 정보
        const rows = document.createElement("dl");
        rows.className = "fla-lp-dt-rows";
        const add = (label, value) => {
            if (value === undefined || value === null || value === "") return;
            const dt = document.createElement("dt"); dt.textContent = label;
            const dd = document.createElement("dd"); dd.textContent = String(value);
            rows.append(dt, dd);
        };
        add(t("detailName"), data.title);
        add(t("tabVersion"), data.version);
        add(t("detailBase"), data.base_model);
        add(t("detailType"), data.model_type || "LoRA");
        add(t("detailFolder"), data.folder || "/");
        add(t("detailFile"), data.file_name);
        wrap.appendChild(rows);

        body.appendChild(wrap);
    }

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

            const frame = document.createElement("div");
            frame.className = "fla-lp-dt-frame";
            // 예시는 이미지일 수도, 짧은 영상(mp4/webm)일 수도 있다.
            // type 이 없으면 확장자로 판단한다.
            const isVideo = shot.type === "video"
                || /\.(mp4|webm)(\?|$)/i.test(shot.url);
            const img = document.createElement(isVideo ? "video" : "img");
            img.src = shot.url;
            if (isVideo) {
                // 소리 없이 자동으로 반복 재생한다(움짤처럼 보이게)
                img.muted = true;
                img.loop = true;
                img.autoplay = true;
                img.playsInline = true;
                img.preload = "metadata";
            } else {
                img.loading = "lazy";
            }
            img.onerror = () => box.remove();
            frame.appendChild(img);

            // 상세 예시는 모델 전체가 아니라 각 이미지의 등급으로 판단한다.
            // 이미지는 이미 받아둔 뒤라 "보기" 를 누르면 바로 풀린다.
            if (blurAdult && shot.nsfw_level >= ADULT_LEVEL) {
                img.classList.add("fla-lp-blur");
                const veil = document.createElement("div");
                veil.className = "fla-lp-veil";
                const show = document.createElement("button");
                show.textContent = t("adultShow");
                show.onclick = (event) => {
                    event.stopPropagation();
                    img.classList.remove("fla-lp-blur");
                    veil.remove();
                };
                veil.appendChild(show);
                frame.appendChild(veil);
            }
            // 이 예시를 대표 이미지로 삼는 버튼
            const setBtn = document.createElement("button");
            setBtn.className = "fla-lp-dt-setcover";
            setBtn.textContent = t("detailSetPreview");
            setBtn.onclick = (event) => {
                event.stopPropagation();
                setBtn.disabled = true;
                applyPreview(() => fetch("/fla/lora-preview-set", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, url: shot.url }),
                })).finally(() => { setBtn.disabled = false; });
            };
            frame.appendChild(setBtn);

            box.appendChild(frame);

            if (shot.prompt) {
                const meta = document.createElement("div");
                meta.className = "fla-lp-dt-meta";

                const head = document.createElement("div");
                head.className = "fla-lp-dt-metahead";
                const label = document.createElement("b");
                label.textContent = t("detailPrompt");
                const copy = document.createElement("button");
                copy.className = "fla-lp-dt-copy";
                copy.textContent = t("detailCopy");
                copy.title = t("detailCopyPrompt");
                copy.onclick = async (event) => {
                    event.stopPropagation();
                    try { await navigator.clipboard.writeText(shot.prompt); } catch (e) { return; }
                    const old = copy.textContent;
                    copy.textContent = t("detailCopied");
                    setTimeout(() => { copy.textContent = old; }, 900);
                };
                head.append(label, copy);

                const text = document.createElement("div");
                text.className = "fla-lp-dt-prompt";
                text.textContent = shot.prompt;

                meta.append(head, text);
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

    // ------------------------------------------------ 버전 탭
    //
    // Civitai 모델 화면처럼 이 모델의 모든 버전을 늘어놓는다. 아직 없는 버전은
    // 받고, 이미 가진 버전은 지운다. 목록은 한 번만 받아 캐시해 둔다.

    // null 이면 아직 안 받아봤다. 받아온 뒤에는 모델(실패하면 false).
    let versions = null;
    let versionsBusy = false;
    // 못 받아온 까닭. 지워진 모델이면 서버가 알려준다.
    let versionsError = "";
    // 이미 목록에 반영한 받기 완료 시각. 같은 완료로 두 번 새로 읽지 않는다.
    let lastFinished = 0;

    /** 이 모델의 버전 목록을 Civitai 에서 받아온다. */
    async function loadVersions() {
        if (versionsBusy || !data.model_id) return;
        versionsBusy = true;
        try {
            // 지워진 모델은 404 로 온다. 그때도 까닭이 본문에 실려 있다.
            const res = await fetch(`/fla/civitai/model?id=${encodeURIComponent(data.model_id)}`);
            let body = null;
            try { body = await res.json(); } catch (e) { body = null; }
            versions = body?.ok ? body.model : false;
            versionsError = body?.ok ? "" : (body?.error ?? "");
        } catch (e) {
            versions = false;
            versionsError = "";
        } finally {
            versionsBusy = false;
        }
    }

    /** 받는 중인 것이 있으면 진행률을 보여주고, 끝나면 목록을 다시 읽는다. */
    async function watchDownloads(host, bar) {
        clearTimeout(dlTimer);
        let state;
        try {
            const res = await fetch("/fla/civitai/download-status");
            state = res.ok ? (await res.json()).download : null;
        } catch (e) {
            return;
        }
        if (!state || !bar.isConnected) return;

        const busy = state.running || state.queued > 0;
        bar.style.display = busy ? "" : "none";
        if (busy) {
            const current = state.current;
            const queued = state.queued ? `  (+${state.queued})` : "";
            const percent = state.total > 0 ? Math.round((state.received / state.total) * 100) : 0;
            bar.querySelector(".who").textContent = current
                ? `${current.file_name}  ·  ${current.folder}${queued}`
                : t("civitaiPreparing") + queued;
            bar.querySelector(".fill").style.width = `${percent}%`;
            bar.querySelector(".pct").textContent = state.total > 0
                ? `${percent}%  ·  ${prettySize(state.received)} / ${prettySize(state.total)}`
                : prettySize(state.received);
            dlTimer = setTimeout(() => watchDownloads(host, bar), DOWNLOAD_POLL);
            return;
        }
        // 다 받았으면 파일이 늘었다. 목록과 "있음" 표시를 새로 읽는다.
        if (state.done > 0 || state.failed > 0) {
            if ((state.finished_at ?? 0) === lastFinished) return;
            lastFinished = state.finished_at ?? 0;
            if (state.failed > 0 && state.errors?.length) {
                toast(`${state.errors[0].name} — ${state.errors[0].error}`, true);
            }
            libraryPromise = null;
            versions = null;
            onInfoChanged?.();
            await loadVersions();
            if (host.isConnected) paintVersions(host);
        }
    }

    /** 한 버전 줄. 왼쪽에 그림, 오른쪽에 받기나 삭제 버튼. */
    function versionRow(model, version, index, host) {
        const mine = version.id === data.version_id
            || (version.installed_name && version.installed_name === name);
        const row = document.createElement("div");
        row.className = `fla-lp-vr${mine ? " on" : ""}`;
        row.dataset.version = String(version.id ?? "");
        row.title = t("versionOpenSide");
        // 단추를 누른 것이면 그 일만 하고, 빈 곳을 누르면 오른쪽에 상세를 편다
        row.onclick = (event) => {
            if (event.target.closest("button, a")) return;
            side.show(model.id, { versionId: version.id, folder: data.folder || "" });
            markPicked(version.id);
        };

        // 그림 — 성인 등급이면 흐리게 두고 누르면 풀어준다
        const shot = document.createElement("div");
        shot.className = "fla-lp-vr-shot";
        const image = (version.images ?? [])[0];
        if (image) {
            const isVideo = image.type === "video" || /\.(mp4|webm)(\?|$)/i.test(image.url);
            const media = document.createElement(isVideo ? "video" : "img");
            media.src = image.url;
            if (isVideo) {
                media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true;
            } else {
                media.loading = "lazy";
            }
            media.onerror = () => media.remove();
            if (blurAdult && (image.nsfw_level ?? 0) >= ADULT_LEVEL) {
                media.classList.add("fla-lp-blur");
                shot.title = t("adultShow");
                shot.onclick = () => { media.classList.remove("fla-lp-blur"); shot.onclick = null; };
            }
            shot.appendChild(media);
        }
        row.appendChild(shot);

        const main = document.createElement("div");
        main.className = "fla-lp-vr-main";

        const head = document.createElement("div");
        head.className = "fla-lp-vr-name";
        head.append(version.name || `v${index + 1}`);
        const link = document.createElement("a");
        link.href = `https://civitai.com/models/${model.id}?modelVersionId=${version.id}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "↗";
        link.title = t("detailOpenCivitai");
        head.appendChild(link);
        main.appendChild(head);

        const tags = document.createElement("div");
        tags.className = "fla-lp-vr-tags";
        const tag = (text, kind) => {
            const chip = document.createElement("span");
            chip.className = `fla-lp-vr-tag${kind ? " " + kind : ""}`;
            chip.textContent = text;
            tags.appendChild(chip);
        };
        if (index === 0) tag(t("versionLatest"), "new");
        if (mine) tag(t("versionCurrent"), "mine");
        if (version.installed || mine) tag(t("versionInLibrary"), "have");
        if (tags.children.length) main.appendChild(tags);

        const meta = document.createElement("div");
        meta.className = "fla-lp-vr-meta";
        meta.textContent = [
            version.base_model,
            prettyDate(version.published),
            version.size_kb ? prettySize(version.size_kb * 1024) : "",
        ].filter(Boolean).join("  ·  ");
        main.appendChild(meta);

        if (version.file_name) {
            const file = document.createElement("div");
            file.className = "fla-lp-vr-file";
            file.textContent = version.installed_name || version.file_name;
            main.appendChild(file);
        }
        row.appendChild(main);

        // 이미 가진 것은 지우고, 없는 것은 받는다
        const acts = document.createElement("div");
        acts.className = "fla-lp-vr-acts";
        const target = mine ? name : (version.installed ? version.installed_name : "");
        if (target) {
            const drop = document.createElement("button");
            drop.className = "fla-lp-vr-btn del";
            drop.textContent = t("versionDelete");
            drop.onclick = () => removeVersion(target, drop, host);
            acts.appendChild(drop);
        } else {
            const get = document.createElement("button");
            get.className = "fla-lp-vr-btn get";
            get.textContent = t("civitaiDownload");
            get.disabled = !version.downloadable;
            if (!version.downloadable) get.title = t("versionNoFile");
            get.onclick = () => grabVersion(model, version, get, host);
            acts.appendChild(get);
        }
        row.appendChild(acts);
        return row;
    }

    /** 버전 하나를 받는다. 저장 폴더는 지금 이 파일이 있는 곳을 먼저 쓴다. */
    async function grabVersion(model, version, button, host) {
        button.disabled = true;
        try {
            const res = await fetch("/fla/civitai/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    version_id: version.id,
                    folder: data.folder || version.folder || "",
                    title: model.name || data.title,
                }),
            });
            const result = res.ok ? await res.json() : null;
            if (!result?.ok) { toast(result?.error ?? t("civitaiDownloadFail"), true); return; }
            toast(t("civitaiQueued"));
            watchDownloads(host, host.querySelector(".fla-lp-vr-bar"));
        } catch (e) {
            toast(t("civitaiDownloadFail"), true);
        } finally {
            button.disabled = false;
        }
    }

    /** 이미 가진 버전을 지운다. 되돌릴 수 없으므로 한 번 더 물어본다. */
    async function removeVersion(target, button, host) {
        if (!confirm(t("versionDeleteConfirm", target))) return;
        button.disabled = true;
        let result;
        try {
            const res = await fetch("/fla/lora-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: target }),
            });
            result = await res.json();
        } catch (e) {
            result = null;
        }
        if (!result?.ok) {
            button.disabled = false;
            toast(t("versionDeleteFail") + (result?.error ?? ""), true);
            return;
        }
        toast(t("versionDeleted"));
        libraryPromise = null;
        onInfoChanged?.();
        // 지금 보고 있던 파일을 지웠으면 상세 창을 열어둘 수 없다
        if (target === name) { close(); return; }
        versions = null;
        await loadVersions();
        if (host.isConnected) paintVersions(host);
    }

    /** 버전 목록 칸을 (다시) 그린다. */
    function paintVersions(host) {
        host.replaceChildren();

        const bar = document.createElement("div");
        bar.className = "fla-lp-vr-bar";
        bar.style.display = "none";
        const who = document.createElement("div"); who.className = "who";
        const track = document.createElement("div"); track.className = "track";
        const fill = document.createElement("div"); fill.className = "fill";
        track.appendChild(fill);
        const pct = document.createElement("div"); pct.className = "pct";
        bar.append(who, track, pct);
        host.appendChild(bar);

        const note = (text) => {
            const line = document.createElement("div");
            line.className = "fla-lp-vr-note";
            line.textContent = text;
            host.appendChild(line);
        };
        // Civitai 정보가 없으면 어느 모델의 버전인지 알 길이 없다
        if (!data.model_id) { note(t("versionsNeedInfo")); return; }
        if (versions === null) { note(t("versionsLoading")); return; }
        if (versions === false) {
            note(t("versionsFail") + (versionsError ? `  ·  ${versionsError}` : ""));
            return;
        }

        const list = versions.versions ?? [];
        if (!list.length) { note(t("versionsNone")); return; }

        const box = document.createElement("div");
        box.className = "fla-lp-vr-list";
        list.forEach((version, index) => box.appendChild(versionRow(versions, version, index, host)));
        host.appendChild(box);
        // 줄을 새로 만들었으므로 펴 놓은 버전 표시를 다시 찍는다
        markPicked(pickedVersion);
        // 다른 창에서 받는 중일 수도 있다. 진행률이 있으면 이어서 보여준다.
        watchDownloads(host, bar);
    }

    /** 버전 탭 — 지금 이 파일의 정보와, 이 모델의 모든 버전. */
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

        const sec = document.createElement("div");
        sec.className = "fla-lp-dt-sec";
        sec.style.marginTop = "22px";
        const title = document.createElement("h3");
        title.textContent = t("versionsAll");
        const host = document.createElement("div");
        versionHost = host;
        sec.append(title, host);
        body.appendChild(sec);

        paintVersions(host);
        // 아직 안 받아왔으면 지금 받아서 다시 그린다
        if (data.model_id && versions === null && !versionsBusy) {
            loadVersions().then(() => { if (host.isConnected) paintVersions(host); });
        }
    }

    const tabs = [
        [t("tabModel"), renderModel],
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
            // 오른쪽 상세는 버전 탭에서 연 것이다. 탭을 옮기면 접는다.
            side.clear();
            pickedVersion = null;
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
        bg.innerHTML = `<div class="fla-lp" role="dialog" aria-modal="true"><div class="fla-lp-head"><input type="search" placeholder="${t("searchLora")}"><div class="fla-lp-hint">${t("hintRightClick")}</div><button class="fav">☆ ${t("loraFavorites")}</button><button class="civitai" title="${t("civitaiTitle")}">Civitai<span class="dot"></span></button><button class="adult" title="${t("adultBlur")}">19</button><button class="close" title="${t("cancel")}">×</button></div><div class="fla-lp-main"><aside class="fla-lp-side"></aside><section class="fla-lp-content"><div class="fla-lp-path"></div><div class="fla-lp-grid"></div></section></div></div>`;
        document.body.appendChild(bg);
        const input = bg.querySelector("input");
        const fav = bg.querySelector(".fav");
        const civitaiBtn = bg.querySelector(".civitai");
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

        // 한 번만 닫는다. 카드 클릭 뒤 배경 클릭이 이어 들어와
        // close(null) 이 덮어쓰는 일이 없도록 막는다.
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
        /** 서버에서 목록을 다시 읽어 새로 그린다.
         *  Civitai 정보를 채우면 제목·대표 이미지가 통째로 바뀌므로 캐시를 버린다. */
        const reloadLibrary = async () => {
            libraryPromise = null;
            const fresh = await library();
            // items 는 화면 곳곳이 붙잡고 있는 배열이라 갈아끼우지 않고 안을 바꾼다
            items.splice(0, items.length, ...fresh);
            render();
        };

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
            // 검색 결과와 카드에서 강조되는 텍스트가 어긋나지 않도록
            // 실제 카드에 보이는 제목, 버전, 모델 배지만 검색한다.
            const shown = scoped.filter((item) => {
                const cardText = `${item.title || ""} ${item.version || ""} ${searchableBaseModel(item.base_model)}`;
                return (!favoritesOnly || item.favorite)
                    && (!query || cardText.toLocaleLowerCase().includes(query));
            });
            fav.classList.toggle("on", favoritesOnly); fav.textContent = `${favoritesOnly ? "★" : "☆"} ${t("loraFavorites")}`;
            renderSide(); renderPath(shown.length, scoped.length); grid.replaceChildren();
            if (!shown.length) { const empty = document.createElement("div"); empty.className = "fla-lp-empty"; empty.textContent = t("noLoras"); grid.appendChild(empty); return; }
            for (const item of shown) {
                const card = document.createElement("div"); card.className = "fla-lp-card"; card.title = `${item.name}
${t("detailMore")}: ${t("hintRightClick")}`; card.tabIndex = 0; card.setAttribute("role", "button"); card.onclick = () => close(item.name); card.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") close(item.name); };
                // 우클릭하면 모델 상세 창을 연다(고르지는 않는다)
                card.oncontextmenu = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    // 대표 이미지를 바꾸면 목록도 새로 그린다
                    showLoraDetail(item.name, blurAdult, render, reloadLibrary);
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
            // 빨간 활성 상태는 성인 이미지를 보여주는 상태다.
            adultBtn.classList.toggle("on", !blurAdult);
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

        // 일괄 가져오기 창. 닫을 때 하나라도 채워졌으면 목록을 새로 읽는다.
        civitaiBtn.onclick = () => openCivitaiPanel(async () => {
            await reloadLibrary();
            syncCivitaiButton();
        });

        /** 할 일이 남았으면 버튼에 노란 점을 찍는다(키 없음 또는 못 채운 로라). */
        const civitaiDot = civitaiBtn.querySelector(".dot");
        const syncCivitaiButton = async () => {
            const status = await civitaiStatus();
            if (!status) { civitaiDot.style.display = "none"; return; }
            civitaiDot.style.display = (!status.has_key || status.pending > 0) ? "" : "none";
            civitaiBtn.title = status.has_key
                ? `${t("civitaiTitle")}  —  ${t("civitaiPending")}: ${status.pending}`
                : t("civitaiNeedKey");
        };
        civitaiDot.style.display = "none";
        syncCivitaiButton();

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
