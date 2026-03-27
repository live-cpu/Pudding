import { searchMedia, listMedia, displayName, getPublicUrl, getSignedUrl } from "./gdatabase.js";

/** 간단 디바운스 */
function debounce(fn, ms=300){
  let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

export async function mountGallery(root, onPickUrl){
  const el = typeof root === "string" ? document.querySelector(root) : root;
  if (!el) throw new Error("gallery root element not found");

  el.innerHTML = `
  <div class="gallery-head" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
    <strong class="gal-title">Gallery</strong>

<input id="gal-q" placeholder="이름으로 검색…" 
  style="flex:1;min-width:120px;padding:6px 10px;
         border:1px solid #333;
         border-radius:10px;
         font:12px system-ui;
         background:transparent;
         color:#333;" />




    <button id="gal-refresh"
      style="padding:6px 10px;
             border-radius:10px;
             border:1px solid #333;
             background:transparent;
             color:#333;
             font-weight:600;
             cursor:pointer">
      Latest
    </button>
  </div>
  <div id="gal-list" style="column-count:5;column-gap:12px;"></div>
`;

  const listEl = el.querySelector("#gal-list");
  const qInput = el.querySelector("#gal-q");

  // ✅ drawRows는 한 번만 선언
  async function drawRows(rows){
    listEl.textContent = "";
    if (!rows.length){ 
      listEl.textContent = "No media."; 
      return; 
    }

    for (const r of rows){
      const card = document.createElement("div");
     card.className = "gal-card";
      card.style.cssText = `
        break-inside: avoid;
        margin-bottom:12px;
        border-radius:12px;
        overflow:hidden;
        border:none;
        background:#fff;
        cursor:pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position:relative;
      `;

      // ✅ 썸네일 (보호된 것도 표시)
      let url = await getSignedUrl(r.path, r.bucket || "images");
      if (!url) url = getPublicUrl(r.path, r.bucket || "images");

      if (url){
        const img = new Image();
img.src = url;
img.alt = r.path;
img.className = "gal-thumb"; // ✅ 클래스 붙이기
card.appendChild(img);

 const grunge = document.createElement("div");
  grunge.className = "grunge-overlay";
  card.appendChild(grunge);
}

      // 🔒 오버레이
      if (r.is_protected) {
        const overlay = document.createElement("div");
        overlay.textContent = "🔒";
        overlay.style.cssText = `
          position:absolute;
          top:8px; right:8px;
          background:rgba(0,0,0,0.6);
          color:#fff;
          font-size:14px;
          padding:2px 6px;
          border-radius:6px;
        `;
        card.appendChild(overlay);
      }

      // 제목
// 제목 (이미지 위에 오버레이)
const caption = document.createElement("div");
caption.textContent = displayName(r);
caption.style.cssText = `
  position:absolute;
  bottom:8px; left:50%;
  transform:translateX(-50%);
  color:#fff;
  font:600 14px system-ui;
  text-align:center;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  text-shadow:
    -1px -1px 0 #000,
     1px -1px 0 #000,
    -1px  1px 0 #000,
     1px  1px 0 #000;
  pointer-events:none; /* 클릭 막지 않음 */
`;
card.appendChild(caption);


      // --- 클릭 시 비밀번호 확인 ---
      card.onclick = async () => {
        try {
          let initialPassword = "";
          if (r.is_protected) {
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
    } // for
  } // drawRows

  async function showLatest(){
    listEl.textContent = "Loading...";
    try{
      const rows = await listMedia({ limit: 50 });
      await drawRows(rows);
    }catch(e){
      listEl.textContent = e?.message || String(e);
    }
  }

  async function doSearch(){
    const kw = qInput.value.trim();
    listEl.textContent = "Searching...";
    try{
      const rows = await searchMedia(kw, { limit: 100 });
      await drawRows(rows);
    }catch(e){
      listEl.textContent = e?.message || String(e);
    }
  }

  el.querySelector("#gal-refresh")?.addEventListener("click", showLatest);
  el.querySelector("#gal-search") ?.addEventListener("click", doSearch);
  qInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") doSearch(); });
  qInput.addEventListener("input", debounce(()=>{ if (qInput.value.trim().length >= 2) doSearch(); }, 350));

  await showLatest();
}
