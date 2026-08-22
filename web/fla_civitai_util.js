/** Civitai 화면들이 같이 쓰는 것들 — 스타일, 알림, 서버 호출.
 *
 *  fla_civitai.js(창 껍데기)와 fla_civitai_browse.js(모델 찾기)가 이 파일만
 *  가져다 쓴다. 여기서는 아무것도 가져오지 않아 서로 물고 도는 일이 없다.
 */

/** 진행률을 물어보는 간격(ms). */
export const POLL = 700;
/** 성인 등급으로 보는 nsfwLevel 하한. 서버 ADULT_LEVEL 과 같다. */
export const ADULT_LEVEL = 4;

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function addCivitaiStyles() {
    if (document.getElementById("fla-civitai-style")) return;
    const style = document.createElement("style");
    style.id = "fla-civitai-style";
    style.textContent = `
      .fla-cv-bg{position:fixed;inset:0;z-index:100015;background:#000b;display:grid;place-items:center;padding:3vh}
      .fla-cv{width:min(1280px,96vw);height:min(880px,92vh);display:flex;flex-direction:column;background:#181a1f;color:#ddd;border:1px solid #4b5360;border-radius:12px;overflow:hidden;box-shadow:0 22px 70px #000;font:14px Arial,sans-serif}
      .fla-cv-head{display:flex;align-items:center;gap:10px;padding:11px 14px;background:#22262d;border-bottom:1px solid #383e48}.fla-cv-head h2{margin:0;font-size:15px;font-weight:700;color:#fff;white-space:nowrap}.fla-cv-head .logo{flex:none;display:grid;width:26px;height:26px;place-items:center;color:#fff;background:#1971c2;border-radius:7px;font-size:14px;font-weight:800}.fla-cv-head .spacer{flex:1}.fla-cv-head .close{flex:none;width:32px;height:32px;padding:0;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;font-size:18px;cursor:pointer}.fla-cv-head .close:hover{background:#3a424e}
      .fla-cv-tabs{display:flex;gap:2px;margin-left:14px}.fla-cv-tabs button{position:relative;padding:9px 15px;color:#98a1ad;background:transparent;border:0;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}.fla-cv-tabs button:hover{color:#c8cdd5}.fla-cv-tabs button.on{color:#4dabf7}.fla-cv-tabs button.on::after{content:"";position:absolute;left:6px;right:6px;bottom:-12px;height:2px;background:#4dabf7;border-radius:2px}
      .fla-cv-main{display:flex;flex:1;min-height:0;flex-direction:column}
      .fla-cv-page{display:none;flex:1;min-height:0;flex-direction:column}.fla-cv-page.on{display:flex}
      .fla-cv-body{flex:1;min-height:0;padding:16px;overflow-y:auto}
      .fla-cv-narrow{width:100%;max-width:640px;margin:0 auto}
      .fla-cv-sec{margin-bottom:16px}.fla-cv-sec>h3{margin:0 0 8px;color:#8d95a1;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
      .fla-cv-key{display:flex;gap:6px}.fla-cv-key input{flex:1;min-width:0;height:34px;padding:0 10px;color:#eee;background:#111419;border:1px solid #454c58;border-radius:7px}
      .fla-cv-btn{height:34px;padding:0 14px;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:7px;font-size:13px;white-space:nowrap;cursor:pointer}.fla-cv-btn:hover{background:#3a424e}.fla-cv-btn:disabled{opacity:.45;cursor:default}
      .fla-cv-btn.go{color:#fff;background:#1971c2;border-color:#1c7ed6}.fla-cv-btn.go:hover:not(:disabled){background:#1c7ed6}
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
      .fla-cv-note{padding:10px 12px;background:#15263a;border:1px solid #1f4a75;border-left:3px solid #1971c2;border-radius:7px;color:#cfe2f5;font-size:12px;line-height:1.6}.fla-cv-note b{color:#fff}
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
      .fla-cv-mocktable{display:grid;grid-template-columns:1fr 52px 52px;gap:1px;margin:9px 0;overflow:hidden;background:#333a45;border:1px solid #333a45;border-radius:5px}
      .fla-cv-mocktable>div{padding:4px 8px;text-align:center;background:#1e232a}
      .fla-cv-mocktable>div:nth-child(3n+1){text-align:left}
      .fla-cv-mocktable>div.h{color:#8d95a1;background:#242932}
      .fla-cv-mocktable>div.yes{color:#4dabf7}
      .fla-cv-mockright{display:flex;justify-content:flex-end}
      .fla-cv-mockkey{display:flex;align-items:center;gap:8px;padding:6px 9px;color:#dde2e8;background:#111419;border:1px solid #3a414c;border-radius:5px;font-family:monospace}
      .fla-cv-mockkey>span:first-child{flex:1;min-width:0;overflow:hidden}

      .fla-cv-search{display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px;background:#1d2026;border-bottom:1px solid #383e48}
      .fla-cv-search input[type=search]{flex:1 1 240px;min-width:0;height:34px;padding:0 11px;color:#eee;background:#111419;border:1px solid #454c58;border-radius:7px}
      .fla-cv-search select{height:34px;padding:0 7px;color:#ddd;background:#252a32;border:1px solid #454c58;border-radius:7px;font-size:12px;cursor:pointer}
      .fla-cv-results{display:flex;flex:1;min-height:0}
      .fla-cv-grid{flex:1;min-width:0;padding:14px;overflow-y:scroll;scrollbar-gutter:stable;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));grid-auto-rows:max-content;align-content:start;gap:12px}
      .fla-cv-card{position:relative;display:block;padding:0;overflow:hidden;color:#ddd;background:#242830;border:1px solid #3b424d;border-radius:9px;cursor:pointer}.fla-cv-card:hover{border-color:#4dabf7}.fla-cv-card.on{border-color:#4dabf7;box-shadow:0 0 0 2px #1971c2aa}
      .fla-cv-shot{position:relative;display:grid;width:100%;aspect-ratio:3 / 4;place-items:center;overflow:hidden;color:#59616d;background:#111318}
      .fla-cv-shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
      .fla-cv-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(#000b,#0000 34%,#0000 52%,#000d)}
      .fla-cv-cardtitle{position:absolute;top:8px;left:9px;right:9px;pointer-events:none;color:#fff;font-size:13px;font-weight:700;line-height:1.25;text-shadow:0 1px 3px #000;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
      .fla-cv-cardfoot{position:absolute;left:8px;right:8px;bottom:8px;pointer-events:none;display:flex;flex-wrap:wrap;gap:4px}
      .fla-cv-chip{padding:3px 6px;color:#fff;background:#111d;border-radius:4px;font-size:11px}
      .fla-cv-chip.have{color:#1a1a1a;background:#7bd88f}
      .fla-cv-blur{filter:blur(18px);transform:scale(1.06)}
      .fla-cv-veil{position:absolute;inset:0;z-index:2;display:grid;place-items:center;background:#0006}
      .fla-cv-veil button{padding:5px 13px;color:#fff;background:#1971c2;border:0;border-radius:6px;font-size:12px;cursor:pointer}
      .fla-cv-more{grid-column:1/-1;display:grid;place-items:center;padding:6px 0 14px}
      .fla-cv-empty{grid-column:1/-1;padding:60px;text-align:center;color:#89919d}
      .fla-cv-detail{width:440px;flex:none;padding:14px;overflow-y:auto;background:#1d2026;border-left:1px solid #383e48}
      .fla-cv-detailhead{display:flex;align-items:flex-start;gap:8px}
      .fla-cv-detailhead>div:first-child{flex:1;min-width:0}
      .fla-cv-detailhead .by{margin-bottom:12px}
      .fla-cv-detailhead .x{flex:none;width:26px;height:26px;padding:0;color:#ddd;background:#303640;border:1px solid #454c58;border-radius:6px;font-size:15px;line-height:1;cursor:pointer}
      .fla-cv-detailhead .x:hover{background:#3a424e}
      .fla-cv-detail h3{margin:0 0 4px;color:#fff;font-size:16px;overflow-wrap:anywhere}
      .fla-cv-detail .by{margin-bottom:12px;color:#98a1ad;font-size:12px}
      .fla-cv-field{margin-bottom:11px}.fla-cv-field label{display:block;margin-bottom:4px;color:#8d95a1;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
      .fla-cv-field select,.fla-cv-field input{width:100%;height:32px;padding:0 8px;color:#eee;background:#111419;border:1px solid #454c58;border-radius:6px;box-sizing:border-box}
      .fla-cv-tags{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}
      .fla-cv-tag{padding:2px 8px;color:#cfd6de;background:#2b3138;border:1px solid #3d444e;border-radius:20px;font-size:11px}
      .fla-cv-loading{padding:40px;text-align:center;color:#89919d;font-size:12px}

      .fla-cv-versions{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 12px}
      .fla-cv-version{flex:none;max-width:100%;padding:6px 11px;color:#c8cdd5;background:#2b3138;border:1px solid #3d444e;border-radius:6px;font-size:12px;font-weight:700;text-align:left;overflow-wrap:anywhere;cursor:pointer}
      .fla-cv-version:hover{background:#3a424e}
      .fla-cv-version.on{color:#fff;background:#1971c2;border-color:#1971c2}
      .fla-cv-version .have{margin-left:5px;color:#7bd88f;font-weight:400}
      .fla-cv-version.on .have{color:#d3f9d8}

      .fla-cv-viewer{position:relative;margin-bottom:11px;overflow:hidden;background:#111318;border:1px solid #3b424d;border-radius:9px}
      .fla-cv-viewer .frame{position:relative;display:grid;width:100%;height:300px;place-items:center;color:#59616d}
      .fla-cv-viewer img,.fla-cv-viewer video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#0b0d11}
      .fla-cv-arrow{position:absolute;z-index:3;top:50%;width:34px;height:52px;padding:0;transform:translateY(-50%);color:#fff;background:#000a;border:1px solid #ffffff22;border-radius:7px;font-size:19px;cursor:pointer}
      .fla-cv-arrow:hover{background:#1971c2;border-color:#4dabf7}
      .fla-cv-arrow.prev{left:7px}.fla-cv-arrow.next{right:7px}
      .fla-cv-counter{position:absolute;z-index:3;right:8px;bottom:8px;padding:3px 8px;color:#fff;background:#000b;border-radius:5px;font-size:11px;font-variant-numeric:tabular-nums}
      .fla-cv-dots{display:flex;justify-content:center;gap:4px;margin:-4px 0 11px}
      .fla-cv-dots span{width:6px;height:6px;background:#3f4650;border-radius:50%}
      .fla-cv-dots span.on{background:#4dabf7}

      .fla-cv-get{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:42px;margin-bottom:6px;color:#fff;background:#1971c2;border:1px solid #1c7ed6;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
      .fla-cv-get:hover:not(:disabled){background:#1c7ed6}
      .fla-cv-get:disabled{opacity:.5;cursor:default}
      .fla-cv-get.owned{color:#d3f9d8;background:#245c33;border-color:#2f7d45}

      .fla-cv-panel{margin-top:14px;overflow:hidden;background:#1b1f26;border:1px solid #333a45;border-radius:9px}
      .fla-cv-panelhead{display:flex;align-items:center;padding:9px 12px;background:#22262d;border-bottom:1px solid #333a45;color:#fff;font-size:13px;font-weight:700}
      .fla-cv-panelhead span{flex:1}
      .fla-cv-table{display:grid;grid-template-columns:max-content 1fr}
      .fla-cv-table>div{padding:8px 12px;border-top:1px solid #262b33;font-size:12px;overflow-wrap:anywhere}
      .fla-cv-table>div:nth-child(-n+2){border-top:0}
      .fla-cv-table>div:nth-child(odd){color:#8d95a1;white-space:nowrap}
      .fla-cv-table>div:nth-child(even){color:#dde2e8;text-align:right}
      .fla-cv-pill{display:inline-block;padding:2px 8px;background:#2b3138;border:1px solid #3d444e;border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.3px}
      .fla-cv-copy{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 8px;color:#dde2e8;background:#111419;border:1px solid #3a414c;border-radius:5px;font-family:monospace;font-size:11px;cursor:pointer}
      .fla-cv-copy:hover{border-color:#4dabf7}
      .fla-cv-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fla-cv-good{color:#7bd88f}.fla-cv-mid{color:#ffd34e}.fla-cv-bad{color:#e08a7d}
      .fla-cv-desc{padding:12px;color:#c8cdd5;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
      .fla-cv-desc p{margin:0 0 9px}.fla-cv-desc p:last-child{margin:0}
      .fla-cv-split{display:flex;flex:1;min-height:0}
      .fla-cv-rail{flex:none;width:340px;padding:14px;overflow-y:auto;background:#1b1e24;border-right:1px solid #383e48}
      .fla-cv-pane{display:flex;flex:1;min-width:0;flex-direction:column}
      .fla-cv-box{margin-bottom:12px;overflow:hidden;background:#1e222a;border:1px solid #333a45;border-radius:9px}
      .fla-cv-boxhead{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#22262d;border-bottom:1px solid #333a45;color:#c8cdd5;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
      .fla-cv-boxbody{padding:12px}
      .fla-cv-panehead{display:flex;align-items:center;gap:9px;padding:11px 14px;background:#1d2026;border-bottom:1px solid #383e48}
      .fla-cv-panehead h3{flex:1;margin:0;color:#fff;font-size:14px}
      .fla-cv-panehead .fla-cv-chip{background:#1971c2}
      .fla-cv-seg{display:flex;gap:2px;padding:2px;background:#151820;border:1px solid #333a45;border-radius:8px}
      .fla-cv-seg button{padding:6px 13px;color:#98a1ad;background:transparent;border:0;border-radius:6px;font-size:12px;font-weight:700;white-space:nowrap;cursor:pointer}
      .fla-cv-seg button:hover{color:#c8cdd5}
      .fla-cv-seg button.on{color:#fff;background:#1971c2}
      .fla-cv-headacts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto}
      .fla-cv-up.old{background:#241f20;border-color:#3d3335}
      .fla-cv-up.old:hover{border-color:#5a464a}
      .fla-cv-up.old .fla-cv-verold{color:#e0b0a8;background:#332626;border-color:#5a3f3f}
      .fla-cv-up.old .fla-cv-vernew{color:#1a1a1a;background:#7bd88f;border-color:#7bd88f}
      .fla-cv-up.old .fla-cv-to{color:#8d95a1}
      .fla-cv-btn.stop.sm{background:#8e2f24;border-color:#a8483c}
      .fla-cv-btn.stop.sm:hover:not(:disabled){background:#c0392b}
      .fla-cv-list{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;gap:10px;padding:14px;overflow-y:auto}
      .fla-cv-btn.sm{height:28px;padding:0 10px;font-size:12px}
      .fla-cv-hint{color:#7d858f;font-size:11px;line-height:1.5}
      .fla-cv-boxbody .fla-cv-hint{margin-top:9px}
      .fla-cv-up{display:grid;grid-template-columns:96px 1fr;gap:12px;padding:10px;background:#20242b;border:1px solid #333a45;border-radius:10px;cursor:pointer}
      .fla-cv-up:hover{border-color:#4b5563}
      .fla-cv-up.on{border-color:#4dabf7;box-shadow:0 0 0 2px #1971c2aa}
      .fla-cv-up.off{opacity:.45}
      .fla-cv-up>div:last-child{min-width:0}
      .fla-cv-upshot{display:grid;width:96px;height:128px;place-items:center;overflow:hidden;color:#59616d;background:#111318;border-radius:7px;font-size:11px}
      .fla-cv-upshot img,.fla-cv-upshot video{width:100%;height:100%;object-fit:cover}
      .fla-cv-upname{color:#fff;font-size:13px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
      .fla-cv-upfile{margin-top:2px;color:#8d95a1;font-size:11px;overflow-wrap:anywhere}
      .fla-cv-jump{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 7px}
      .fla-cv-verold{padding:3px 8px;color:#c8cdd5;background:#2b3138;border:1px solid #3d444e;border-radius:5px;font-size:12px}
      .fla-cv-vernew{padding:3px 8px;color:#fff;background:#1971c2;border:1px solid #4dabf7;border-radius:5px;font-size:12px;font-weight:700}
      .fla-cv-to{color:#7bd88f;font-size:14px;font-weight:700}
      .fla-cv-badge{padding:2px 7px;color:#8d95a1;background:#262b33;border:1px solid #3a414c;border-radius:20px;font-size:11px}
      .fla-cv-upmeta{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:8px;color:#98a1ad;font-size:11px}
      .fla-cv-upacts{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
      .fla-cv-upacts a.fla-cv-btn{display:inline-block;text-decoration:none}
      .fla-cv-dlbar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#1d2026;border-top:1px solid #383e48}
      .fla-cv-dlbar .who{flex:1;min-width:0;color:#c8cdd5;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fla-cv-dlbar .fla-cv-bar{flex:1;margin:0}
      .fla-cv-dlbar .pct{color:#98a1ad;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
    `;
    document.head.appendChild(style);
}

