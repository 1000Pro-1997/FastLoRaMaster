/** 모델 상세 칸 — 오른쪽에 붙여 쓰는 Civitai 모델 정보판.
 *
 *  Civitai 모델 페이지가 읽히는 대로 그린다. 버전 알약 줄, 좌우로 넘기는
 *  예시판, 저장 폴더, 받기 단추, 상세 표, 태그, 설명.
 *
 *  세 곳이 같이 쓴다 — 모델 찾기(카드를 고를 때), 업데이트 확인(업글 상자를
 *  누를 때), 로라 상세 창의 버전 탭(버전 줄을 누를 때). 어디에 붙일지는
 *  부르는 쪽이 정하고, 여기서는 칸 하나만 만들어 준다.
 */

import { t } from "./fla_i18n.js";
import {
    ADULT_LEVEL, addCivitaiStyles, copyValue, el, json, post, prettySize,
    renderDescription, toast,
} from "./fla_civitai_util.js";

// 받아온 모델은 창을 닫을 때까지 돌려 쓴다(같은 모델을 두 번 부르지 않게).
const cache = new Map();
// 저장 폴더 목록도 한 번만 받는다.
let foldersPromise = null;
let folders = [];
// datalist 는 문서에서 id 로 찾는다. 칸이 여럿이면 겹치지 않게 번호를 붙인다.
let serial = 0;

/** ISO 날짜를 YYYY-MM-DD 로. 못 읽으면 그대로 둔다. */
function prettyDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return isNaN(date) ? String(iso) : date.toISOString().slice(0, 10);
}

/** 저장 폴더 후보. 받아 두고 모두가 같이 쓴다. */
export async function loadFolders(force = false) {
    if (force) foldersPromise = null;
    foldersPromise ??= json("/fla/civitai/folders")
        .then(({ data }) => { folders = data?.folders ?? []; return folders; })
        .catch(() => { folders = []; return folders; });
    return foldersPromise;
}

/** 받아 둔 것을 버린다. 창을 닫을 때 부른다 — 그 사이 파일을 지웠을 수도 있다. */
export function clearCache() {
    cache.clear();
    foldersPromise = null;
}

/** 받아 둔 모델에서 이 버전을 "있음" 으로 바꾼다(받자마자 화면에 반영하려고). */
export function markInstalled(versionId) {
    for (const model of cache.values()) {
        for (const version of model.versions ?? []) {
            if (version.id === versionId) { version.installed = true; model.installed = true; }
        }
    }
}

/** 상세 칸 하나를 만든다.
 *
 *  onQueued(model, version) — 받기 대기열에 넣었을 때(진행 줄을 깨우라는 뜻)
 *  onClose()               — 닫기(×)를 눌렀을 때
 *  revealed                — 성인 가림을 푼 모델 id 모음(부르는 쪽과 나눠 쓴다)
 */
