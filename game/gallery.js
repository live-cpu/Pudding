// /game/gallery.js
import { listUploads } from "./gdatabase.js";

export function initGallerySimple({ mount, pageSize = 12, onPick, onApply }){
  if (!mount) throw new Error("gallery mount 요소가 필요합니다.");
  const cb = onPick || onApply;  // ← 둘 중 하나만 있어도 호출

  mount.innerHTML = `
    <div class="gal-grid"></div>
    <div class="gal-more"><button class="btn-more">더보기</button></div>
  `;
  const grid = mount.querySelector(".gal-grid");
  const btnMore = mount.querySelector(".btn-more");

  let state = { cursor: null, loading: false, pageSize };

  async function loadMore(){
    if (state.loading) return;
    state.loading = true;
    btnMore.disabled = true; btnMore.textContent = "불러오는 중...";
    try{
      const { rows, nextCursor } = await listUploads({ limit: state.pageSize, cursor: state.cursor });
      if (!rows.length && !state.cursor){
        grid.innerHTML = `<div class="gal-empty">아직 항목이 없어요.</div>`;
      }
      rows.forEach(row=>{
        const el = document.createElement("button");
        el.className = "gal-card";
        el.innerHTML = `
          <div class="gal-frame"><img src="${row.public_url}" alt="${row.path}" loading="lazy"/></div>
          <div class="title">${row.path.split("/").pop()}</div>
        `;
        el.addEventListener("click", ()=> cb?.({ url: row.public_url, row })); // ← 반드시 호출
        grid.appendChild(el);
      });
      state.cursor = nextCursor;
      if (!nextCursor){ btnMore.disabled = true; btnMore.textContent = "더 없음"; }
      else { btnMore.disabled = false; btnMore.textContent = "더보기"; }
    }catch(err){
      console.error(err);
      alert("갤러리 로딩 실패: " + err.message);
      btnMore.disabled = false; btnMore.textContent = "다시 시도";
    }finally{
      state.loading = false;
    }
  }

  btnMore.addEventListener("click", loadMore);
  loadMore();

  return { reload(){
    state.cursor = null;
    grid.innerHTML = "";
    loadMore();
  }};
}
