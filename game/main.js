// /game/main.js
import { JellyScene }  from './jellyScene.js';
import { PlayerScene } from './playerScene.js';
import { DinoGame }    from './dgame.js';
import { requestSignedUrl } from "./requestSignedUrl.js";

import {
  uploadMedia, SUPA_OK, submitScore,
  canvasToThumbDataURL, imageUrlToThumbDataURL
} from './gdatabase.js';
import { mountGallery } from './gallery.js';
import { GhostLayer } from './ghostLayer.js';
import { mountLeaderboard } from './scoreboard.js';

import { createRoomBack2Bridge } from './gameScene/back2/roomBridge.js';

/* =======================
   Texture slots & helpers
   ======================= */

// Jelly 텍스처 보관소 (soft/hard)
let JELLY_SOFT_TEX = null;   // PIXI.Texture
let JELLY_HARD_TEX = null;   // PIXI.Texture (알파 이진화+NEAREST)

// Player 텍스처 보관소 (soft/hard)
let PLAYER_SOFT_TEX = null;  // PIXI.Texture
let PLAYER_HARD_TEX = null;  // PIXI.Texture (알파 이진화+NEAREST)

// URL→PIXI.Texture (soft)
async function loadPixiTextureFromURL(url){
  const tex = await PIXI.Texture.fromURL(url);
  return tex;
}

// 하드엣지 텍스처 생성기 (알파 임계+3×3 erode+NEAREST)
function makeHardEdgeTextureFromTexture(srcTex, { threshold=235, erode=true } = {}){
  try{
    const bt = srcTex.baseTexture;
    const w = bt.width|0, h = bt.height|0;
    if (!w || !h) return srcTex;

    const src = bt.resource?.source || bt.resource;
    if (!(src instanceof HTMLImageElement || src instanceof HTMLCanvasElement || src instanceof ImageBitmap || src instanceof OffscreenCanvas)){
      return srcTex; // 소스 못 얻으면 원본
    }

    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, w, h);

    // 알파 이진화
    let img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i=0;i<d.length;i+=4){
      d[i+3] = (d[i+3] < threshold) ? 0 : 255;
    }

    // 3×3 erode(경계 1px 정리)
    if (erode){
      const aOnly = new Uint8Array(w*h);
      for (let p=0,j=3;p<w*h;p++,j+=4) aOnly[p] = d[j];
      const out = new Uint8Array(w*h);
      for (let y=0;y<h;y++){
        for (let x=0;x<w;x++){
          let keep = 255;
          for (let yy=-1; yy<=1 && keep; yy++){
            const ny = y+yy; if (ny<0||ny>=h){ keep=0; break; }
            for (let xx=-1; xx<=1; xx++){
              const nx = x+xx; if (nx<0||nx>=w){ keep=0; break; }
              if (aOnly[ny*w+nx] === 0){ keep=0; break; }
            }
          }
          out[y*w+x] = keep;
        }
      }
      for (let p=0,j=3;p<w*h;p++,j+=4) d[j] = out[p];
    }

    ctx.putImageData(img, 0, 0);

    // NEAREST baseTexture
    const hardBT = new PIXI.BaseTexture(cvs, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    const hardTex = new PIXI.Texture(hardBT);
    return hardTex;
  }catch(e){
    console.warn('[HardEdge] fallback:', e);
    const t = new PIXI.Texture(srcTex.baseTexture);
    t.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    return t;
  }
}

// 한 번에 soft/hard 생성
async function buildTexturesFromURL(url){
  const soft = await loadPixiTextureFromURL(url);
  const hard = makeHardEdgeTextureFromTexture(soft, { threshold:235, erode:true });
  return { soft, hard };
}

// Jelly용 텍스처 준비
async function buildJellyTextures(url){
  const { soft, hard } = await buildTexturesFromURL(url);
  JELLY_SOFT_TEX = soft;
  JELLY_HARD_TEX = hard;
}

