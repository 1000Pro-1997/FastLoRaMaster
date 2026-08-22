/** Civitai 에서 로라를 찾아 받는 화면.
 *
 *  검색은 서버가 대신 부른다(브라우저에서 부르면 교차 출처에 걸리고 API 키도
 *  드러난다). 받는 것도 서버가 한다 — 받자마자 정보와 대표 이미지를 옆에
 *  놓고, 태그를 보고 이미 쓰고 있는 폴더로 넣는다.
 */

import { t } from "./fla_i18n.js";
import { ADULT_LEVEL, POLL, addCivitaiStyles, el, json, post, prettySize, toast } from "./fla_civitai_util.js";

const SORTS = ["Most Downloaded", "Highest Rated", "Newest", "Most Liked"];
const PERIODS = ["AllTime", "Year", "Month", "Week", "Day"];
// 자주 쓰는 것만. 이 목록에 없는 기반 모델도 검색 결과에는 그대로 나온다.
const BASE_MODELS = ["SDXL 1.0", "Pony", "Illustrious", "NoobAI", "SD 1.5", "Flux.1 D",
    "Wan Video 14B t2v", "LTXV"];

/** 모델 찾기 화면을 만든다.
 *  onInstalled 는 하나라도 받아졌을 때 부른다(로라 목록을 다시 읽어야 한다). */