export function toast(message, error = false) {
    addCivitaiStyles();
    const node = el("div", `fla-cv-toast${error ? " bad" : ""}`, message);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2400);
}

export async function json(url, options) {
    const res = await fetch(url, options);
    let data = null;
    try { data = await res.json(); } catch (e) { /* 본문이 비어 있을 수도 있다 */ }
    return { ok: res.ok, status: res.status, data };
}

export const post = (url, body) => json(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
});

/** 바이트를 사람이 읽는 크기로. */
export function prettySize(bytes) {
    if (!bytes) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Civitai 가 준 설명은 HTML 이다. 태그를 그대로 넣으면 스크립트가 딸려올 수
 *  있으므로 글자만 뽑아 문단으로 다시 만든다. */
export function renderDescription(host, html, emptyText) {
    host.replaceChildren();
    if (!html) {
        if (emptyText) host.appendChild(el("div", "fla-cv-loading", emptyText));
        return;
    }
    const text = String(html)
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\s*\/\s*(p|div|li|h\d)\s*>/gi, "\n\n")
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
        host.appendChild(el("p", null, trimmed));
    }
    if (!host.children.length && emptyText) {
        host.appendChild(el("div", "fla-cv-loading", emptyText));
    }
}

/** 눌러서 복사되는 값. 해시와 AIR 에 쓴다. */
export function copyValue(text, short = null) {
    const node = el("button", "fla-cv-copy");
    node.append(el("span", null, short ?? text), document.createTextNode("⧉"));
    node.title = text;
    node.onclick = async () => {
        try { await navigator.clipboard.writeText(text); } catch (e) { return; }
        const label = node.querySelector("span");
        const old = label.textContent;
        label.textContent = "copied";
        setTimeout(() => { label.textContent = old; }, 900);
    };
    return node;
}
