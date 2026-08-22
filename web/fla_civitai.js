/** Civitai 에서 로라 정보·이미지를 받아오는 화면.
 *
 *  서버가 파일 해시로 모델을 찾아 <로라이름>.metadata.json 을 만든다.
 *  여기서는 부르고 진행률만 보여준다.
 *
 *  API 키가 없으면 발급 안내를 먼저 보여준다. 안내에 쓰는 그림은 Civitai 화면을
 *  다시 그린 것이다(실제 화면을 캡처해 두면 계정 이름·키가 같이 남는다).
 *
 *  로라 선택창(fla_lora_picker.js)이 이 파일을 부른다. 반대 방향으로는
 *  가져오지 않는다(서로 물고 도는 import 를 만들지 않으려고).
 */

import { t } from "./fla_i18n.js";

// 진행률을 물어보는 간격(ms). 파일 하나에 1 초 남짓 걸리므로 이 정도면 충분하다.
const POLL = 700;
// Civitai 계정 설정 페이지. 안내에서 바로 열어준다.
const ACCOUNT_URL = "https://civitai.com/user/account";

function addCivitaiStyles() {
    if (document.getElementById("fla-civitai-style")) return;
    const style = document.createElement("style");
    style.id = "fla-civitai-style";
    style.textContent = `
      .fla-cv-bg{position:fixed;inset:0;z-index:100015;background:#000b;display:grid;place-items:center;padding:3vh}
      .fla-cv{width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#181a1f;color:#ddd;border:1px solid #4b5360;border-radius:12px;overflow:hidden;box-shadow:0 22px 70px #000;font:14px Arial,sans-serif}
      .fla-cv-head{display:flex;align-items:center;gap:10px;padding:13px 14px;background:#22262d;border-bottom:1px solid #383e48}.fla-cv-head h2{flex:1;margin:0;font-size:15px;font-weight:700;color:#fff}.fla-cv-head .logo{flex:none;display:grid;width:26px;height:26px;place-items:center;color:#fff;background:#1971c2;border-radius:7px;font-size:14px;font-weight:800}.fla-cv-head button{flex:none;width:32px;height:32px;padding:0;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;font-size:18px;cursor:pointer}.fla-cv-head button:hover{background:#3a424e}
      .fla-cv-body{padding:14px;overflow-y:auto}
      .fla-cv-sec{margin-bottom:16px}.fla-cv-sec>h3{margin:0 0 8px;color:#8d95a1;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
      .fla-cv-key{display:flex;gap:6px}.fla-cv-key input{flex:1;min-width:0;height:34px;padding:0 10px;color:#eee;background:#111419;border:1px solid #454c58;border-radius:7px}
      .fla-cv-hint{margin-top:6px;color:#7d858f;font-size:12px;line-height:1.5}.fla-cv-hint a{color:#4dabf7}
      .fla-cv-btn{height:34px;padding:0 14px;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;font-size:13px;cursor:pointer}.fla-cv-btn:hover{background:#3a424e}.fla-cv-btn:disabled{opacity:.45;cursor:default}
      .fla-cv-btn.go{color:#fff;background:#1971c2;border-color:#1c7ed6}.fla-cv-btn.go:hover{background:#1c7ed6}
      .fla-cv-btn.stop{color:#fff;background:#a83426;border-color:#c0392b}.fla-cv-btn.stop:hover{background:#c0392b}
      .fla-cv-link{padding:0;color:#4dabf7;background:transparent;border:0;font-size:12px;text-decoration:underline;cursor:pointer}.fla-cv-link:hover{color:#74c0fc}
      .fla-cv-row{display:flex;flex-wrap:wrap;gap:8px}
      .fla-cv-count{margin-bottom:9px;color:#c8cdd5;font-size:13px}.fla-cv-count b{color:#fff}
      .fla-cv-check{display:flex;align-items:center;gap:7px;margin-top:10px;color:#98a1ad;font-size:12px;cursor:pointer}.fla-cv-check input{margin:0;cursor:pointer}
      .fla-cv-bar{height:8px;margin:10px 0 7px;overflow:hidden;background:#111419;border:1px solid #3b424d;border-radius:5px}.fla-cv-bar>div{height:100%;width:0;background:#1971c2;transition:width .2s}
      .fla-cv-now{color:#98a1ad;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fla-cv-tally{margin-top:5px;color:#98a1ad;font-size:12px}
      .fla-cv-errors{max-height:150px;margin-top:9px;padding:8px 10px;overflow-y:auto;background:#1d2026;border:1px solid #3b424d;border-radius:7px;color:#c8938c;font-size:12px;line-height:1.55}.fla-cv-errors div{overflow-wrap:anywhere}
      .fla-cv-toast{position:fixed;z-index:100025;left:50%;bottom:38px;transform:translateX(-50%);padding:9px 16px;color:#fff;background:#1971c2;border-radius:8px;font:13px Arial,sans-serif;box-shadow:0 8px 26px #0009}.fla-cv-toast.bad{background:#c0392b}
      .fla-cv-note{padding:10px 12px;background:#15263a;border:1px solid #1f4a75;border-left:3px solid #1971c2;border-radius:7px;color:#cfe2f5;font-size:12px;line-height:1.6}
      .fla-cv-note b{color:#fff}
      .fla-cv-warn{margin-top:9px;padding:9px 11px;background:#2a2418;border:1px solid #5c4a22;border-radius:7px;color:#e0cd9d;font-size:12px;line-height:1.55}
      .fla-cv-steps{display:flex;flex-direction:column;gap:15px;margin-top:13px}
      .fla-cv-step{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:start}
      .fla-cv-num{display:grid;width:24px;height:24px;place-items:center;color:#fff;background:#1971c2;border-radius:50%;font-size:12px;font-weight:700}
      .fla-cv-steptext{color:#c8cdd5;font-size:13px;line-height:1.55}.fla-cv-steptext b{color:#fff}
      .fla-cv-mock{margin-top:8px;padding:10px;background:#1b1f26;border:1px solid #333a45;border-radius:8px;color:#aeb6c1;font-size:11px}
      .fla-cv-mockrow{display:flex;align-items:center;gap:8px}
      .fla-cv-mockavatar{flex:none;width:22px;height:22px;background:#1971c2;border-radius:50%}
      .fla-cv-mockname{flex:1;color:#dde2e8}
      .fla-cv-mockchev{color:#7d858f}
      .fla-cv-mockrule{height:1px;margin:8px 0;background:#333a45}
      .fla-cv-mockbar{display:flex;gap:8px}
      .fla-cv-mockicon{display:grid;width:34px;height:24px;place-items:center;background:#252a32;border:1px solid #3a414c;border-radius:5px}
      .fla-cv-mockicon.on{color:#fff;background:#1971c2;border-color:#4dabf7;box-shadow:0 0 0 2px #4dabf755}
      .fla-cv-mocktip{margin-top:7px;color:#ffd34e}
      .fla-cv-mockhead{display:flex;align-items:center;gap:10px}.fla-cv-mockhead b{flex:1;color:#fff;font-size:13px}
      .fla-cv-mockbtn{flex:none;padding:4px 9px;background:#252a32;border:1px solid #3a414c;border-radius:5px;color:#cfd6de}
      .fla-cv-mockbtn.on{color:#fff;background:#1971c2;border-color:#4dabf7;box-shadow:0 0 0 2px #4dabf755}
      .fla-cv-mockdim{margin-top:6px;color:#7d858f;line-height:1.5}
      .fla-cv-mocktitle{margin-bottom:8px;color:#fff;font-size:13px;font-weight:700}
      .fla-cv-mockfield{display:flex;align-items:center;gap:8px;margin-bottom:6px}.fla-cv-mockfield>span{flex:none;width:105px;color:#8d95a1}
      .fla-cv-mockinput{flex:1;min-width:0;padding:4px 8px;color:#dde2e8;background:#111419;border:1px solid #3a414c;border-radius:5px}
      .fla-cv-mockinput.dim{color:#6b7481}
      .fla-cv-mocktable{display:grid;grid-template-columns:1fr 52px 52px;gap:1px;margin:9px 0;overflow:hidden;background:#333a45;border:1px solid #333a45;border-radius:5px}
      .fla-cv-mocktable>div{padding:4px 8px;text-align:center;background:#1e232a}
      .fla-cv-mocktable>div:nth-child(3n+1){text-align:left}
      .fla-cv-mocktable>div.h{color:#8d95a1;background:#242932}
      .fla-cv-mocktable>div.yes{color:#4dabf7}
      .fla-cv-mockright{display:flex;justify-content:flex-end}
      .fla-cv-mockkey{display:flex;align-items:center;gap:8px;padding:6px 9px;color:#dde2e8;background:#111419;border:1px solid #3a414c;border-radius:5px;font-family:monospace}
      .fla-cv-mockkey>span:first-child{flex:1;min-width:0;overflow:hidden}
    `;
    document.head.appendChild(style);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function toast(message, error = false) {
    addCivitaiStyles();
    const node = el("div", `fla-cv-toast${error ? " bad" : ""}`, message);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2200);
}

