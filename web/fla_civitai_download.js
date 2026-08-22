/** 받기 진행 줄 — 모델 찾기와 업데이트 확인이 같이 쓴다.
 *
 *  받는 일은 서버가 한다(대기열도 서버에 있다). 여기서는 넣고 물어보고
 *  그릴 뿐이다. 그래서 창을 닫았다 열어도 받던 것은 계속 받아진다.
 */

import { t } from "./fla_i18n.js";
import { POLL, addCivitaiStyles, el, json, post, prettySize } from "./fla_civitai_util.js";

/** 진행 줄 하나를 만든다.
 *  onFinished 는 대기열이 다 비었고 하나라도 받아졌을 때 한 번 부른다. */
export function createDownloadBar(onFinished = null) {
    addCivitaiStyles();

    const root = el("div", "fla-cv-dlbar");
    const who = el("div", "who");
    const track = el("div", "fla-cv-bar");
    const fill = el("div");
    track.appendChild(fill);
    const pct = el("div", "pct");
    const stop = el("button", "fla-cv-btn stop", t("civitaiStop"));
    root.append(who, track, pct, stop);
    root.style.display = "none";

    let timer = null;
    // 한 번이라도 받았는지. 다 끝났을 때만 목록을 새로 읽으려고 본다.
    let saw = false;

    function paint(state) {
        const busy = state.running || state.queued > 0;
        root.style.display = busy || state.errors?.length ? "" : "none";
        if (!busy) {
            who.textContent = state.errors?.length
                ? `${state.errors[0].name} — ${state.errors[0].error}`
                : `${t("civitaiDone")} ${state.done}`;
            fill.style.width = "0%";
            pct.textContent = "";
            stop.style.display = "none";
            return;
        }
        stop.style.display = "";
        const current = state.current;
        const queued = state.queued ? `  (+${state.queued})` : "";
        who.textContent = current
            ? `${current.title || current.file_name}  ·  ${current.folder}${queued}`
            : t("civitaiPreparing") + queued;
        if (state.total > 0) {
            const percent = Math.round((state.received / state.total) * 100);
            fill.style.width = `${percent}%`;
            pct.textContent = `${percent}%  ·  ${prettySize(state.received)} / ${prettySize(state.total)}`;
        } else {
            fill.style.width = "0%";
            pct.textContent = prettySize(state.received);
        }
    }

    async function watch() {
        clearTimeout(timer);
        let state;
        try {
            const { data } = await json("/fla/civitai/download-status");
            state = data?.download;
        } catch (e) {
            return;
        }
        if (!state) return;
        paint(state);
        if (state.done > 0) saw = true;
        if (state.running || state.queued > 0) {
            timer = setTimeout(watch, POLL);
        } else if (saw) {
            saw = false;
            await onFinished?.(state);
        }
    }

    stop.onclick = async () => {
        stop.disabled = true;
        try {
            await post("/fla/civitai/download-cancel");
        } finally {
            stop.disabled = false;
        }
        watch();
    };

    return {
        root,
        watch,
        /** 대기열에 하나 넣는다. 성공하면 참. */
        async send({ version_id, folder, title }) {
            const { data } = await post("/fla/civitai/download", {
                version_id, folder: folder ?? "", title: title ?? "",
            });
            if (!data?.ok) return false;
            watch();
            return true;
        },
        dispose() { clearTimeout(timer); },
    };
}