export function createModelDetail({ onQueued = null, onClose = null, revealed = null } = {}) {
    addCivitaiStyles();
    const seen = revealed ?? new Set();
    const listId = `fla-cv-folders-${++serial}`;

    const root = el("div", "fla-cv-detail");
    root.style.display = "none";

    let model = null;        // 지금 그린 모델
    let wantId = null;       // 마지막으로 부탁받은 모델(늦게 온 응답을 버리려고)
    let pickVersion = null;  // 처음 고를 버전 id
    let folderHint = null;   // 저장 폴더 기본값(없으면 서버가 제안한 곳)

    loadFolders();

    // ---------------------------------------------- 조각
    /** 버전 알약 줄. 고른 것이 파랗다. */
    function versionStrip(index, onPick) {
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
    function detailsTable(version) {
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

    /** 제목줄 — 이름, 제작자, 닫기. */
    function header() {
        const bar = el("div", "fla-cv-detailhead");
        const titles = el("div");
        titles.appendChild(el("h3", null, model.name));
        titles.appendChild(el("div", "by", [model.creator && `@${model.creator}`, model.type]
            .filter(Boolean).join("  ·  ")));
        const x = el("button", "x", "×");
        x.title = t("close");
        x.onclick = () => { clear(); onClose?.(); };
        bar.append(titles, x);
        return bar;
    }

    // ---------------------------------------------- 그리기
    function render() {
        const wanted = root.scrollTop;
        root.replaceChildren();
        root.style.display = "";
        if (!model) {
            root.appendChild(el("div", "fla-cv-loading", t("loading")));
            return;
        }
        root.appendChild(header());

        const host = el("div");
        root.appendChild(host);

        const versions = model.versions ?? [];
        let index = Math.max(0, versions.findIndex((v) => v.id === pickVersion));

        const drawVersion = () => {
            const version = versions[index] ?? {};
            const blurred = (model.nsfw || (model.nsfw_level ?? 0) >= ADULT_LEVEL) && !seen.has(model.id);
            host.replaceChildren();

            host.appendChild(versionStrip(index, (i) => { index = i; drawVersion(); }));

            const shots = viewer(version.images ?? [], blurred);
            host.append(shots.box, shots.dots);
            if (blurred && (version.images ?? []).some((i) => (i.nsfw_level ?? 0) >= ADULT_LEVEL)) {
                const show = el("button", "fla-cv-btn", t("adultShow"));
                show.style.cssText = "width:100%;margin-bottom:11px";
                show.onclick = () => { seen.add(model.id); drawVersion(); };
                host.appendChild(show);
            }

            // 저장 폴더 — 부르는 쪽이 정해준 곳, 없으면 태그를 보고 서버가 고른 곳
            const folderField = el("div", "fla-cv-field");
            folderField.appendChild(el("label", null, t("civitaiFolder")));
            const folderInput = el("input");
            folderInput.setAttribute("list", listId);
            folderInput.placeholder = t("civitaiFolderRoot");
            folderInput.value = folderHint ?? version.folder ?? "";
            folderField.appendChild(folderInput);
            const list = el("datalist");
            list.id = listId;
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
                    let data;
                    try {
                        ({ data } = await post("/fla/civitai/download", {
                            version_id: version.id,
                            folder: folderInput.value.trim(),
                            title: model.name,
                        }));
                    } catch (e) {
                        data = null;
                    }
                    if (!data?.ok) { toast(data?.error ?? t("civitaiDownloadFail"), true); return; }
                    toast(t("civitaiQueued"));
                    onQueued?.(model, version);
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

            host.appendChild(detailsTable(version));

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
                cache.has(model.id) ? t("detailNoDesc") : t("loading"));
            about.append(aboutHead, body);
            host.appendChild(about);
        };

        drawVersion();
        root.scrollTop = wanted;
    }

    /** 설명과 나머지 예시는 목록에 실려 오지 않는다. 고른 것만 따로 받아온다. */
    async function loadFull(id) {
        if (cache.has(id)) {
            if (wantId !== id) return;
            model = cache.get(id);
            render();
            return;
        }
        let fetched;
        try {
            const { data } = await json(`/fla/civitai/model?id=${id}`);
            if (!data?.ok) {
                if (wantId === id && !model) {
                    root.replaceChildren(el("div", "fla-cv-loading",
                        data?.error || t("versionsFail")));
                }
                return;
            }
            fetched = data.model;
        } catch (e) {
            return;
        }
        cache.set(id, fetched);
        // 그 사이 다른 것을 눌렀으면 화면을 건드리지 않는다
        if (wantId !== id) return;
        model = fetched;
        render();
    }

    function clear() {
        model = null;
        wantId = null;
        root.style.display = "none";
        root.replaceChildren();
    }

    return {
        root,
        /** 모델 하나를 보여준다.
         *  source 는 목록이 준 모델 객체이거나 모델 id.
         *  versionId 를 주면 그 버전을 펴 놓고, folder 를 주면 저장 폴더를 그리로 맞춘다. */
        show(source, { versionId = null, folder = null } = {}) {
            const id = typeof source === "object" && source !== null ? source.id : Number(source);
            if (!id) return;
            wantId = id;
            pickVersion = versionId;
            folderHint = folder;
            // 가진 것이 있으면 먼저 그린다(빈 칸을 보여주지 않으려고)
            model = cache.get(id)
                ?? (typeof source === "object" && source !== null ? source : null);
            render();
            loadFull(id);
        },
        clear,
        /** 지금 보여주는 모델 id(없으면 null). */
        showing: () => (model ? model.id : wantId),
        /** 받은 뒤 "있음" 표시를 새로 그린다. */
        refresh() {
            if (model && cache.has(model.id)) model = cache.get(model.id);
            if (model) render();
        },
        dispose() { clear(); },
    };
}