async function json(url, options) {
    const res = await fetch(url, options);
    let data = null;
    try { data = await res.json(); } catch (e) { /* 본문이 비어 있을 수도 있다 */ }
    return { ok: res.ok, status: res.status, data };
}

const post = (url, body) => json(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
});

/** 키 유무와 남은 개수, 진행 중인 검사 상태를 한 번에 가져온다. */
export async function civitaiStatus() {
    try {
        const { data } = await json("/fla/civitai/status");
        return data?.ok ? data : null;
    } catch (e) {
        return null;
    }
}

/** 로라 하나를 Civitai 에서 새로 받아온다. 상세 창 버튼이 쓴다.
 *  성공하면 서버가 준 결과를, 실패하면 null 을 준다(알림은 여기서 띄운다). */
export async function fetchLoraInfo(name) {
    let result;
    try {
        result = await post("/fla/civitai/fetch", { name });
    } catch (e) {
        toast(t("civitaiFetchFail") + String(e), true);
        return null;
    }
    if (result.data?.ok) {
        toast(t("civitaiFetchDone"));
        return result.data;
    }
    if (result.status === 404 && result.data?.missing) {
        toast(t("civitaiFetchMissing"), true);
        return null;
    }
    toast(t("civitaiFetchFail") + (result.data?.error ?? result.status), true);
    return null;
}