export function buildBrowseView(onInstalled = null) {
    addCivitaiStyles();

    const root = el("div", "fla-cv-page");

    // ---------------------------------------------- 검색줄
    const searchBar = el("div", "fla-cv-search");
    const query = el("input");
    query.type = "search";
    query.placeholder = t("civitaiSearchPlaceholder");

    const sort = el("select");
    for (const value of SORTS) sort.appendChild(new Option(t(`civitaiSort_${value.replace(/\s/g, "")}`), value));
    const period = el("select");
    for (const value of PERIODS) period.appendChild(new Option(t(`civitaiPeriod_${value}`), value));
    const base = el("select");
    base.appendChild(new Option(t("civitaiAnyBase"), ""));
    for (const value of BASE_MODELS) base.appendChild(new Option(value, value));
    const nsfw = el("select");
    nsfw.appendChild(new Option(t("civitaiNsfwAll"), ""));
    nsfw.appendChild(new Option(t("civitaiNsfwHide"), "false"));
    nsfw.appendChild(new Option(t("civitaiNsfwOnly"), "true"));

    const go = el("button", "fla-cv-btn go", t("civitaiSearch"));
    searchBar.append(query, sort, period, base, nsfw, go);

    // ---------------------------------------------- 결과와 상세
    const results = el("div", "fla-cv-results");
    const grid = el("div", "fla-cv-grid");
    const detail = el("div", "fla-cv-detail");
    detail.style.display = "none";
    results.append(grid, detail);

    // ---------------------------------------------- 내려받기 줄
    const dlBar = el("div", "fla-cv-dlbar");
    const dlWho = el("div", "who");
    const dlBarTrack = el("div", "fla-cv-bar");
    const dlFill = el("div");
    dlBarTrack.appendChild(dlFill);
    const dlPct = el("div", "pct");
    const dlStop = el("button", "fla-cv-btn stop", t("civitaiStop"));
    dlBar.append(dlWho, dlBarTrack, dlPct, dlStop);
    dlBar.style.display = "none";

    root.append(searchBar, results, dlBar);

    // ---------------------------------------------- 상태
    let items = [];
    let cursor = "";
    let loading = false;
    let picked = null;         // 지금 상세를 보고 있는 모델
    let folders = [];
    let dlTimer = null;
    let sawDownload = false;   // 한 번이라도 받았는지(목록 새로고침 여부)
    // "보기" 로 연 성인 카드. 검색을 새로 하면 도로 가린다.
    const revealed = new Set();

    async function loadFolders() {
        try {
            const { data } = await json("/fla/civitai/folders");
            folders = data?.folders ?? [];
        } catch (e) {
            folders = [];
        }
    }

    // ---------------------------------------------- 검색
    async function search(more = false) {
        if (loading) return;
        loading = true;
        go.disabled = true;
        try {
            const params = new URLSearchParams({ types: "LORA" });
            if (query.value.trim()) params.set("query", query.value.trim());
            params.set("sort", sort.value);
            params.set("period", period.value);
            if (base.value) params.set("baseModels", base.value);
            if (nsfw.value) params.set("nsfw", nsfw.value);
            if (more && cursor) params.set("cursor", cursor);

            const { data } = await json(`/fla/civitai/search?${params}`);
            if (!data?.ok) {
                toast(data?.error ?? t("civitaiSearchFail"), true);
                return;
            }
            if (!more) { items = []; revealed.clear(); pick(null); }
            items = items.concat(data.items ?? []);
            cursor = data.next_cursor ?? "";
            render();
        } catch (e) {
            toast(t("civitaiSearchFail"), true);
        } finally {
            loading = false;
            go.disabled = false;
        }
    }

    function render() {
        grid.replaceChildren();
        if (!items.length) {
            grid.appendChild(el("div", "fla-cv-empty", t("civitaiNoResults")));
            return;
        }
        for (const model of items) grid.appendChild(card(model));
        if (cursor) {
            const more = el("div", "fla-cv-more");
            const button = el("button", "fla-cv-btn", t("civitaiMore"));
            button.onclick = () => { button.disabled = true; search(true); };
            more.appendChild(button);
            grid.appendChild(more);
        }
    }

    function firstImage(model) {
        for (const version of model.versions ?? []) {
            if (version.images?.length) return version.images[0];
        }
        return null;
    }

    function card(model) {
        const node = el("div", "fla-cv-card");
        node.classList.toggle("on", picked?.id === model.id);
        node.onclick = () => pick(model, node);

        const shot = el("div", "fla-cv-shot");
        const image = firstImage(model);
        if (image) {
            const img = el("img");
            img.src = image.url;
            img.loading = "lazy";
            img.onerror = () => img.remove();
            // 카드 그림은 모델 등급으로 가린다. "보기" 를 누른 것만 풀어준다.
            const hide = (model.nsfw || (image.nsfw_level ?? 0) >= ADULT_LEVEL) && !revealed.has(model.id);
            if (hide) {
                img.classList.add("fla-cv-blur");
                const veil = el("div", "fla-cv-veil");
                const show = el("button", null, t("adultShow"));
                show.onclick = (event) => {
                    event.stopPropagation();
                    revealed.add(model.id);
                    img.classList.remove("fla-cv-blur");
                    veil.remove();
                };
                veil.appendChild(show);
                shot.appendChild(veil);
            }
            shot.appendChild(img);
        } else {
            shot.append("LoRA");
        }
        shot.appendChild(el("div", "fla-cv-shade"));
        shot.appendChild(el("div", "fla-cv-cardtitle", model.name));

        const foot = el("div", "fla-cv-cardfoot");
        const version = (model.versions ?? [])[0];
        if (version?.base_model) foot.appendChild(el("div", "fla-cv-chip", version.base_model));
        if (typeof model.downloads === "number") {
            foot.appendChild(el("div", "fla-cv-chip", `↓ ${model.downloads.toLocaleString()}`));
        }
        if (model.installed) foot.appendChild(el("div", "fla-cv-chip have", t("civitaiHave")));
        shot.appendChild(foot);

        node.appendChild(shot);
        return node;
    }

    // ---------------------------------------------- 상세와 받기
    function pick(model, node = null) {
        picked = model;
        for (const other of grid.querySelectorAll(".fla-cv-card")) other.classList.remove("on");
        if (!model) { detail.style.display = "none"; detail.replaceChildren(); return; }
        node?.classList.add("on");
        detail.style.display = "";
        renderDetail(model);
    }

    function renderDetail(model) {
        detail.replaceChildren();
        detail.appendChild(el("h3", null, model.name));
        const by = [model.creator && `@${model.creator}`, model.type].filter(Boolean).join("  ·  ");
        detail.appendChild(el("div", "by", by));

        // 버전 고르기
        const versionField = el("div", "fla-cv-field");
        versionField.appendChild(el("label", null, t("tabVersion")));
        const versionSelect = el("select");
        (model.versions ?? []).forEach((version, index) => {
            const size = version.size_kb ? `  ·  ${prettySize(version.size_kb * 1024)}` : "";
            const have = version.installed ? `  ·  ${t("civitaiHave")}` : "";
            versionSelect.appendChild(new Option(
                `${version.name || "?"}  ·  ${version.base_model || "?"}${size}${have}`, String(index)));
        });
        versionField.appendChild(versionSelect);
        detail.appendChild(versionField);

        // 저장 폴더 — 태그를 보고 미리 골라두고, 직접 고치거나 새로 적을 수 있다
        const folderField = el("div", "fla-cv-field");
        folderField.appendChild(el("label", null, t("civitaiFolder")));
        const folderInput = el("input");
        folderInput.setAttribute("list", "fla-cv-folders");
        folderInput.placeholder = t("civitaiFolderRoot");
        folderField.appendChild(folderInput);
        const list = el("datalist");
        list.id = "fla-cv-folders";
        for (const folder of folders) list.appendChild(new Option(folder, folder));
        folderField.appendChild(list);
        detail.appendChild(folderField);

        const meta = el("div", "fla-cv-meta");
        detail.appendChild(meta);

        const tags = el("div", "fla-cv-tags");
        for (const tag of (model.tags ?? []).slice(0, 12)) tags.appendChild(el("div", "fla-cv-tag", tag));
        detail.appendChild(tags);

        const grab = el("button", "fla-cv-btn go", t("civitaiDownload"));
        grab.style.width = "100%";
        detail.appendChild(grab);

        const open = el("a", "fla-cv-link");
        open.href = `https://civitai.com/models/${model.id}`;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = t("detailOpenCivitai");
        open.style.cssText = "display:inline-block;margin-top:10px";
        detail.appendChild(open);

        const gallery = el("div", "fla-cv-gallery");
        detail.appendChild(gallery);

        const syncVersion = () => {
            const version = (model.versions ?? [])[Number(versionSelect.value)] ?? {};
            folderInput.value = version.folder ?? "";

            meta.replaceChildren();
            const line = (label, value) => {
                if (!value) return;
                const row = el("div");
                row.append(el("b", null, `${label}  `), document.createTextNode(String(value)));
                meta.appendChild(row);
            };
            line(t("detailFile"), version.file_name);
            line(t("detailSize"), version.size_kb ? prettySize(version.size_kb * 1024) : "");
            line(t("detailTrained"), (version.trained_words ?? []).join(", "));
            if (version.installed) meta.appendChild(el("div", null, `✓ ${t("civitaiHaveLong")}`));

            grab.disabled = !version.downloadable;
            grab.textContent = version.installed ? t("civitaiDownloadAgain") : t("civitaiDownload");

            gallery.replaceChildren();
            for (const image of (version.images ?? []).slice(0, 4)) {
                const box = el("div");
                const img = el("img");
                img.src = image.url;
                img.loading = "lazy";
                img.onerror = () => box.remove();
                if ((image.nsfw_level ?? 0) >= ADULT_LEVEL && !revealed.has(model.id)) {
                    img.classList.add("fla-cv-blur");
                }
                box.appendChild(img);
                gallery.appendChild(box);
            }
        };
        versionSelect.onchange = syncVersion;
        syncVersion();

        grab.onclick = async () => {
            const version = (model.versions ?? [])[Number(versionSelect.value)];
            if (!version) return;
            grab.disabled = true;
            try {
                const { data } = await post("/fla/civitai/download", {
                    version_id: version.id,
                    folder: folderInput.value.trim(),
                    title: model.name,
                });
                if (!data?.ok) { toast(data?.error ?? t("civitaiDownloadFail"), true); return; }
                toast(t("civitaiQueued"));
                watchDownloads();
            } finally {
                grab.disabled = false;
            }
        };
    }

    // ---------------------------------------------- 내려받기 진행
    function paintDownload(state) {
        const busy = state.running || state.queued > 0;
        dlBar.style.display = busy || state.errors?.length ? "" : "none";
        if (!busy) {
            dlWho.textContent = state.errors?.length
                ? `${state.errors[0].name} — ${state.errors[0].error}`
                : `${t("civitaiDone")} ${state.done}`;
            dlFill.style.width = "0%";
            dlPct.textContent = "";
            dlStop.style.display = "none";
            return;
        }
        dlStop.style.display = "";
        const current = state.current;
        const queued = state.queued ? `  (+${state.queued})` : "";
        dlWho.textContent = current
            ? `${current.title || current.file_name}  ·  ${current.folder}${queued}`
            : t("civitaiPreparing") + queued;
        if (state.total > 0) {
            const percent = Math.round((state.received / state.total) * 100);
            dlFill.style.width = `${percent}%`;
            dlPct.textContent = `${percent}%  ·  ${prettySize(state.received)} / ${prettySize(state.total)}`;
        } else {
            dlFill.style.width = "0%";
            dlPct.textContent = prettySize(state.received);
        }
    }

    async function watchDownloads() {
        clearTimeout(dlTimer);
        let state;
        try {
            const { data } = await json("/fla/civitai/download-status");
            state = data?.download;
        } catch (e) {
            return;
        }
        if (!state) return;
        paintDownload(state);
        if (state.done > 0) sawDownload = true;
        if (state.running || state.queued > 0) {
            dlTimer = setTimeout(watchDownloads, POLL);
        } else if (sawDownload) {
            // 새로 받은 파일이 목록과 "있음" 표시에 반영되게 한 번만 새로 읽는다
            sawDownload = false;
            onInstalled?.();
            await loadFolders();
            for (const model of items) {
                for (const version of model.versions ?? []) {
                    if (version.id === state.current?.version_id) version.installed = true;
                }
            }
            if (picked) renderDetail(picked);
        }
    }

    dlStop.onclick = async () => {
        dlStop.disabled = true;
        try {
            await post("/fla/civitai/download-cancel");
        } finally {
            dlStop.disabled = false;
        }
        watchDownloads();
    };

    go.onclick = () => search(false);
    query.addEventListener("keydown", (event) => { if (event.key === "Enter") search(false); });
    for (const control of [sort, period, base, nsfw]) control.onchange = () => search(false);

    let started = false;
    return {
        root,
        /** 탭을 처음 열 때 한 번만 검색한다. */
        async activate() {
            await loadFolders();
            watchDownloads();
            if (started) return;
            started = true;
            search(false);
        },
        dispose() {
            clearTimeout(dlTimer);
        },
    };
}
