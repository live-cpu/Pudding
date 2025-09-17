// /game/scoreboard.js
import { getTopScores } from "./gdatabase.js";

/* ========== 구 스코어보드(카드형) ========== */
function injectStylesOnce() {
  if (document.getElementById("scoreboard-style")) return;
  const s = document.createElement("style");
  s.id = "scoreboard-style";
  s.textContent = `
  .scoreboard { border:1px solid #ddd; border-radius:12px; background:#fff; padding:10px; }
  .scoreboard h3 { margin:0 0 8px; font:700 14px system-ui; }
  .scores { display:flex; flex-direction:column; gap:6px; }
  .score-row { display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:10px; background:#f7f7f7; }
  .score-rank { width:24px; text-align:center; font:700 12px system-ui; color:#5942D9; }
  .score-thumb { width:36px; height:36px; border-radius:8px; overflow:hidden; background:#eee; flex:0 0 auto; }
  .score-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
  .score-main { flex:1 1 auto; min-width:0; }
  .score-name { font:600 12px system-ui; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .score-sub { font:11px system-ui; color:#888; }
  .score-score { font:700 13px system-ui; }
  `;
  document.head.appendChild(s);
}

export async function mountScoreboard(container){
  injectStylesOnce();
  const el = typeof container === "string" ? document.querySelector(container) : container;
  if (!el) throw new Error("scoreboard root not found");
  el.classList.add("scoreboard");
  el.innerHTML = `<h3>Top 10</h3><div class="scores">Loading...</div>`;
  const listEl = el.querySelector(".scores");

  async function draw() {
    listEl.textContent = "Loading...";
    try{
      const rows = await getTopScores(10);
      listEl.textContent = "";
      if (!rows.length) {
        listEl.textContent = "아직 점수가 없습니다.";
        return;
      }
      rows.forEach((r, i)=>{
        const row = document.createElement("div");
        row.className = "score-row";
        row.innerHTML = `
          <div class="score-rank">${i+1}</div>
          <div class="score-thumb">${r.thumb_data ? `<img src="${r.thumb_data}" alt="thumb"/>` : ""}</div>
          <div class="score-main">
            <div class="score-name">${escapeHtml(r.name || "Player")}</div>
            <div class="score-sub">${new Date(r.created_at).toLocaleString()}</div>
          </div>
          <div class="score-score">${r.score}</div>
        `;
        listEl.appendChild(row);
      });
    }catch(e){
      listEl.textContent = e?.message || String(e);
    }
  }

  el.addEventListener('reload', draw);
  await draw();
  return { reload: draw };
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

/* ========== NEW: 라인형 리더보드 + 좌측 프리뷰(글래스) ========== */
export async function mountLeaderboard(container, { limit = 100 } = {}) {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) throw new Error("leaderboard root not found");

  // 왼쪽 프리뷰(기본 숨김) + 오른쪽 리스트 (헤더/칩 없음)
  root.innerHTML = `
    <div class="row rank-row">
      <section class="panel rank-left">
        <h2 class="rank-title">awards</h2>
        <div class="lb-preview" id="lb-preview" aria-hidden="true">
          <img class="lb-preview-img" alt="">
          <div class="glass"></div>
        </div>
        <div class="lb-meta" id="lb-meta"></div>
      </section>

      <section class="panel leaderboard-panel">
        <div class="lb-body" id="lb-body" role="list"></div>
      </section>
    </div>
  `;

  const bodyEl      = root.querySelector("#lb-body");
  const previewBox  = root.querySelector("#lb-preview");
  const previewImg  = root.querySelector(".lb-preview-img");


  function showPreview(thumb, name = "", score = "") {
    if (thumb) {
      previewImg.src = thumb;
      previewBox.classList.add("show");
      
    } else {
      previewImg.removeAttribute("src");
      previewBox.classList.remove("show");
      
    }
  }

  bodyEl.addEventListener("mouseleave", () => showPreview(null));

  async function draw() {
    bodyEl.textContent = "Loading...";
    try {
      const rows = await getTopScores(limit);
      bodyEl.textContent = "";

      if (!rows?.length) {
        bodyEl.textContent = "아직 점수가 없습니다.";
        showPreview(null);
        return;
      }

      const frag = document.createDocumentFragment();
      rows.forEach((r, i) => {
        const row = document.createElement("div");
        row.className = "lb-row";
        row.setAttribute("tabindex", "0"); // 포커스 가능
        row.innerHTML = `
          <div class="lb-rank">${i + 1}</div>
          <div class="lb-name">${safe(r.name || "Player")}</div>
          <div class="lb-score">${Number(r.score).toLocaleString()}</div>
        `;
        const hover = () => showPreview(r.thumb_data || null, r.name || "Player", r.score);
        row.addEventListener("mouseenter", hover);
        row.addEventListener("focusin", hover);
        frag.appendChild(row);
      });
      bodyEl.appendChild(frag);

      // 기본은 숨김
      showPreview(null);
    } catch (e) {
      bodyEl.textContent = e?.message || String(e);
      showPreview(null);
    }
  }

  root.addEventListener("reload", draw);
  await draw();
  return { reload: draw };
}

function safe(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}