// -------------------------------------------------- 발급 안내 그림
//
// Civitai 화면을 흉내 낸 목업이다. 진짜 캡처를 넣으면 계정 이름과 키가
// 같이 남으므로 모양만 다시 그린다. 글자는 실제 화면과 같은 영어로 둔다.

/** 1단계 — 프로필 메뉴 맨 아래 톱니바퀴. */
function mockAccountMenu() {
    const box = el("div", "fla-cv-mock");
    const row = el("div", "fla-cv-mockrow");
    row.append(el("div", "fla-cv-mockavatar"), el("div", "fla-cv-mockname", t("civitaiMockAccount")), el("div", "fla-cv-mockchev", "›"));
    const bar = el("div", "fla-cv-mockbar");
    bar.append(el("div", "fla-cv-mockicon", "☀"), el("div", "fla-cv-mockicon on", "⚙"), el("div", "fla-cv-mockicon", "↦"));
    box.append(row, el("div", "fla-cv-mockrule"), bar, el("div", "fla-cv-mocktip", "↑ Account settings"));
    return box;
}

/** 2단계 — API Keys 칸의 파란 버튼. */
function mockApiKeys() {
    const box = el("div", "fla-cv-mock");
    const head = el("div", "fla-cv-mockhead");
    head.append(el("b", null, "API Keys"), el("div", "fla-cv-mockbtn on", "+ Add API key"));
    box.append(head, el("div", "fla-cv-mockdim", "You can use API keys to interact with the site through the API as your user."));
    return box;
}

