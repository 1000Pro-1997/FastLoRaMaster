/** Civitai 에서 로라를 찾아 받는 화면.
 *
 *  검색은 서버가 대신 부른다(브라우저에서 부르면 교차 출처에 걸리고 API 키도
 *  드러난다). 받는 것도 서버가 한다 — 받자마자 정보와 대표 이미지를 옆에
 *  놓고, 태그를 보고 이미 쓰고 있는 폴더로 넣는다.
 */

import { t } from "./fla_i18n.js";
import { ADULT_LEVEL, addCivitaiStyles, el, json, toast } from "./fla_civitai_util.js";
import { createDownloadBar } from "./fla_civitai_download.js";
import { clearCache, createModelDetail, loadFolders, markInstalled } from "./fla_civitai_detail.js";

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

    // ---------------------------------------------- 상태
    let items = [];
    let cursor = "";
    let loading = false;
    let picked = null;         // 지금 상세를 보고 있는 모델
    // 이번에 받기를 누른 버전. 다 받아지면 "있음" 으로 바꾼다.
    const sent = new Set();
    // "보기" 로 연 성인 카드. 검색을 새로 하면 도로 가린다.
    const revealed = new Set();

    // ---------------------------------------------- 결과와 상세
    const results = el("div", "fla-cv-results");
    const grid = el("div", "fla-cv-grid");
    // 오른쪽 상세 칸. 업데이트 확인과 버전 탭도 같은 것을 쓴다.
    const detail = createModelDetail({
        revealed,
        onQueued: (model, version) => { sent.add(version.id); downloads.watch(); },
        onClose: () => pick(null),
    });
    results.append(grid, detail.root);

    // ---------------------------------------------- 내려받기 줄
    // 받는 일은 서버가 한다. 여기서는 대기열에 넣고 진행률만 본다.
    const downloads = createDownloadBar(async () => {
        onInstalled?.();
        await loadFolders(true);
        // 방금 받은 버전에 "있음" 을 찍는다(다시 검색하지 않아도 보이게)
        for (const model of items) {
            for (const version of model.versions ?? []) {
                if (sent.has(version.id)) { version.installed = true; model.installed = true; }
            }
        }
        for (const id of sent) markInstalled(id);
        sent.clear();
        render();
        detail.refresh();
    });

    root.append(searchBar, results, downloads.root);

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
    /** 카드를 고르면 오른쪽 칸에 그 모델을 편다. null 이면 칸을 닫는다. */
    function pick(model, node = null) {
        picked = model;
        for (const other of grid.querySelectorAll(".fla-cv-card")) other.classList.remove("on");
        if (!model) { detail.clear(); return; }
        node?.classList.add("on");
        // 목록이 가진 것만 먼저 그리고, 설명과 나머지 예시는 모듈이 받아서 채운다
        detail.show(model);
    }

    go.onclick = () => search(false);
    query.addEventListener("keydown", (event) => { if (event.key === "Enter") search(false); });
    for (const control of [sort, period, base, nsfw]) control.onchange = () => search(false);

    let started = false;
    return {
        root,
        /** 탭을 처음 열 때 한 번만 검색한다. */
        async activate() {
            await loadFolders();
            downloads.watch();
            if (started) return;
            started = true;
            search(false);
        },
        dispose() {
            downloads.dispose();
            // 받아 둔 모델 정보는 창과 함께 버린다(다음에 열 때 새로 읽는다)
            clearCache();
        },
    };
}
