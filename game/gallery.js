import { searchMedia, listMedia, displayName, getPublicUrl } from "./gdatabase.js";

/** 간단 디바운스 */
function debounce(fn, ms = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function mountGallery(root, onPickUrl) {
  const el = typeof root === "string" ? document.querySelector(root) : root;
  if (!el) throw new Error("gallery root element not found");

  el.innerHTML = `
  <div class="gallery-head" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
    <strong class="gal-title">Gallery</strong>

    <input id="gal-q" placeholder="이름으로 검색…"
      style="flex:1;min-width:120px;padding:6px 10px;
             border:1px solid #333;border-radius:10px;
             font:12px system-ui;background:transparent;color:#333;" />

    <button id="gal-refresh"
      style="padding:6px 10px;border-radius:10px;border:1px solid #333;
             background:transparent;color:#333;font-weight:600;cursor:pointer">
      Latest
    </button>
  </div>
  <div id="gal-list" style="column-count:5;column-gap:12px;"></div>
  `;

  const listEl = el.querySelector("#gal-list");
  const qInput = el.querySelector("#gal-q");

  async function drawRows(rows) {
  listEl.textContent = "";
  if (!rows.length) {
    listEl.textContent = "No media.";
    return;
  }

  for (const r of rows) {
    const card = document.createElement("div");
    card.className = "gal-card";
    card.style.cssText = `
      break-inside: avoid;
      margin-bottom:12px;
      border-radius:16px;
      overflow:hidden;
      position:relative;
      cursor:pointer;
    `;

    const isProtected = r.is_protected === true || r.is_protected === "true";

    if (isProtected) {
      // 🔒 보호된 경우
      const placeholder = document.createElement("div");
      placeholder.style.cssText = `
        width: 100%;
        padding-top: 70%;
        background: #F7DCA1;
      `;
      card.appendChild(placeholder);

      const lock = document.createElement("div");
      lock.textContent = "🔒";
      lock.style.cssText = `
        position:absolute; top:50%; left:50%;
        transform:translate(-50%, -50%);
        font-size:28px; color:#fff;
        text-shadow:-1px -1px 0 #000,1px -1px 0 #000,
                     -1px 1px 0 #000,1px 1px 0 #000;
        pointer-events:none;
      `;
      card.appendChild(lock);
    } else {
      // 🌐 공개된 경우 → 썸네일 우선
      const pub = getPublicUrl(r.thumb_path || r.path, r.bucket || "images");
      if (pub) {
        const img = new Image();
        img.src = pub;
        img.alt = r.path;
        img.className = "gal-thumb";
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);

        const grunge = document.createElement("div");
        grunge.className = "grunge-overlay";
        card.appendChild(grunge);
      }
    }

    // 📌 제목 (공개/보호 공통)
    const caption = document.createElement("div");
    caption.textContent = displayName(r);
    caption.style.cssText = `
      position:absolute; bottom:8px; left:50%;
      transform:translateX(-50%);
      color:#fff; font:600 14px system-ui; text-align:center;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      text-shadow:-1px -1px 0 #000,1px -1px 0 #000,
                   -1px 1px 0 #000,1px 1px 0 #000;
      pointer-events:none; max-width:90%;
    `;
    card.appendChild(caption);

    // 📌 클릭 핸들러
    card.onclick = async () => {
      try {
        let initialPassword = "";
        if (isProtected) {
          const v = prompt("비밀번호를 입력하세요");
          if (v == null) return;
          initialPassword = v;
        }
        await onPickUrl?.(r.id, String(initialPassword || ""));
      } catch (e) {
        alert(e?.message || e);
      }
    };

    listEl.appendChild(card);
  }
}



  async function showLatest() {
    listEl.textContent = "Loading...";
    try {
      const rows = await listMedia({ limit: 50 });
      await drawRows(rows);
    } catch (e) {
      listEl.textContent = e?.message || String(e);
    }
  }

  async function doSearch() {
    const kw = qInput.value.trim();
    listEl.textContent = "Searching...";
    try {
      const rows = await searchMedia(kw, { limit: 100 });
      await drawRows(rows);
    } catch (e) {
      listEl.textContent = e?.message || String(e);
    }
  }

  el.querySelector("#gal-refresh")?.addEventListener("click", showLatest);
  el.querySelector("#gal-search")?.addEventListener("click", doSearch);
  qInput.addEventListener("keydown", (e) => { if (e.key === "E	nter") doSearch(); });
  qInput.addEventListener("input", debounce(() => {
    if (qInput.value.trim().length >= 2) doSearch();
  }, 350));

  await showLatest();
}