/** 3단계 — 이름과 권한을 고르는 창. Read 만 켜면 된다. */
function mockCreateDialog() {
    const box = el("div", "fla-cv-mock");
    box.append(el("div", "fla-cv-mocktitle", "Create API Key"));

    const name = el("div", "fla-cv-mockfield");
    name.append(el("span", null, "Name"), el("div", "fla-cv-mockinput", "ComfyUI"));
    const preset = el("div", "fla-cv-mockfield");
    preset.append(el("span", null, "Permission preset"), el("div", "fla-cv-mockinput", "Read only   ▾"));
    box.append(name, preset);

    const table = el("div", "fla-cv-mocktable");
    const cells = [
        ["Resource", "h"], ["Read", "h"], ["Write", "h"],
        ["Models", ""], ["☑", "yes"], ["☐", ""],
        ["Media & Posts", ""], ["☑", "yes"], ["☐", ""],
    ];
    for (const [text, cls] of cells) table.appendChild(el("div", cls, text));
    box.appendChild(table);

    const right = el("div", "fla-cv-mockright");
    right.appendChild(el("div", "fla-cv-mockbtn on", "Save"));
    box.appendChild(right);
    return box;
}

/** 4단계 — 한 번만 보여주는 키. */
function mockKeyResult() {
    const box = el("div", "fla-cv-mock");
    box.append(el("div", "fla-cv-mocktitle", "Here is your API Key:"));
    const row = el("div", "fla-cv-mockkey");
    row.append(el("span", null, "•".repeat(32)), el("span", null, "⧉"));
    box.append(row, el("div", "fla-cv-mockdim", "Be sure to save this, you won't be able to see it again."));
    return box;
}

const STEPS = [
    ["civitaiStep1", mockAccountMenu],
    ["civitaiStep2", mockApiKeys],
    ["civitaiStep3", mockCreateDialog],
    ["civitaiStep4", mockKeyResult],
];


/** 일괄 가져오기 창. onFinished 는 한 개라도 채워졌을 때만 부른다
 *  (목록을 다시 그려야 새 그림과 이름이 보인다). */
