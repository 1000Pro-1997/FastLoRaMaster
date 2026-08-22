/** 업데이트 확인 — 가진 로라의 새 버전을 찾아 보여준다.
 *
 *  왼쪽 칸에 넣을 조작판(controls)과 오른쪽 칸에 넣을 결과판(pane)을 따로
 *  돌려준다. 창을 어떻게 나눌지는 부르는 쪽(fla_civitai.js)이 정한다.
 *
 *  무엇이 업글인지는 서버가 정한다(이름의 글자는 같고 숫자만 오른 것).
 *  하이노이즈·로우노이즈 짝은 업글이 아니므로 여기 나오지 않는다.
 */

import { t } from "./fla_i18n.js";
import {
    ADULT_LEVEL, POLL, addCivitaiStyles, el, json, post, prettySize, toast,
} from "./fla_civitai_util.js";
import { createDownloadBar } from "./fla_civitai_download.js";
import { createModelDetail, loadFolders, markInstalled } from "./fla_civitai_detail.js";
import { buildOlderView } from "./fla_civitai_older.js";

/** ISO 날짜를 YYYY-MM-DD 로. 못 읽으면 그대로 둔다. */
function prettyDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return isNaN(date) ? String(iso) : date.toISOString().slice(0, 10);
}

/** 초 단위 시각을 사람이 읽는 글자로. */
function prettyWhen(stamp) {
    if (!stamp) return "";
    const date = new Date(stamp * 1000);
    return isNaN(date) ? "" : date.toLocaleString();
}

