/** 하위 모델 정리 — 새 버전을 이미 받아 둔 옛 파일을 찾아 지운다.
 *
 *  업데이트 확인의 거울상이다. 그쪽은 "밖에 더 새 것이 있나" 를 묻고,
 *  이쪽은 "안에 이미 더 새 것이 있나" 를 묻는다. 가진 것끼리만 견주므로
 *  Civitai 를 부르지 않고 누르면 바로 끝난다.
 *
 *  업데이트 확인 화면(fla_civitai_updates.js)이 이 칸을 자기 자리에 끼워 쓴다.
 *  지우는 일은 되돌릴 수 없으므로 하나씩이든 한꺼번에든 반드시 한 번 더 묻는다.
 */

import { t } from "./fla_i18n.js";
import { addCivitaiStyles, el, json, post, prettySize, toast } from "./fla_civitai_util.js";

/** 정리 칸을 만든다.
 *
 *  detail    — 오른쪽 모델 상세 칸(모델 정보 단추가 쓴다)
 *  onChanged — 파일을 지웠을 때(로라 목록을 다시 읽어야 한다)
 *  onCount   — 찾은 개수가 바뀔 때(탭 이름에 숫자를 붙이려고)
 */
export function buildOlderView({ detail = null, onChanged = null, onCount = null } = {}) {
    addCivitaiStyles();

    // ---------------------------------------------- 왼쪽: 조작판
    const controls = el("div", "fla-cv-box");
    const head = el("div", "fla-cv-boxhead");
    head.append(el("span", null, t("civitaiOlder")));
    const body = el("div", "fla-cv-boxbody");
    controls.append(head, body);

    const check = el("button", "fla-cv-btn go", t("civitaiOlderCheck"));
    const found = el("div", "fla-cv-count");
    const free = el("div", "fla-cv-tally");
    body.append(found, check, free, el("div", "fla-cv-hint", t("civitaiOlderDesc")));

    // ---------------------------------------------- 오른쪽: 목록과 머리 단추
    const list = el("div", "fla-cv-list");
    const actions = el("div", "fla-cv-headacts");
    const dropAll = el("button", "fla-cv-btn sm", t("civitaiOlderDeleteAll"));
    const toggleKept = el("button", "fla-cv-link", t("civitaiUpdateShowIgnored"));
    actions.append(dropAll, toggleKept);

    // ---------------------------------------------- 상태
    let items = [];
    let freeBytes = 0;
    let showKept = false;
    let loaded = false;
    let picked = null;   // 오른쪽에 펴 놓은 파일

    const live = () => items.filter((item) => !item.ignored);
    const visible = () => items.filter((item) => showKept || !item.ignored);

    // ---------------------------------------------- 카드
    function thumb(item) {
        const box = el("div", "fla-cv-upshot");
        const img = el("img");
        img.src = `/fla/lora-preview?name=${encodeURIComponent(item.name)}`;
        img.loading = "lazy";
        // 대표 이미지가 없는 로라도 많다. 없으면 글자만 남긴다.
        img.onerror = () => { img.remove(); box.append("LoRA"); };
        box.appendChild(img);
        return box;
    }

    function card(item) {
        const node = el("div",
            `fla-cv-up old${item.ignored ? " off" : ""}${picked === item.key ? " on" : ""}`);
        node.onclick = (event) => { if (!event.target.closest("button, a")) open(item); };
        node.appendChild(thumb(item));

        const main = el("div");
        main.appendChild(el("div", "fla-cv-upname", item.file_name));
        main.appendChild(el("div", "fla-cv-upfile",
            [item.title, item.version_name].filter(Boolean).join("  ·  ")));

        const newest = (item.newer ?? [])[0] ?? {};
        const jump = el("div", "fla-cv-jump");
        jump.appendChild(el("span", "fla-cv-verold", item.version_name || item.file_name));
        jump.appendChild(el("span", "fla-cv-to", "→"));
        jump.appendChild(el("span", "fla-cv-vernew", newest.version_name || newest.file_name || "?"));
        if (newest.from_ver || newest.to_ver) {
            jump.appendChild(el("span", "fla-cv-hint",
                `${newest.from_ver || "-"} → ${newest.to_ver || "-"}`));
        }
        main.appendChild(jump);

        const meta = el("div", "fla-cv-upmeta");
        const add = (text) => { if (text) meta.appendChild(el("span", null, text)); };
        add(item.folder || "/");
        add(prettySize(item.size));
        add(item.base_model);
        main.appendChild(meta);

        // 무엇에 밀렸는지 — 새 파일이 어디에 있는지까지 보여준다
        for (const newer of item.newer ?? []) {
            const line = el("div", "fla-cv-hint");
            line.append(el("b", null, `${t("civitaiOlderNewer")}: `),
                document.createTextNode(`${newer.folder ? `${newer.folder}/` : ""}${newer.file_name}`));
            main.appendChild(line);
        }

        const acts = el("div", "fla-cv-upacts");
        const drop = el("button", "fla-cv-btn stop sm", `🗑 ${t("civitaiOlderDelete")}`);
        drop.onclick = () => removeOne(item, drop);
        acts.appendChild(drop);

        const info = el("button", "fla-cv-btn sm", t("civitaiOlderDetail"));
        info.disabled = !item.model_id || !detail;
        info.onclick = () => open(item);
        acts.appendChild(info);

        const keep = el("button", "fla-cv-link",
            t(item.ignored ? "civitaiOlderUnkeep" : "civitaiOlderKeep"));
        keep.onclick = async () => {
            keep.disabled = true;
            const { data } = await post("/fla/civitai/older/keep",
                { key: item.key, keep: !item.ignored });
            keep.disabled = false;
            if (!data?.ok) return;
            item.ignored = !item.ignored;
            recount();
            render();
        };
        acts.appendChild(keep);
        main.appendChild(acts);

        node.appendChild(main);
        return node;
    }

    /** 오른쪽 상세 칸에 이 파일의 모델을 편다. */
    function open(item) {
        if (!detail || !item.model_id) return;
        picked = item.key;
        detail.show(item.model_id, { versionId: item.version_id, folder: item.folder || "" });
        render();
    }

    // ---------------------------------------------- 지우기
    async function removeOne(item, button = null) {
        if (!confirm(t("versionDeleteConfirm", item.file_name))) return false;
        return drop(item, button);
    }

    /** 묻지 않고 하나 지운다. 물어보는 일은 부르는 쪽이 한다. */
    async function drop(item, button = null) {
        if (button) button.disabled = true;
        let data;
        try {
            ({ data } = await post("/fla/lora-delete", { name: item.name }));
        } catch (e) {
            data = null;
        }
        if (!data?.ok) {
            if (button) button.disabled = false;
            toast(t("versionDeleteFail") + (data?.error ?? ""), true);
            return false;
        }
        items = items.filter((other) => other !== item);
        // 지운 파일을 새 것으로 달고 있던 줄에서도 빼 준다
        for (const other of items) {
            other.newer = (other.newer ?? []).filter((n) => n.name !== item.name);
        }
        items = items.filter((other) => (other.newer ?? []).length > 0);
        if (picked === item.key) { picked = null; detail?.clear(); }
        recount();
        render();
        await onChanged?.();
        return true;
    }

    dropAll.onclick = async () => {
        const targets = live();
        if (!targets.length) return;
        const size = prettySize(targets.reduce((sum, item) => sum + (item.size ?? 0), 0));
        if (!confirm(t("civitaiOlderDeleteAllConfirm")
            .replace("{n}", targets.length).replace("{size}", size))) return;
        dropAll.disabled = true;
        let done = 0;
        for (const item of targets) {
            if (await drop(item)) done += 1;
        }
        dropAll.disabled = false;
        toast(t("civitaiOlderDeletedAll").replace("{n}", done));
    };

    toggleKept.onclick = () => { showKept = !showKept; render(); };

    // ---------------------------------------------- 그리기
    function recount() {
        freeBytes = live().reduce((sum, item) => sum + (item.size ?? 0), 0);
        found.replaceChildren(document.createTextNode(`${t("civitaiOlderFound")}: `),
            el("b", null, String(live().length)));
        free.textContent = live().length
            ? `${t("civitaiOlderFree")}: ${prettySize(freeBytes)}`
            : "";
        onCount?.(live().length);
    }

    function render() {
        const shown = visible();
        const hidden = items.filter((item) => item.ignored).length;

        dropAll.style.display = live().length ? "" : "none";
        dropAll.textContent = `🗑 ${t("civitaiOlderDeleteAll")} (${live().length})`;
        toggleKept.style.display = hidden ? "" : "none";
        toggleKept.textContent = showKept
            ? t("civitaiUpdateHideIgnored")
            : t("civitaiUpdateShowIgnored").replace("{n}", hidden);

        list.replaceChildren();
        if (!shown.length) {
            list.appendChild(el("div", "fla-cv-empty",
                loaded ? t("civitaiOlderNone") : t("civitaiOlderEmptyHint")));
            return;
        }
        for (const item of shown) list.appendChild(card(item));
    }

    /** 목록을 다시 읽는다. 서버가 가진 것끼리만 견주므로 곧바로 온다. */
    async function refresh() {
        check.disabled = true;
        let data;
        try {
            ({ data } = await json("/fla/civitai/older"));
        } catch (e) {
            data = null;
        }
        check.disabled = false;
        if (!data?.ok) {
            toast(t("civitaiOlderFail"), true);
            return;
        }
        items = data.items ?? [];
        loaded = true;
        picked = null;
        recount();
        render();
    }

    check.onclick = refresh;
    recount();
    render();

    return {
        controls,
        list,
        actions,
        refresh,
        /** 아직 한 번도 안 읽었으면 읽는다(탭을 처음 열 때). */
        async activate() { if (!loaded) await refresh(); },
        count: () => live().length,
    };
}