export function openCivitaiPanel(onFinished = null) {
    addCivitaiStyles();

    const bg = el("div", "fla-cv-bg");
    bg.innerHTML = `<div class="fla-cv" role="dialog" aria-modal="true"><div class="fla-cv-head"><div class="logo">C</div><h2></h2><button class="close" title="${t("cancel")}">×</button></div><div class="fla-cv-body"></div></div>`;
    document.body.appendChild(bg);
    bg.querySelector("h2").textContent = t("civitaiTitle");
    const body = bg.querySelector(".fla-cv-body");

    let timer = null;
    let changed = false;
    // 키가 있어도 "키 변경" 을 누르면 안내 화면을 다시 보여준다
    let showGuide = false;

    const close = () => {
        clearTimeout(timer);
        document.removeEventListener("keydown", key, true);
        bg.remove();
        // 검사가 백그라운드로 계속 돌 수 있으므로, 채운 게 있으면 목록을 새로 그린다
        if (changed) onFinished?.();
    };
    // 이 창이 열려 있는 동안에는 Esc 가 로라 선택창까지 닫지 않게 막는다
    const key = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    bg.querySelector(".close").onclick = close;
    bg.onclick = (event) => { if (event.target === bg) close(); };
    document.addEventListener("keydown", key, true);

    // ---------------------------------------------- 안내 화면(키 없을 때)
    const guide = el("div", "fla-cv-sec");

    const note = el("div", "fla-cv-note");
    note.append(el("b", null, t("civitaiNeedKey")), document.createTextNode(" "), document.createTextNode(t("civitaiNeedKeyDesc")));
    guide.appendChild(note);

    const open = el("button", "fla-cv-btn go", t("civitaiOpenAccount"));
    open.style.marginTop = "11px";
    open.onclick = () => window.open(ACCOUNT_URL, "_blank", "noopener");
    guide.appendChild(open);

    const steps = el("div", "fla-cv-steps");
    STEPS.forEach(([label, mock], index) => {
        const step = el("div", "fla-cv-step");
        step.appendChild(el("div", "fla-cv-num", String(index + 1)));
        const text = el("div", "fla-cv-steptext", t(label));
        text.appendChild(mock());
        step.appendChild(text);
        steps.appendChild(step);
    });
    guide.appendChild(steps);

    guide.appendChild(el("div", "fla-cv-warn", t("civitaiKeySecret")));

    const keyHead = el("h3");
    keyHead.textContent = t("civitaiKey");
    keyHead.style.marginTop = "16px";
    const keyRow = el("div", "fla-cv-key");
    const keyInput = el("input");
    keyInput.type = "password";
    keyInput.autocomplete = "off";
    keyInput.placeholder = t("civitaiPasteKey");
    const keySave = el("button", "fla-cv-btn go", t("save"));
    keyRow.append(keyInput, keySave);
    guide.append(keyHead, keyRow);

    const skipRow = el("div", "fla-cv-row");
    skipRow.style.marginTop = "10px";
    const skip = el("button", "fla-cv-link", t("civitaiSkip"));
    skipRow.appendChild(skip);
    guide.appendChild(skipRow);

    async function saveKey(value) {
        keySave.disabled = true;
        try {
            const { data } = await post("/fla/civitai/key", { key: value });
            if (!data?.ok) { toast(data?.error ?? t("civitaiFetchFail"), true); return false; }
            keyInput.value = "";
            toast(data.has_key ? t("civitaiKeySaved") : t("civitaiKeyCleared"));
            // 키를 넣었으면 바로 가져오기 화면으로 넘어간다
            showGuide = false;
            await refresh();
            return true;
        } finally {
            keySave.disabled = false;
        }
    }

    keySave.onclick = () => {
        const value = keyInput.value.trim();
        if (!value) { toast(t("civitaiPasteKey"), true); return; }
        saveKey(value);
    };
    keyInput.addEventListener("keydown", (event) => { if (event.key === "Enter") keySave.onclick(); });
    skip.onclick = () => { showGuide = false; refresh(); };

    // ---------------------------------------------- 가져오기 화면(키 있을 때)
    const scan = el("div", "fla-cv-sec");

    const keyState = el("div", "fla-cv-row");
    keyState.style.marginBottom = "13px";
    const keyStateText = el("div", null, "");
    keyStateText.style.cssText = "flex:1;min-width:0;color:#98a1ad;font-size:12px;align-self:center";
    const changeKey = el("button", "fla-cv-link", t("civitaiChangeKey"));
    const clearKey = el("button", "fla-cv-link", t("civitaiRemoveKey"));
    keyState.append(keyStateText, changeKey, clearKey);
    scan.appendChild(keyState);
    changeKey.onclick = () => { showGuide = true; paintView(true); };
    clearKey.onclick = () => saveKey("");

    scan.appendChild(el("h3", null, t("civitaiScan")));
    const count = el("div", "fla-cv-count");
    const buttons = el("div", "fla-cv-row");
    const scanMissing = el("button", "fla-cv-btn go", t("civitaiScanMissing"));
    const scanAll = el("button", "fla-cv-btn", t("civitaiScanAll"));
    const stop = el("button", "fla-cv-btn stop", t("civitaiStop"));
    stop.style.display = "none";
    buttons.append(scanMissing, scanAll, stop);

    // 대표 이미지는 기본으로 건드리지 않는다. 직접 고른 그림을 말없이 바꾸면 곤란하다.
    const replaceRow = el("label", "fla-cv-check");
    const replace = el("input");
    replace.type = "checkbox";
    replaceRow.append(replace, el("span", null, t("civitaiReplacePreview")));

    const bar = el("div", "fla-cv-bar");
    const fill = el("div");
    bar.appendChild(fill);
    bar.style.display = "none";
    const now = el("div", "fla-cv-now");
    const tally = el("div", "fla-cv-tally");
    const errors = el("div", "fla-cv-errors");
    errors.style.display = "none";
    scan.append(count, buttons, replaceRow, bar, now, tally, errors);

    body.append(guide, scan);

    /** 안내와 가져오기 중 어느 쪽을 보여줄지 정한다. */
    function paintView(hasKey) {
        const wantGuide = showGuide || !hasKey;
        guide.style.display = wantGuide ? "" : "none";
        scan.style.display = wantGuide ? "none" : "";
        if (wantGuide) body.scrollTop = 0;
    }

    function paint(status) {
        if (!status) return;
        paintView(status.has_key === true);
        keyStateText.textContent = status.has_key ? t("civitaiKeyOk") : t("civitaiKeyNone");
        clearKey.style.display = status.has_key ? "" : "none";

        const p = status.progress ?? {};
        const running = p.running === true;
        count.replaceChildren(document.createTextNode(`${t("civitaiPending")}: `), el("b", null, String(status.pending ?? 0)));

        scanMissing.disabled = running || !(status.pending > 0);
        scanAll.disabled = running;
        replace.disabled = running;
        stop.style.display = running ? "" : "none";
        stop.disabled = p.cancelled === true;

        const total = p.total ?? 0;
        if (total > 0) {
            bar.style.display = "";
            fill.style.width = `${Math.round(((p.done ?? 0) / total) * 100)}%`;
            now.textContent = running
                ? `${p.done ?? 0} / ${total}  ·  ${p.current || ""}`
                : `${p.done ?? 0} / ${total}  ·  ${p.cancelled ? t("civitaiStopped") : t("civitaiFinished")}`;
            tally.textContent = `${t("civitaiDone")} ${p.updated ?? 0}  ·  ${t("civitaiMissingCount")} ${p.missing ?? 0}  ·  ${t("civitaiFailed")} ${p.failed ?? 0}`;
        } else {
            bar.style.display = "none";
            now.textContent = "";
            tally.textContent = "";
        }

        if (p.errors?.length) {
            errors.style.display = "";
            errors.replaceChildren(...p.errors.map((item) => el("div", null, `${item.name} — ${item.error}`)));
        } else {
            errors.style.display = "none";
        }

        if ((p.updated ?? 0) > 0) changed = true;
    }

    async function refresh() {
        const status = await civitaiStatus();
        paint(status);
        clearTimeout(timer);
        // 도는 동안에만 자주 물어본다. 끝나면 조용히 둔다.
        if (status?.progress?.running) timer = setTimeout(refresh, POLL);
        return status;
    }

    async function start(overwrite) {
        const result = await post("/fla/civitai/scan", { overwrite, replace_preview: replace.checked });
        if (!result.data?.ok) {
            toast(result.data?.error ?? t("civitaiFetchFail"), true);
            return;
        }
        if ((result.data.progress?.total ?? 0) === 0) toast(t("civitaiNothing"));
        refresh();
    }

    scanMissing.onclick = () => start(false);
    scanAll.onclick = () => {
        if (!confirm(t("civitaiScanAllConfirm"))) return;
        start(true);
    };
    stop.onclick = async () => {
        stop.disabled = true;
        await post("/fla/civitai/cancel");
        refresh();
    };

    // 상태를 받기 전에는 둘 다 감춰 둔다(안내가 깜빡 보였다 사라지지 않게)
    guide.style.display = "none";
    scan.style.display = "none";
    refresh();
}