/** onChanged 는 로라 목록이 바뀌었을 때(새 버전을 받았을 때) 부른다. */
export function buildUpdatesView(onChanged = null) {
    addCivitaiStyles();

    // ---------------------------------------------- 왼쪽: 조작판
    const controls = el("div", "fla-cv-box");
    const controlsHead = el("div", "fla-cv-boxhead");
    controlsHead.append(el("span", null, t("civitaiUpdates")));
    const controlsBody = el("div", "fla-cv-boxbody");
    controls.append(controlsHead, controlsBody);

    const targets = el("div", "fla-cv-count");
    const deepRow = el("label", "fla-cv-check");
    const deep = el("input");
    deep.type = "checkbox";
    deep.checked = true;
    deepRow.append(deep, el("span", null, t("civitaiUpdateDeep")));

    const buttons = el("div", "fla-cv-row");
    buttons.style.marginTop = "10px";
    const check = el("button", "fla-cv-btn go", t("civitaiUpdateCheck"));
    const stop = el("button", "fla-cv-btn stop", t("civitaiStop"));
    stop.style.display = "none";
    buttons.append(check, stop);

    const bar = el("div", "fla-cv-bar");
    const fill = el("div");
    bar.appendChild(fill);
    bar.style.display = "none";
    const now = el("div", "fla-cv-now");
    const tally = el("div", "fla-cv-tally");
    const last = el("div", "fla-cv-tally");
    const errors = el("div", "fla-cv-errors");
    errors.style.display = "none";
    const note = el("div", "fla-cv-hint", t("civitaiUpdateVariantNote"));

    controlsBody.append(targets, deepRow, buttons, bar, now, tally, last, errors, note);

    // ---------------------------------------------- 상태
    let items = [];
    let checkedAt = 0;
    let showIgnored = false;
    let timer = null;
    // 오른쪽 상세 칸에 펴 놓은 카드(item.key)
    let picked = null;
    let loaded = false;
    // 이번에 받기 눌러 둔 것. 카드에 "받는 중" 을 그리는 데 쓴다.
    const queued = new Set();
    // 가림을 푼 카드
    const revealed = new Set();

    // ---------------------------------------------- 오른쪽: 결과판
    //
    // 한 칸에 두 목록이 번갈아 산다 — 밖에 새 버전이 있나(업데이트), 안에 이미
    // 새 버전이 있나(하위 모델). 오른쪽 모델 상세 칸은 둘이 같이 쓴다.
    const pane = el("div", "fla-cv-pane");
    const paneHead = el("div", "fla-cv-panehead");
    const seg = el("div", "fla-cv-seg");
    const segUpdates = el("button", "on", t("civitaiUpdates"));
    const segOlder = el("button", null, t("civitaiOlder"));
    seg.append(segUpdates, segOlder);

    const updateActions = el("div", "fla-cv-headacts");
    const grabAll = el("button", "fla-cv-btn go sm", t("civitaiUpdateGetAll"));
    const toggleIgnored = el("button", "fla-cv-link", t("civitaiUpdateShowIgnored"));
    const clear = el("button", "fla-cv-link", t("civitaiUpdateClear"));
    updateActions.append(grabAll, toggleIgnored, clear);

    const results = el("div", "fla-cv-results");
    const list = el("div", "fla-cv-list");
    const detail = createModelDetail({
        revealed,
        onQueued: (model, version) => {
            const item = items.find((i) => i.latest?.id === version.id);
            if (item) queued.add(item.key);
            downloads.watch();
            render();
        },
        onClose: () => pickItem(null),
    });

    // 하위 모델 정리 — 조작판은 왼쪽 칸에, 목록은 이 칸에 끼워 쓴다.
    // 개수는 따로 받아 둔다(정리 칸이 만들어지는 도중에도 알려 오므로).
    let olderCount = 0;
    const older = buildOlderView({
        detail,
        onChanged: () => onChanged?.(),
        onCount: (n) => { olderCount = n; paintSegments(); },
    });
    results.append(list, older.list, detail.root);
    paneHead.append(seg, updateActions, older.actions);

    const downloads = createDownloadBar(async () => {
        // 받은 것은 다음 확인 때 목록에서 빠진다. 지금은 표시만 바꾼다.
        await loadFolders(true);
        for (const item of items) {
            if (queued.has(item.key) && item.latest?.id) markInstalled(item.latest.id);
        }
        detail.refresh();
        render();
        await onChanged?.();
    });
    pane.append(paneHead, results, downloads.root);

    /** 탭 이름에 찾은 개수를 붙인다. */
    function paintSegments() {
        const updates = items.filter((item) => showIgnored || !item.ignored).length;
        segUpdates.textContent = updates
            ? `${t("civitaiUpdates")} (${updates})` : t("civitaiUpdates");
        segOlder.textContent = olderCount
            ? `${t("civitaiOlder")} (${olderCount})` : t("civitaiOlder");
    }

    /** 두 목록 중 하나만 보여준다. */
    function showSection(name) {
        const updates = name !== "older";
        segUpdates.classList.toggle("on", updates);
        segOlder.classList.toggle("on", !updates);
        list.style.display = updates ? "" : "none";
        older.list.style.display = updates ? "none" : "";
        updateActions.style.display = updates ? "" : "none";
        older.actions.style.display = updates ? "none" : "";
        // 상세 칸은 둘이 같이 쓴다. 옮길 때는 접는다.
        pickItem(null);
        detail.clear();
        if (!updates) older.activate();
    }

    segUpdates.onclick = () => showSection("updates");
    segOlder.onclick = () => showSection("older");
    showSection("updates");

    function visible() {
        return items.filter((item) => showIgnored || !item.ignored);
    }

    // ---------------------------------------------- 카드
    function thumb(item) {
        const box = el("div", "fla-cv-upshot");
        const shot = (item.latest?.images ?? [])[0];
        if (!shot) {
            box.append("LoRA");
            return box;
        }
        const isVideo = shot.type === "video" || /\.(mp4|webm)(\?|$)/i.test(shot.url);
        const media = el(isVideo ? "video" : "img");
        media.src = shot.url;
        if (isVideo) {
            media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true;
        } else {
            media.loading = "lazy";
            media.onerror = () => media.remove();
        }
        if ((shot.nsfw_level ?? 0) >= ADULT_LEVEL && !revealed.has(item.key)) {
            media.classList.add("fla-cv-blur");
            box.title = t("adultShow");
            // 가림만 풀고, 카드를 고르는 일까지 하지는 않는다
            box.onclick = (event) => { event.stopPropagation(); revealed.add(item.key); render(); };
        }
        box.appendChild(media);
        return box;
    }

    /** 상자를 누르면 오른쪽에 그 모델을 편다. null 이면 칸을 닫는다. */
    function pickItem(item) {
        picked = item?.key ?? null;
        if (!item) { detail.clear(); render(); return; }
        const latest = item.latest ?? {};
        // 저장 폴더는 옛 파일이 있는 곳으로 맞춰 둔다
        detail.show(latest.model_id, { versionId: latest.id, folder: item.folder || "" });
        render();
    }

    function card(item) {
        const latest = item.latest ?? {};
        const node = el("div",
            `fla-cv-up${item.ignored ? " off" : ""}${picked === item.key ? " on" : ""}`);
        // 단추·링크를 누른 것이면 그 일만 하고, 빈 곳을 누르면 상세를 편다
        node.onclick = (event) => { if (!event.target.closest("button, a")) pickItem(item); };
        node.appendChild(thumb(item));

        const body = el("div");
        body.appendChild(el("div", "fla-cv-upname", latest.model_name || item.title));
        body.appendChild(el("div", "fla-cv-upfile",
            `${item.file_name}${item.folder ? `  ·  ${item.folder}` : ""}`));

        // 무엇이 어떻게 올랐는지 — 같은 글이면 버전 이름끼리, 다른 글이면 모델 이름끼리
        const acrossPages = latest.kind === "model";
        const jump = el("div", "fla-cv-jump");
        jump.appendChild(el("span", "fla-cv-verold",
            (acrossPages ? item.title : item.current?.version_name)
            || item.current?.version_name || "?"));
        jump.appendChild(el("span", "fla-cv-to", "→"));
        jump.appendChild(el("span", "fla-cv-vernew",
            (acrossPages ? latest.model_name : latest.name) || latest.name || "?"));
        if (latest.from_ver || latest.to_ver) {
            jump.appendChild(el("span", "fla-cv-hint",
                `${latest.from_ver || "-"} → ${latest.to_ver || "-"}`));
        }
        jump.appendChild(el("span", "fla-cv-badge",
            t(latest.kind === "model" ? "civitaiUpdateKindModel" : "civitaiUpdateKindVersion")));
        body.appendChild(jump);

        const meta = el("div", "fla-cv-upmeta");
        const add = (text) => { if (text) meta.appendChild(el("span", null, text)); };
        add(latest.base_model);
        add(prettyDate(latest.published));
        add(latest.size_kb ? prettySize(latest.size_kb * 1024) : "");
        if (typeof latest.downloads === "number") add(`↓ ${latest.downloads.toLocaleString()}`);
        add(latest.file_name);
        body.appendChild(meta);

        const acts = el("div", "fla-cv-upacts");
        const grab = el("button", "fla-cv-btn go sm");
        const done = queued.has(item.key);
        grab.textContent = done ? `✓ ${t("civitaiUpdateDone")}` : `⬇ ${t("civitaiUpdateGet")}`;
        grab.disabled = done || !latest.downloadable;
        grab.onclick = () => grabOne(item, grab);
        acts.appendChild(grab);

        const open = el("a", "fla-cv-btn sm");
        open.href = `https://civitai.com/models/${latest.model_id}?modelVersionId=${latest.id}`;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = t("civitaiUpdateOpen");
        open.style.lineHeight = "26px";
        acts.appendChild(open);

        const ignore = el("button", "fla-cv-link",
            t(item.ignored ? "civitaiUpdateUnignore" : "civitaiUpdateIgnore"));
        ignore.onclick = async () => {
            ignore.disabled = true;
            const { data } = await post("/fla/civitai/updates/ignore",
                { key: item.key, ignore: !item.ignored });
            ignore.disabled = false;
            if (!data?.ok) return;
            item.ignored = !item.ignored;
            render();
        };
        acts.appendChild(ignore);
        acts.appendChild(el("span", "fla-cv-hint", t("civitaiUpdateSame")));
        body.appendChild(acts);

        if (item.others?.length) {
            body.appendChild(el("div", "fla-cv-hint",
                t("civitaiUpdateOthers").replace("{n}", item.others.length) + " — "
                + item.others.map((o) => `${o.name || o.version_name} ${o.to_ver}`).join(", ")));
        }

        node.appendChild(body);
        return node;
    }

    async function grabOne(item, button) {
        if (button) button.disabled = true;
        const latest = item.latest ?? {};
        const ok = await downloads.send({
            version_id: latest.id,
            // 새 버전은 옛 파일과 같은 폴더에 둔다(찾기 쉽게)
            folder: item.folder || "",
            title: latest.model_name || item.title,
        });
        if (!ok) {
            toast(t("civitaiDownloadFail"), true);
            if (button) button.disabled = false;
            return false;
        }
        queued.add(item.key);
        render();
        return true;
    }

    grabAll.onclick = async () => {
        const targetItems = visible().filter((item) => !item.ignored
            && !queued.has(item.key) && item.latest?.downloadable);
        if (!targetItems.length) return;
        if (!confirm(t("civitaiUpdateGetAllConfirm").replace("{n}", targetItems.length))) return;
        grabAll.disabled = true;
        let sent = 0;
        for (const item of targetItems) {
            if (await grabOne(item, null)) sent += 1;
        }
        grabAll.disabled = false;
        toast(t("civitaiUpdateQueuedAll").replace("{n}", sent));
    };

    toggleIgnored.onclick = () => { showIgnored = !showIgnored; render(); };

    clear.onclick = async () => {
        const { data } = await post("/fla/civitai/updates/clear");
        if (!data?.ok) return;
        items = [];
        checkedAt = 0;
        queued.clear();
        render();
        paint(data);
    };

    // ---------------------------------------------- 그리기
    function render() {
        const shown = visible();
        const hidden = items.filter((item) => item.ignored).length;

        paintSegments();
        grabAll.style.display = shown.some((item) => !item.ignored) ? "" : "none";
        clear.style.display = items.length ? "" : "none";
        toggleIgnored.style.display = hidden ? "" : "none";
        toggleIgnored.textContent = showIgnored
            ? t("civitaiUpdateHideIgnored")
            : t("civitaiUpdateShowIgnored").replace("{n}", hidden);

        list.replaceChildren();
        if (!shown.length) {
            const empty = el("div", "fla-cv-empty");
            empty.append(el("div", null, checkedAt
                ? t("civitaiUpdateNone")
                : t("civitaiUpdateEmptyHint")));
            list.appendChild(empty);
            return;
        }
        for (const item of shown) list.appendChild(card(item));
    }

    function paint(state) {
        if (!state) return;
        const p = state.progress ?? {};
        const running = p.running === true;

        if (typeof state.candidates === "number") {
            targets.replaceChildren(
                document.createTextNode(`${t("civitaiUpdateTargets")}: `),
                el("b", null, String(state.candidates)));
        }
        check.disabled = running;
        deep.disabled = running;
        stop.style.display = running ? "" : "none";
        stop.disabled = p.cancelled === true;
        check.textContent = running ? t("civitaiUpdateChecking") : t("civitaiUpdateCheck");

        const total = p.total ?? 0;
        if (total > 0) {
            bar.style.display = "";
            fill.style.width = `${Math.round(((p.done ?? 0) / total) * 100)}%`;
            now.textContent = running
                ? `${p.done ?? 0} / ${total}  ·  ${p.current || ""}`
                : `${p.done ?? 0} / ${total}  ·  ${p.cancelled ? t("civitaiStopped") : t("civitaiFinished")}`;
            tally.textContent = `${t("civitaiUpdateFound")} ${p.found ?? 0}  ·  `
                + `${t("civitaiUpdateSkipped")} ${p.skipped ?? 0}  ·  ${t("civitaiFailed")} ${p.failed ?? 0}`;
        } else {
            bar.style.display = "none";
            now.textContent = "";
            tally.textContent = "";
        }

        if (state.checked_at !== undefined) checkedAt = state.checked_at;
        last.textContent = checkedAt
            ? `${t("civitaiUpdateLast")}: ${prettyWhen(checkedAt)}`
            : t("civitaiUpdateNever");

        if (p.errors?.length) {
            errors.style.display = "";
            errors.replaceChildren(...p.errors.map((item) => el("div", null, `${item.name} — ${item.error}`)));
        } else {
            errors.style.display = "none";
        }
    }

    /** 목록까지 새로 읽는다. 확인이 끝났을 때와 처음 열 때만 부른다. */
    async function reload() {
        let data;
        try {
            ({ data } = await json("/fla/civitai/updates"));
        } catch (e) {
            return null;
        }
        if (!data?.ok) return null;
        items = data.items ?? [];
        deep.checked = data.deep !== false;
        paint(data);
        render();
        return data;
    }

    /** 도는 동안에는 진행률만 자주 물어본다(목록은 무겁다). */
    async function follow() {
        clearTimeout(timer);
        let data;
        try {
            ({ data } = await json("/fla/civitai/updates/status"));
        } catch (e) {
            return;
        }
        if (!data?.ok) return;
        paint(data);
        if (data.progress?.running) {
            timer = setTimeout(follow, POLL);
        } else {
            await reload();
        }
    }

    check.onclick = async () => {
        check.disabled = true;
        let data;
        try {
            ({ data } = await post("/fla/civitai/updates/scan", { deep: deep.checked }));
        } catch (e) {
            data = null;
        }
        if (!data?.ok) {
            // 못 시작했으면 버튼을 도로 살린다(눌러도 아무 일 없는 상태를 남기지 않는다)
            toast(data?.error ?? t("civitaiUpdateFail"), true);
            check.disabled = false;
            return;
        }
        queued.clear();
        pickItem(null);
        paint(data);
        follow();
    };

    stop.onclick = async () => {
        stop.disabled = true;
        await post("/fla/civitai/updates/cancel");
        follow();
    };

    return {
        controls,
        /** 왼쪽 칸에 업데이트 상자 아래로 붙일 정리 상자. */
        cleanup: older.controls,
        pane,
        /** 탭을 열 때. 처음 한 번만 목록을 읽고, 도는 중이면 따라붙는다. */
        async activate() {
            downloads.watch();
            if (loaded) { follow(); return; }
            loaded = true;
            const data = await reload();
            if (data?.progress?.running) follow();
        },
        dispose() {
            clearTimeout(timer);
            downloads.dispose();
        },
    };
}