// URL normalizer (중복 public URL 방지)
function normalizeSupabaseUrl(u){
  if (typeof u !== "string") return "";
  const m = [...String(u || '').matchAll(
    /https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/[^?#]+/g
  )];
  return m.length ? m.at(-1)[0] : u;
}

// 현재 플레이어 스킨 URL (썸네일 생성용)
let CURRENT_SKIN_URL = null;


/* =============
   UI primitives
   ============= */

function ensureApplyMenuStyles(){
  if (document.getElementById('apply-menu-style')) return;
  const s = document.createElement('style');
  s.id = 'apply-menu-style';
  s.textContent = `
  .apply-menu{ position:fixed; inset:0; z-index:99999; display:grid; place-items:center; background:rgba(0,0,0,.35); }
  .apply-menu .panel{ background:#111; color:#eee; border-radius:16px; padding:14px; box-shadow:0 20px 60px rgba(0,0,0,.45); display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
  .apply-menu .am-btn{ appearance:none; border:0; border-radius:12px; padding:10px 14px; background:#242423; color:#fff; font-weight:800; cursor:pointer; }
  .apply-menu .am-btn:hover{ background:#5942D9; }
  `;
  document.head.appendChild(s);
}

function toast(msg){
  let box = document.getElementById("toast");
  if (!box){
    box = document.createElement("div");
    box.id = "toast";
    box.style.cssText = "position:fixed;right:16px;bottom:16px;background:#242423;color:#fff;padding:10px 14px;border-radius:12px;font:12px system-ui;z-index:9999;opacity:0;transition:.25s";
    document.body.appendChild(box);
  }
  box.textContent = msg;
  requestAnimationFrame(()=>{ box.style.opacity = "1"; });
  setTimeout(()=>{ box.style.opacity = "0"; }, 1600);
}


/* =========
   DOM refs
   ========= */

const leftMount  = document.getElementById('leftMount');
const rightMount = document.getElementById('rightMount');
const fileInput  = document.getElementById('fileInput');

const btnUpload    = document.getElementById('btnUpload');
const btnDownload  = document.getElementById('btnDownload');
const btnStore     = document.getElementById('btnStore');
const btnBgToggle  = document.getElementById('btnBgToggle');
const btnDino      = document.getElementById('btnDino');

const jelly  = new JellyScene(leftMount);
const player = new PlayerScene(rightMount);




// Jelly(왼쪽) 캔버스 픽셀 프로파일(하드엣지 보강)
jelly.app.view.style.imageRendering = 'pixelated';
jelly.app.renderer.roundPixels = true;


/* ============
   Ghost layer
   ============ */

const ghost = new GhostLayer(player);
player.app.stage.sortableChildren = true;
ghost.layer.zIndex = (player.bgLayer?.zIndex ?? 0) + 1;

// 플레이어 콜라이더 연결
ghost.attachPlayerCollider(() => {
  const { x, y } = player.player.position;
  const w = player.pw, h = player.ph;
  return { x: x - w/2, y: y - h/2, w, h };
}, { restitution: 0.0, friction: 0.25 });

// expose for console test
window.spawnGhost = async (url, opts={})=>{
  url = normalizeSupabaseUrl(url);
  ghost.layer.visible = true;
  ghost.layer.zIndex = 9999;
  try {
    await ghost.spawnFromURL(url, {
      sizePx: 140,
      verts: { x: 8, y: 8 },
      stiffness: 0.64,
      damping: 0.14,
      diag: true,
      kick: 0.004,
      spawnAt: 'floor',
      aiMove: { maxVX: 70, gain: 0.00005, clamp: 0.00045 },
      aiJump: { minMs: 900, maxMs: 1500, vMin: 5.5, vMax: 7.2, sideKick: 0.10 },
      stability: { pinEdgeK: 0.08 },
      ...opts
    });
   back2?.raiseOverlayToTop?.();
  } catch(e){ console.error('[spawnGhost] failed:', e); }
};


/* =========
   BG setup
   ========= */
// --- BG setup (main.js) ---

// 사용할 정적 배경 한 장만
const BG2 = new URL('./back2.jpg', import.meta.url).href;

// 브리지 생성
const back2 = createRoomBack2Bridge(player, {
  tilesetUrl: new URL('./gameScene/back2/assets/tileset.png', import.meta.url).href,
  groundImageUrl: BG2,      // 토글 시 쓸 이미지
  debug: false
});

// 초기엔 룸 모드 시작
(async () => {
  await back2.showRoom();
  if (btnBgToggle) btnBgToggle.textContent = '배경전환(2)'; // 다음 클릭=이미지
})();

// 버튼 토글
if (btnBgToggle) {
  btnBgToggle.onclick = async () => {
    console.log("토글 시작");
    await back2.toggle().then(() => console.log("토글 끝"));
    btnBgToggle.textContent = back2.isRoom ? '배경전환(2)' : '배경전환(1)';
	 
 	   // overlay 안전 가드 + 항상 최상단으로
   try { back2.raiseOverlayToTop?.(); } catch (_) {}
    if (window.__overlay && window.__overlay.layer) {
      window.__overlay.layer.visible = back2.isRoom;
    }

  };
}
/* =====
   Dino
   ===== */

let dino = null;
let inDino = false;
let prevMode = null; // ✅ 이전 모드 저장용

if (btnDino){
  btnDino.addEventListener('click', async ()=>{
    if (!inDino){
      if (window.__overlay) window.__overlay.layer.visible = true;
      // ✅ 현재 모드 저장
      prevMode = back2.isRoom ? 'room' : 'image';

      // 기존 배경 숨김 (존재할 때만)
     if (back2.layer) back2.layer.visible = false;
      if (back2.overlayLayer) back2.overlayLayer.visible = false;

      // Dino 생성
      if (!dino) {
        dino = new DinoGame(player);
        dino.onGameOver = async ({ score }) => { await showScoreUploadDialog(score); };
      }

      dino.start(); // 내부에서 Dino 전용 배경 생성
      player.setExternalControl(true);
      ghost?.setEnabled?.(false);

      btnDino.textContent = '디노 종료';
      inDino = true;

    } else {
      // Dino 종료
      dino.stop();
      player.setExternalControl(false);
      ghost?.setEnabled?.(true);

      // Dino 배경 제거
      dino.destroyBackground?.();

      // ✅ 이전 모드 복구
if (prevMode === 'room') {
  await back2.showRoom();
  if (window.__overlay && window.__overlay.layer) window.__overlay.layer.visible = true;
} else if (prevMode === 'image') {
  await back2.showImage(back2.lastImageUrl);
  if (window.__overlay && window.__overlay.layer) window.__overlay.layer.visible = false;
}


      btnDino.textContent = '게임';
      inDino = false;
    }
  });
}



/* ============
   Upload flow
   ============ */

let lastURL = null;
let LAST_UPLOAD_FILE = null;

btnUpload.addEventListener('click', ()=>{
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener('change', async (e)=>{
  try{
    const file = e.target.files?.[0];
    if (!file) return;

    if (lastURL) URL.revokeObjectURL(lastURL);
    lastURL = URL.createObjectURL(file);
    LAST_UPLOAD_FILE = file;

    // 텍스처 준비: 같은 소스를 쓰지만 슬롯은 독립 보관
    const { soft, hard } = await buildTexturesFromURL(lastURL);
    JELLY_SOFT_TEX  = soft;  JELLY_HARD_TEX  = hard;
    PLAYER_SOFT_TEX = soft;  PLAYER_HARD_TEX = hard;

    await jelly.setImage(JELLY_SOFT_TEX);   // 기본은 부드러운 텍스처
    await player.setPlayerTexture(lastURL); // 플레이어는 URL로
    CURRENT_SKIN_URL = lastURL;

    btnDownload.disabled = false;
    btnStore.disabled = false;
    toast('업로드 완료!');
  }catch(err){
    console.error('[upload error]', err);
    alert('이미지 업로드/적용 중 오류가 발생했어요.\n콘솔을 확인해 주세요.');
  }
});


/* ===============
   Recorder modal
   =============== */

const recModal  = document.getElementById('recModal');
const recStart  = document.getElementById('recStart');
const recCancel = document.getElementById('recCancel');
const optSideLeft  = document.getElementById('optSideLeft');
const optSideRight = document.getElementById('optSideRight');
const optBgWhite   = document.getElementById('optBgWhite');
const optBgChroma  = document.getElementById('optBgChroma');
const recDot       = document.getElementById('recDot');

btnDownload.addEventListener('click', ()=> recModal.classList.remove('hidden'));
recCancel  .addEventListener('click', ()=> recModal.classList.add('hidden'));

const selected = { side:null, bg:'bg' };
function pick(el, group, setter){
  group.forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  setter();
  recStart.disabled = !(selected.side && selected.bg);
}
optSideLeft .addEventListener('click', ()=>pick(optSideLeft,  [optSideLeft,optSideRight], ()=> selected.side='left'));
optSideRight.addEventListener('click', ()=>pick(optSideRight, [optSideLeft,optSideRight], ()=> selected.side='right'));
optBgWhite  .addEventListener('click', ()=>pick(optBgWhite,   [optBgWhite,optBgChroma],  ()=> selected.bg='bg'));
optBgChroma .addEventListener('click', ()=>pick(optBgChroma,  [optBgWhite,optBgChroma],  ()=> selected.bg='chroma'));


/* ==========
   Recorder
   ========== */

const WORKER =
  location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.port === "5173"
    ? "/game/gif.worker.js"
    : "./gif.worker.js";

recStart.addEventListener('click', async ()=> {
  btnDownload.disabled = true;
  recDot.classList.remove('hidden');
  recModal.classList.add('hidden');

  let srcCanvas, filename, renderScene, before = ()=>{}, after = ()=>{};

  if (selected.side === 'left') {
    // --- LEFT: Jelly ---
    srcCanvas   = jelly.app.view;
    filename    = 'jelly.gif';
    renderScene = ()=> jelly.app.renderer.render(jelly.app.stage);

    jelly.app.view.style.imageRendering = 'pixelated';
    jelly.app.renderer.roundPixels = true;

    if (selected.bg === 'chroma') {
      const prev = JELLY_SOFT_TEX || null;
      before = async ()=>{ if (JELLY_HARD_TEX) await jelly.setImage(JELLY_HARD_TEX); };
      after  = async ()=>{ if (prev)          await jelly.setImage(prev);           };
    }

  } else {
    // --- RIGHT: Player ---
    srcCanvas   = player.app.view;
    filename    = 'player.gif';
    renderScene = ()=> player.app.renderer.render(player.app.stage);

    if (selected.bg === 'chroma') {
      const v1 = player.bgLayer.visible, v2 = player.groundGfx.visible;

      before = async ()=>{
        // 1) 배경/땅 Off (크로마 배경만)
        player.bgLayer.visible = false;
        player.groundGfx.visible = false;

        // 2) 하드엣지 텍스처 스왑 (URL-only 구현 대비 fallback)
        if (PLAYER_HARD_TEX) {
          const src = PLAYER_HARD_TEX.baseTexture?.resource?.source;
          try {
            if (src && typeof src.toDataURL === 'function') {
              await player.setPlayerTexture(src.toDataURL());
            } else {
              await player.setPlayerTexture(PLAYER_HARD_TEX);
            }
          } catch(_) {}
        }

        // 3) NEAREST + roundPixels
        try { PLAYER_HARD_TEX.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST; } catch(_) {}
        player.app.renderer.roundPixels = true;
        if (player.player) player.player.roundPixels = true;
      };

      after = async ()=>{
        // 1) 배경/땅 복구
        player.bgLayer.visible = v1;
        player.groundGfx.visible = v2;

        // 2) 소프트 텍스처로 원복
        if (PLAYER_SOFT_TEX) {
          const src = PLAYER_SOFT_TEX.baseTexture?.resource?.source;
          try {
            if (src && typeof src.toDataURL === 'function') {
              await player.setPlayerTexture(src.toDataURL());
            } else {
              await player.setPlayerTexture(PLAYER_SOFT_TEX);
            }
          } catch(_) {}
        }

        // 3) 스무딩 복구
        try { PLAYER_SOFT_TEX.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; } catch(_) {}
        player.app.renderer.roundPixels = false;
        if (player.player) player.player.roundPixels = false;
      };
    }
  }

const preRollFrames =
  (selected.side === 'left') ? 24 : 0;   // ← 젤리만 프리롤 10프레임

await recordGIF(
  srcCanvas,
  { fps: 30, sec: 5, filename, mode: selected.bg, preRoll: preRollFrames },
  renderScene,
  before,
  after
);

  btnDownload.disabled = false;
});

// 변경된 시그니처 (preRoll 추가, 기본 0)
function recordGIF(
  sourceCanvas,
  { fps=30, sec=5, filename='download.gif', mode='bg', preRoll=0 },
  renderScene=()=>{}, before=()=>{}, after=()=>{}
){
  return new Promise((resolve) => {
    const off = document.createElement('canvas');
    off.width  = sourceCanvas.width;
    off.height = sourceCanvas.height;
    const ctx = off.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled = false;

    const CHROMA_HEX = 0x00FE00;
    const CHROMA_STR = '#00FE00';
    const transparentColor = (mode === 'chroma') ? CHROMA_HEX : null;

    const gif = new GIF({
      workers: 2,
      quality: 2,
      workerScript: WORKER,
      repeat: 0,
      dispose: 2,
      transparent: transparentColor,
      background: (mode === 'chroma') ? CHROMA_STR : '#FFFFFF',
      dither: false
    });

    const delay = 1000 / fps;
    const total = Math.round(fps * sec);
    let i = 0;                // 캡처된 프레임 카운트
    let warm = Math.max(0, preRoll|0); // 프리롤 프레임 남은 수

    Promise.resolve(before()).then(() => {
      const timer = setInterval(() => {
        // 물리/장면은 계속 진행
        renderScene();

        // 프리롤 구간은 캡처 스킵
        if (warm > 0) { warm--; return; }

        // ----- 여기부터 실제 캡처 -----
        ctx.globalCompositeOperation = 'copy';
        ctx.fillStyle = (mode === 'chroma') ? CHROMA_STR : '#FFFFFF';
        ctx.fillRect(0, 0, off.width, off.height);
        ctx.globalCompositeOperation = 'source-over';

        ctx.drawImage(sourceCanvas, 0, 0);

        if (mode === 'chroma') {
          let img = ctx.getImageData(0, 0, off.width, off.height);
          const d = img.data, W = off.width, H = off.height;
          const T = 235;

          for (let p = 0; p < d.length; p += 4) {
            const a = d[p + 3];
            if (a < T) { d[p]=0; d[p+1]=254; d[p+2]=0; d[p+3]=255; }
            else { d[p+3] = 255; }
          }

          const aOnly = new Uint8Array(W * H);
          for (let y=0, idx=0; y<H; y++){
            for (let x=0; x<W; x++, idx++){
              aOnly[idx] = d[idx*4 + 3];
            }
          }
          const out = new Uint8Array(W * H);
          for (let y=0, idx=0; y<H; y++){
            for (let x=0; x<W; x++, idx++){
              let keep = 255;
              for (let yy=-1; yy<=1 && keep; yy++){
                const ny = y+yy; if (ny<0||ny>=H){ keep=0; break; }
                for (let xx=-1; xx<=1; xx++){
                  const nx = x+xx; if (nx<0||nx>=W){ keep=0; break; }
                  if (aOnly[ny*W+nx] === 0){ keep=0; break; }
                }
              }
              out[idx] = keep;
            }
          }
          for (let y=0, idx=0; y<H; y++){
            for (let x=0; x<W; x++, idx++){
              if (out[idx] === 0){
                const p = idx*4;
                d[p]=0; d[p+1]=254; d[p+2]=0; d[p+3]=255;
              }
            }
          }
          ctx.putImageData(img, 0, 0);
        }

        gif.addFrame(off, { copy:true, delay, dispose: 2 });
        i++;

        if (i >= total) {
          clearInterval(timer);
          Promise.resolve(after()).then(() => {
            gif.on('finished', blob => {
              recDot.classList.add('hidden');
              const a = document.createElement('a');
              const url = URL.createObjectURL(blob);
              a.href = url;
              a.download = filename;
              a.click();
              URL.revokeObjectURL(url);
              resolve();
            });
            gif.render();
          });
        }
      }, delay);
    });
  });
}


/* ==================
   Supabase upload UI
   ================== */

if (!SUPA_OK) {
  btnStore.disabled = true;
  const gal = document.getElementById('gallery');
  if (gal) gal.innerHTML = '<div class="gal-empty">Supabase 키가 설정되지 않아 갤러리를 표시할 수 없습니다.</div>';
}

function showUploadModal(onSubmit) {
  const old = document.getElementById('uploadModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'uploadModal';
  modal.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.6); z-index:9999;
  `;

  modal.innerHTML = `
    <div style="
      background:#111; color:#fff; padding:24px; border-radius:12px;
      width:300px; max-width:90%; font-family:system-ui;
    ">
      <h3 style="margin:0 0 16px;font-size:18px;font-weight:700">업로드 옵션</h3>
      <label style="display:block;font-size:14px;margin-bottom:6px;">nsfw및 저작권이미지는 예고없이 삭제됩니다.</label>
      <label style="display:block;font-size:14px;margin-bottom:6px;"> ---------------------------------------------------  </label>

      <label style="display:block;font-size:14px;margin-bottom:6px;">검색용 이름</label>
      <input id="uploadName" type="text" placeholder="입력하기" style="
        width:100%;padding:8px 10px;margin-bottom:14px;
        border:1px solid #666;border-radius:8px;background:#000;color:#fff;
      ">
      <label style="display:block;font-size:14px;margin-bottom:6px;">비밀번호</label>
      <input id="uploadPw" type="password" placeholder="입력하기(없으면공개)" style="
        width:100%;padding:8px 10px;margin-bottom:18px;
        border:1px solid #666;border-radius:8px;background:#000;color:#fff;
      ">
      <div style="display:flex;gap:12px;justify-content:center">
        <button id="uploadCancel" class="upload-btn">X</button>
        <button id="uploadOk" class="upload-btn">O</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#uploadOk').onclick = () => {
    const name = modal.querySelector('#uploadName').value.trim();
    const pw   = modal.querySelector('#uploadPw').value.trim();
    if (!name) { alert('검색용 이름을 입력해주세요'); return; }
    onSubmit({ name, pw });
    modal.remove();
  };

  modal.querySelector('#uploadCancel').onclick = () => { modal.remove(); };
}

btnStore.addEventListener('click', () => {
  showUploadModal(async ({ name, pw }) => {
    try {
      if (!LAST_UPLOAD_FILE) {
        alert("먼저 이미지를 업로드하세요!");
        return;
      }
      await uploadMedia(LAST_UPLOAD_FILE, {
        bucket: "images",
        title: name,
        password: pw
      });
      toast("업로드 완료!");
      document.getElementById("gal-refresh")?.click();
    } catch (err) {
      console.error(err);
      alert("업로드 실패: " + err.message);
    }
  });
});


/* ===============
   Apply bridges
   =============== */

window.applyBackgroundFromURL = async (id, pw="")=>{
  try {
    const fresh = await requestSignedUrl(id, pw);
    await back2.showImage(fresh);   // 브리지 통해 이미지 모드 진입
    if (btnBgToggle) btnBgToggle.textContent = '배경전환(1)'; // 다음 클릭은 게임씬

  } catch(e) {
    console.error("[applyBackgroundFromURL]", e);
    alert("배경 적용 실패: " + (e.message || e));
  }
};

window.applyPlayerSkinFromURL = async (id, pw="")=>{
  try {
    const fresh = await requestSignedUrl(id, pw);
    await player.setPlayerTexture(fresh);
    CURRENT_SKIN_URL = fresh;

    // 플레이어 텍스처 슬롯도 최신화(서명 URL로 재다운로드 필요시 교체 권장)
    try {
      const { soft, hard } = await buildTexturesFromURL(fresh);
      PLAYER_SOFT_TEX = soft;
      PLAYER_HARD_TEX = hard;
    } catch(_) {}

    toast("플레이어 스킨 적용됨");
  } catch(e) {
    console.error("[applyPlayerSkinFromURL]", e);
    alert("스킨 적용 실패: " + (e.message || e));
  }
};

// gallery → mountGallery(galleryMount, (id, pw) => openApplyMenu(id, pw))
function openApplyMenu(id, pw="") {
  pw = String(pw || "");
  ensureApplyMenuStyles();
  document.querySelectorAll('.apply-menu').forEach(el => el.remove());

  const wrap = document.createElement('div');
  wrap.className = 'apply-menu';
  wrap.innerHTML = `
    <div class="panel">
      <button class="am-btn" data-act="bg">배경</button>
      <button class="am-btn" data-act="player">플레이어</button>
      <button class="am-btn" data-act="ghost">가상플레이어(물리)</button>
      <button class="am-btn" data-act="close">닫기</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const close = ()=> wrap.remove();
 wrap.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.am-btn');
    if (!btn) return;
    const act = btn.dataset.act;

    try {
      if (act === 'close'){ close(); return; }

if (act === 'bg') {
  const fresh = await requestSignedUrl(id, pw);

  // 이미지 모드로 강제 전환
  await back2.showImage(fresh);
  back2.isRoom = false; // 상태 명시
  if (btnBgToggle) btnBgToggle.textContent = '배경전환(1)';
}
 else if (act === 'player') {
        const fresh = await requestSignedUrl(id, pw);
        await player.setPlayerTexture(fresh);
        CURRENT_SKIN_URL = fresh;

        try {
          const { soft, hard } = await buildTexturesFromURL(fresh);
          PLAYER_SOFT_TEX = soft;
          PLAYER_HARD_TEX = hard;
        } catch(_) {}
        toast("플레이어 스킨 적용됨");

      } else if (act === 'ghost') {
        const fresh = await requestSignedUrl(id, pw);
        await window.spawnGhost(fresh);
        toast('가상플레이어 스폰됨');
      }

    } catch(err) {
      console.error('[apply error]', err);
      alert('적용 실패: ' + err.message);
    } finally {
      close();
    }
  });
}


/* ==========================
   Gallery + Scoreboard mount
   ========================== */

const galleryMount = document.getElementById('gallery');
let scoreboard;
const scoreboardMount = document.getElementById('scoreboard') || (() => {
  const wrap = document.createElement('div');
  wrap.id = 'scoreboard';
  const parent = galleryMount?.parentNode || document.body;
  parent.insertBefore(wrap, galleryMount || null);
  return wrap;
})();

(async () => {
  if (galleryMount) await mountGallery(galleryMount, (id, pw="") => openApplyMenu(id, pw));
  scoreboard = await mountLeaderboard(scoreboardMount, { limit: 100 });
})();


/* ====================
   Score upload dialog
   ==================== */

async function showScoreUploadDialog(score){
  const prevName = localStorage.getItem('playerName') || '';

  // 썸네일: 플레이어 스킨 이미지가 있으면 그걸, 없으면 캔버스 스냅샷
  let thumb = null;
  if (CURRENT_SKIN_URL) {
    try { thumb = await imageUrlToThumbDataURL(CURRENT_SKIN_URL, 96); }
    catch { thumb = null; }
  }
  if (!thumb) thumb = canvasToThumbDataURL(player.app.view, 96);

  document.getElementById('scoreModal')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'scoreModal';
  wrap.innerHTML = `
    <div class="card">
      <div class="head">
        <img class="thumb" id="s-thumb" alt="thumb"/>
        <div>
          <h3>점수 업로드</h3>
          <div class="sub">이번 점수: <b>${score}</b></div>
        </div>
      </div>

      <input id="s-name" type="text" placeholder="이름" value="${prevName}" />

      <div class="actions">
        <button id="s-cancel" class="upload-btn">취소</button>
        <button id="s-ok" class="upload-btn">업로드</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('#s-thumb').src = thumb;

  return new Promise((resolve)=>{
    const close = ()=> wrap.remove();

    wrap.querySelector('#s-cancel').onclick = ()=>{ close(); resolve(null); };

    wrap.querySelector('#s-ok').onclick = async ()=>{
      const name = wrap.querySelector('#s-name').value.trim();
      if (!name){ alert('이름을 입력하세요'); return; }
      try{
        localStorage.setItem('playerName', name);
        await submitScore({ name, score, thumbData: thumb });
        toast('점수 업로드 완료!');
        scoreboard?.reload?.();
        close();
        resolve(true);
      }catch(e){
        alert('업로드 실패: ' + (e?.message || e));
      }
    };
  });
}


/* =========================================
   Electric border + crown (scoreboard hover)
   ========================================= */

let __elecId = 0;

function wrapAwardPreview(imgEl, opts = {}) {
  if (!imgEl) return null;
  const existing = imgEl.closest('.lb-electric-wrap');
  if (existing) return existing;

  const w = imgEl.clientWidth  || imgEl.naturalWidth  || 120;
  const h = imgEl.clientHeight || imgEl.naturalHeight || 120;

  const { color = '#FFD54A', thickness = 2, speed = 1, chaos = 0.5, radius = 16 } = opts;

  const wrap = document.createElement('div');
  wrap.className = 'lb-electric-wrap';
  wrap.style.borderRadius = radius + 'px';

  imgEl.parentNode.insertBefore(wrap, imgEl);
  wrap.appendChild(imgEl);

  const uid = `elec-${++__elecId}`;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = `
    <defs>
      <filter id="${uid}" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence id="${uid}-turb" type="fractalNoise"
          baseFrequency="${0.02 + chaos * 0.03}" numOctaves="2" seed="2" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="${4 + chaos * 8}"/>
      </filter>
      <animate href="#${uid}-turb" attributeName="seed"
        values="0;50" dur="${(2 / Math.max(0.1, speed)).toFixed(2)}s"
        repeatCount="indefinite"/>
    </defs>
    <rect class="elec-stroke" x="1" y="1" width="${w-2}" height="${h-2}"
      rx="${radius}" ry="${radius}"
      stroke="${color}" stroke-width="${thickness}"
      filter="url(#${uid})"/>
  `;
  svg.style.display = 'none';
  wrap.appendChild(svg);

  new ResizeObserver(([entry])=>{
    const { width, height } = entry.contentRect;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const rect = svg.querySelector('rect');
    rect.setAttribute('width',  Math.max(2, width  - 2));
    rect.setAttribute('height', Math.max(2, height - 2));
  }).observe(imgEl);

  return wrap;
}

function toggleElectric(wrap, on){
  if (!wrap) return;
  const svg = wrap.querySelector('svg');
  if (svg) svg.style.display = on ? '' : 'none';
}

function setCrownFor(wrap, on) {
  if (!wrap) return;
  const cur = wrap.querySelector('.crown');
  if (on && !cur) {
    const c = document.createElement('div');
    c.className = 'crown';
    c.textContent = '👑';
    wrap.appendChild(c);
  } else if (!on && cur) {
    cur.remove();
  }
}

(function attachAwardsElectric(){
  const scb = document.getElementById('scoreboard');
  if (!scb) return;

  // 👇 프리뷰 IMG 탐색 우선순위: 최신 마크업 → 과거 호환
 const getPreviewImg = () => scb.querySelector('#lb-preview .lb-preview-img');

 // 혹시 스코어보드 밖에 남아있는 디버그 프리뷰가 있으면 정리
 document.querySelectorAll('.lb-preview').forEach(el => {
   if (!scb.contains(el)) el.remove();
 });

  scb.addEventListener('mouseover', e=>{
    const row = e.target.closest('.lb-row');
    if (!row) return;

    const rankText = row.querySelector('.lb-rank')?.textContent ?? row.children?.[0]?.textContent ?? '';
    const rank = parseInt(rankText.replace(/\D+/g,''), 10) || 0;

    const pvImg = getPreviewImg();
    if (!pvImg) return;

    let wrap = pvImg.closest('.lb-electric-wrap');

    if (rank === 1) {
      wrap = wrap || wrapAwardPreview(pvImg, { color:'#FFD54A', speed:1, chaos:0.5, thickness:2, radius:16 });
      toggleElectric(wrap, true);
      setCrownFor(wrap, true);
    } else {
      toggleElectric(wrap, false);
      setCrownFor(wrap, false);
    }
  });

  scb.addEventListener('mouseleave', ()=>{
    const pvImg = getPreviewImg();
    const wrap = pvImg?.closest('.lb-electric-wrap');
    toggleElectric(wrap, false);
    setCrownFor(wrap, false);
  });
})();
