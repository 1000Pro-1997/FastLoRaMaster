/** Civitai 에서 로라를 찾아 받는 화면.
 *
 *  검색은 서버가 대신 부른다(브라우저에서 부르면 교차 출처에 걸리고 API 키도
 *  드러난다). 받는 것도 서버가 한다 — 받자마자 정보와 대표 이미지를 옆에
 *  놓고, 태그를 보고 이미 쓰고 있는 폴더로 넣는다.
 */

import { t } from "./fla_i18n.js";
import {
    ADULT_LEVEL, POLL, addCivitaiStyles, copyValue, el, json, post, prettySize,
    renderDescription, toast,
} from "./fla_civitai_util.js";

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
    // 설명까지 받아온 모델. 같은 카드를 다시 눌러도 또 부르지 않는다.
    const full = new Map();
    let sawDownload = false;   // 한 번이라도 받았는지(목록 새로고침 여부)
    // "보기" 로 연 성인 카드. 검색을 새로 하면 도로 가린다.
    const revealed = new Set();

    /** ISO 날짜를 YYYY-MM-DD 로. 못 읽으면 그대로 둔다. */
    function prettyDate(iso) {
        if (!iso) return "";
        const date = new Date(iso);
        return isNaN(date) ? String(iso) : date.toISOString().slice(0, 10);
    }

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
            if (!more) { items = []; revealed.clear(); full.clear(); pick(null); }
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
        // 목록이 가진 것만 먼저 그리고, 설명과 나머지 이미지는 받아서 채운다
        renderDetail(model);
        loadFull(model);
    }

    /** 설명·예시는 목록에 실려 오지 않는다. 고른 것만 따로 받아온다. */
    async function loadFull(model) {
        if (full.has(model.id)) {
            picked = full.get(model.id);
            renderDetail(picked);
            return;
        }
        let fetched;
        try {
            const { data } = await json(`/fla/civitai/model?id=${model.id}`);
            if (!data?.ok) return;
            fetched = data.model;
        } catch (e) {
            return;
        }
        full.set(model.id, fetched);
        // 그 사이 다른 카드를 눌렀으면 화면을 건드리지 않는다
        if (picked?.id !== model.id) return;
        picked = fetched;
        renderDetail(fetched);
    }

    /** 버전 알약 줄. 고른 것이 파랗다. */
    function versionStrip(model, index, onPick) {
        const strip = el("div", "fla-cv-versions");
        (model.versions ?? []).forEach((version, i) => {
            const chip = el("button", `fla-cv-version${i === index ? " on" : ""}`);
            chip.append(document.createTextNode(version.name || `v${i + 1}`));
            if (version.installed) chip.appendChild(el("span", "have", "✓"));
            chip.title = [version.base_model, version.file_name].filter(Boolean).join("  ·  ");
            chip.onclick = () => onPick(i);
            strip.appendChild(chip);
        });
        return strip;
    }

    /** 좌우로 넘기는 이미지판. */
    function viewer(images, blurred) {
        const box = el("div", "fla-cv-viewer");
        const frame = el("div", "frame");
        box.appendChild(frame);
        if (!images.length) {
            frame.append(t("detailNoSamples"));
            return { box, dots: el("div") };
        }

        let at = 0;
        const counter = el("div", "fla-cv-counter");
        const dots = el("div", "fla-cv-dots");

        const draw = () => {
            frame.replaceChildren();
            const shot = images[at];
            const isVideo = shot.type === "video" || /\.(mp4|webm)(\?|$)/i.test(shot.url);
            const media = el(isVideo ? "video" : "img");
            media.src = shot.url;
            if (isVideo) {
                media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true;
            } else {
                media.loading = "lazy";
            }
            if (blurred && (shot.nsfw_level ?? 0) >= ADULT_LEVEL) media.classList.add("fla-cv-blur");
            frame.appendChild(media);
            counter.textContent = `${at + 1} / ${images.length}`;
            dots.replaceChildren(...images.map((_, i) => el("span", i === at ? "on" : null)));
        };

        const step = (delta) => {
            at = (at + delta + images.length) % images.length;
            draw();
        };
        if (images.length > 1) {
            const prev = el("button", "fla-cv-arrow prev", "‹");
            const next = el("button", "fla-cv-arrow next", "›");
            prev.onclick = () => step(-1);
            next.onclick = () => step(1);
            box.append(prev, next);
        }
        box.appendChild(counter);
        draw();
        return { box, dots };
    }

    /** Civitai 모델 화면의 Details 표. */
    function detailsTable(model, version) {
        const panel = el("div", "fla-cv-panel");
        const head = el("div", "fla-cv-panelhead");
        head.appendChild(el("span", null, t("civitaiDetails")));
        panel.appendChild(head);

        const table = el("div", "fla-cv-table");
        const row = (label, value) => {
            if (value === null || value === undefined || value === "") return;
            table.appendChild(el("div", null, label));
            const cell = el("div");
            if (value instanceof Node) cell.appendChild(value);
            else cell.textContent = String(value);
            table.appendChild(cell);
        };

        row(t("detailType"), el("span", "fla-cv-pill", model.type || "LORA"));
        if (typeof version.downloads === "number") {
            row(t("civitaiStats"), `↓ ${version.downloads.toLocaleString()}`);
        }
        if (version.review) {
            const tone = { veryPositive: "fla-cv-good", positive: "fla-cv-good", mixed: "fla-cv-mid", negative: "fla-cv-bad" };
            row(t("civitaiReviews"),
                el("span", tone[version.review], `${t(`civitaiReview_${version.review}`)} (${version.reviews})`));
        }
        row(t("detailPublished"), prettyDate(version.published));
        row(t("detailBase"), el("span", "fla-cv-good", version.base_model));
        if (version.clip_skip) row(t("civitaiUsageTips"), el("span", "fla-cv-pill", `CLIP SKIP: ${version.clip_skip}`));
        if (version.trained_words?.length) row(t("detailTrained"), version.trained_words.join(", "));
        row(t("detailFile"), version.file_name);
        row(t("detailSize"), version.size_kb ? prettySize(version.size_kb * 1024) : "");
        if (version.sha256) {
            row(t("detailHash"), copyValue(version.sha256.toUpperCase(),
                version.sha256.slice(0, 12).toUpperCase() + "…"));
        }
        if (version.air) row("AIR", copyValue(version.air));
        if (model.creator) row(t("detailCreator"), `@${model.creator}`);

        panel.appendChild(table);
        return panel;
    }

    function renderDetail(model) {
        const wanted = detail.scrollTop;
        detail.replaceChildren();
        detail.appendChild(el("h3", null, model.name));
        detail.appendChild(el("div", "by", [model.creator && `@${model.creator}`, model.type]
            .filter(Boolean).join("  ·  ")));

        let index = 0;
        const host = el("div");
        detail.appendChild(host);

        const drawVersion = () => {
            const version = (model.versions ?? [])[index] ?? {};
            const blurred = (model.nsfw || (model.nsfw_level ?? 0) >= ADULT_LEVEL) && !revealed.has(model.id);
            host.replaceChildren();

            host.appendChild(versionStrip(model, index, (i) => { index = i; drawVersion(); }));

            const shots = viewer(version.images ?? [], blurred);
            host.append(shots.box, shots.dots);
            if (blurred && (version.images ?? []).some((i) => (i.nsfw_level ?? 0) >= ADULT_LEVEL)) {
                const show = el("button", "fla-cv-btn", t("adultShow"));
                show.style.cssText = "width:100%;margin-bottom:11px";
                show.onclick = () => { revealed.add(model.id); drawVersion(); };
                host.appendChild(show);
            }

            // 저장 폴더 — 태그를 보고 미리 골라두고, 직접 고치거나 새로 적을 수 있다
            const folderField = el("div", "fla-cv-field");
            folderField.appendChild(el("label", null, t("civitaiFolder")));
            const folderInput = el("input");
            folderInput.setAttribute("list", "fla-cv-folders");
            folderInput.placeholder = t("civitaiFolderRoot");
            folderInput.value = version.folder ?? "";
            folderField.appendChild(folderInput);
            const list = el("datalist");
            list.id = "fla-cv-folders";
            for (const folder of folders) list.appendChild(new Option(folder, folder));
            folderField.appendChild(list);
            host.appendChild(folderField);

            const size = version.size_kb ? ` (${prettySize(version.size_kb * 1024)})` : "";
            const grab = el("button", `fla-cv-get${version.installed ? " owned" : ""}`);
            grab.append(document.createTextNode("⬇"), document.createTextNode(
                `${version.installed ? t("civitaiDownloadAgain") : t("civitaiDownload")}${size}`));
            grab.disabled = !version.downloadable;
            grab.onclick = async () => {
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
            host.appendChild(grab);
            if (version.installed) host.appendChild(el("div", "fla-cv-now", `✓ ${t("civitaiHaveLong")}`));

            const open = el("a", "fla-cv-link");
            open.href = `https://civitai.com/models/${model.id}?modelVersionId=${version.id}`;
            open.target = "_blank";
            open.rel = "noopener noreferrer";
            open.textContent = t("detailOpenCivitai");
            open.style.cssText = "display:inline-block;margin-top:8px";
            host.appendChild(open);

            host.appendChild(detailsTable(model, version));

            if (model.tags?.length) {
                const tags = el("div", "fla-cv-tags");
                for (const tag of model.tags.slice(0, 14)) tags.appendChild(el("div", "fla-cv-tag", tag));
                host.appendChild(tags);
            }

            // 설명은 상세를 받아와야 채워진다. 오기 전에는 기다리는 중이라고 둔다.
            const about = el("div", "fla-cv-panel");
            const aboutHead = el("div", "fla-cv-panelhead");
            aboutHead.appendChild(el("span", null, t("tabAbout")));
            const body = el("div", "fla-cv-desc");
            renderDescription(body, model.description,
                full.has(model.id) ? t("detailNoDesc") : t("loading"));
            about.append(aboutHead, body);
            host.appendChild(about);
        };

        drawVersion();
        detail.scrollTop = wanted;
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
            const done = state.current?.version_id;
            for (const model of [...items, ...full.values()]) {
                for (const version of model.versions ?? []) {
                    if (version.id === done) { version.installed = true; model.installed = true; }
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
