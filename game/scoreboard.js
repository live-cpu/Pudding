// /game/scoreboard.js
import { getTopScores } from "./gdatabase.js";

export async function mountLeaderboard(container, { limit = 100 } = {}) {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) throw new Error("leaderboard root not found");

  // 스타일 1회 주입: 기본은 숨김, show에만 표시
  if (!document.getElementById("lb-core-style")) {
    const s = document.createElement("style");
    s.id = "lb-core-style";
    s.textContent = `
      .lb-preview{ display:none !important; position:relative; }
      .lb-preview.show{ display:block !important; }
      .lb-preview-img{ display:block; width:100%; height:auto; border-radius:12px; }
      .lb-preview .glass{ position:absolute; inset:0; pointer-events:none; }
    `;
    document.head.appendChild(s);
  }

  // 왼쪽 프리뷰 + 오른쪽 리스트
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

  const bodyEl     = root.querySelector("#lb-body");
  const previewBox = root.querySelector("#lb-preview");
  const previewImg = root.querySelector(".lb-preview-img");

  function showPreview(thumb) {
    if (!previewBox || !previewImg) return; // 안전 가드
    if (thumb) {
      previewImg.src = thumb;
      previewBox.classList.add("show");
      previewBox.setAttribute("aria-hidden", "false");
    } else {
      previewImg.removeAttribute("src");
      previewBox.classList.remove("show");
      previewBox.setAttribute("aria-hidden", "true");
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
        row.setAttribute("tabindex", "0");
        row.innerHTML = `
          <div class="lb-rank">${i + 1}</div>
          <div class="lb-name">${safe(r.name || "Player")}</div>
          <div class="lb-score">${Number(r.score).toLocaleString()}</div>
        `;
        const hover = () => showPreview(r.thumb_data || null); // (1) 캐릭터 썸네일 있으면 그거, 없으면 캡처가 이미 저장돼 있음
        row.addEventListener("mouseenter", hover);
        row.addEventListener("focusin", hover);
        frag.appendChild(row);
      });
      bodyEl.appendChild(frag);

      // 초기 상태는 항상 숨김
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
