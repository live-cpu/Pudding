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

// --- URL normalizer (중복 public URL 방지)
function normalizeSupabaseUrl(u){
  if (typeof u !== "string") return ""; // ✅ 이벤트 같은 객체 들어오면 빈문자 처리
  const m = [...String(u || '').matchAll(
    /https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/[^?#]+/g
  )];
  return m.length ? m.at(-1)[0] : u;
}

// --- 현재 플레이어 스킨 URL (썸네일 생성용)
let CURRENT_SKIN_URL = null;

// --- Apply-menu 스타일 주입
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

const leftMount  = document.getElementById('leftMount');
const rightMount = document.getElementById('rightMount');
const fileInput  = document.getElementById('fileInput');

const btnUpload    = document.getElementById('btnUpload');
const btnDownload  = document.getElementById('btnDownload');
const btnStore     = document.getElementById('btnStore');
const btnBgToggle  = document.getElementById('btnBgToggle');
const btnDino      = document.getElementById('btnDino');

let dino = null;
let inDino = false;

const jelly  = new JellyScene(leftMount);
const player = new PlayerScene(rightMount);

// --- Ghost layer ---
const ghost = new GhostLayer(player);
player.app.stage.sortableChildren = true;
ghost.layer.zIndex = (player.bgLayer?.zIndex ?? 0) + 1;

// ★ 플레이어 콜라이더 연결
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
  } catch(e){ console.error('[spawnGhost] failed:', e); }
};

// --- Backgrounds ---
const BG1 = new URL('./back.jpg',  import.meta.url).href;
const BG2 = new URL('./back2.jpg', import.meta.url).href;
let bgIndex = 0;
player.setBackground(BG1);

// --- Resize ---
addEventListener('resize', () => { jelly.resize(); player.resize(); });

// --- Dino ---
if (btnDino){
  btnDino.addEventListener('click', ()=>{
    if (!inDino){
      if (!dino) {
        dino = new DinoGame(player);
        dino.onGameOver = async ({ score }) => {
          await showScoreUploadDialog(score);
        };
      }
      dino.start();
      player.setExternalControl(true);
      ghost?.setEnabled?.(false);
      btnDino.textContent = '디노 종료';
      inDino = true;
    } else {
      dino.stop();
      player.setExternalControl(false);
      ghost?.setEnabled?.(true);
      btnDino.textContent = '게임';
      inDino = false;
    }
  });
}

// --- Upload flow ---
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

    await jelly.setImage(lastURL);
    await player.setPlayerTexture(lastURL);
    CURRENT_SKIN_URL = lastURL;           // ✅ 현재 스킨 기억

    btnDownload.disabled = false;
    btnStore.disabled = false;
    toast('업로드 완료!');
  }catch(err){
    console.error('[upload error]', err);
    alert('이미지 업로드/적용 중 오류가 발생했어요.\n콘솔을 확인해 주세요.');
  }
});

// --- Background toggle ---
if (btnBgToggle){
  btnBgToggle.addEventListener('click', async ()=>{
    bgIndex ^= 1;
    await player.setBackground(bgIndex ? BG2 : BG1);
    btnBgToggle.textContent = bgIndex ? '배경전환(2)' : '배경전환(1)';
  });
}

// --- Recorder modal ---
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

// --- Recorder ---
const WORKER =
  location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.port === "5173"
    ? "/game/gif.worker.js"   // ✅ 로컬 개발서버 (같은 origin)
    : "./gif.worker.js";      // ✅ 깃허브 / Vercel / 확장 배포

recStart.addEventListener('click', async ()=> {
  btnDownload.disabled = true;
  recDot.classList.remove('hidden'); // 시작 시 빨간 점
  recModal.classList.add('hidden');
  let srcCanvas, filename, renderScene, before = ()=>{}, after = ()=>{};

  if (selected.side === 'left') {
    srcCanvas   = jelly.app.view;
    filename    = 'jelly.gif';
    renderScene = ()=> jelly.app.renderer.render(jelly.app.stage);
  } else {
    srcCanvas   = player.app.view;
    filename    = 'player.gif';
    renderScene = ()=> player.app.renderer.render(player.app.stage);

    if (selected.bg === 'chroma') {
      const v1 = player.bgLayer.visible, v2 = player.groundGfx.visible;
      before = ()=>{ player.bgLayer.visible=false; player.groundGfx.visible=false; };
      after  = ()=>{ player.bgLayer.visible=v1;    player.groundGfx.visible=v2;    };
    }
  }

  await recordGIF(srcCanvas, {
    fps: 30, sec: 5, filename, mode: selected.bg
  }, renderScene, before, after);

  btnDownload.disabled = false;
});

function recordGIF(sourceCanvas, { fps=30, sec=5, filename='download.gif', mode='bg' },
                   renderScene=()=>{}, before=()=>{}, after=()=>{}) {
  return new Promise((resolve) => {
    const off = document.createElement('canvas');
    off.width  = sourceCanvas.width;
    off.height = sourceCanvas.height;
    const ctx = off.getContext('2d', { willReadFrequently:true });

    const transparentColor = (mode === 'chroma') ? 0x00FF00 : null;

    const gif = new GIF({
      workers: 2,
      quality: 10,
      workerScript: WORKER,
      transparent: transparentColor
    });

    const delay = 1000 / fps, total = Math.round(fps * sec);
    let i = 0;

    before();

    const timer = setInterval(() => {
      renderScene();

      if (mode === 'chroma') {
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(0, 0, off.width, off.height);
      } else {
        ctx.clearRect(0, 0, off.width, off.height);
      }

      ctx.drawImage(sourceCanvas, 0, 0);
      gif.addFrame(off, { copy:true, delay });

      if (++i >= total) {
        clearInterval(timer);
        after();

        gif.on('finished', blob => {
          recDot.classList.add('hidden'); // 종료 시 숨기기
          const a = document.createElement('a');
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        });

        gif.render();
      }
    }, delay);
  });
}

// --- Supabase upload ---
if (!SUPA_OK) {
  btnStore.disabled = true;
  const gal = document.getElementById('gallery');
  if (gal) gal.innerHTML = '<div class="gal-empty">Supabase 키가 설정되지 않아 갤러리를 표시할 수 없습니다.</div>';
}

// --- 모달 생성 ---
function showUploadModal(onSubmit) {
  // 기존 있으면 제거
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
    if (!name) {
      alert('검색용 이름을 입력해주세요');
      return;
    }
    onSubmit({ name, pw });
    modal.remove();
  };

  modal.querySelector('#uploadCancel').onclick = () => {
    modal.remove();
  };
}

// --- 버튼 이벤트 교체 ---
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

// --- apply bridges ---
window.applyBackgroundFromURL = async (id, pw="")=>{
  try {
    const fresh = await requestSignedUrl(id, pw);   // ✅ 수정됨
    await player.setBackground(fresh);
    if (btnBgToggle){ btnBgToggle.textContent = '배경전환'; }
    bgIndex = -1;
  } catch(e) {
    console.error("[applyBackgroundFromURL]", e);
    alert("배경 적용 실패: " + (e.message || e));
  }
};

window.applyPlayerSkinFromURL = async (id, pw="")=>{
  try {
    const fresh = await requestSignedUrl(id, pw);   // ✅ 수정됨
    await player.setPlayerTexture(fresh);
    CURRENT_SKIN_URL = fresh;
    toast("플레이어 스킨 적용됨");
  } catch(e) {
    console.error("[applyPlayerSkinFromURL]", e);
    alert("스킨 적용 실패: " + (e.message || e));
  }
};

// --- apply menu ---
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
        await player.setBackground(fresh);
        if (btnBgToggle){ btnBgToggle.textContent = '배경전환'; }
        bgIndex = -1;

      } else if (act === 'player') {
        const fresh = await requestSignedUrl(id, pw);
        await player.setPlayerTexture(fresh);
        CURRENT_SKIN_URL = fresh;
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

// --- gallery + scoreboard ---
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
  // 갤러리 먼저
  if (galleryMount) {
    await mountGallery(galleryMount, (id, pw="") => openApplyMenu(id, pw));
  }
  // 점수판 나중에
  scoreboard = await mountLeaderboard(scoreboardMount, { limit: 100 });
})();

// --- 점수 업로드 모달 ---
// --- 점수 업로드 모달 --- (스티커 스타일)
async function showScoreUploadDialog(score){
  const prevName = localStorage.getItem('playerName') || '';

  // 썸네일: 플레이어 스킨 이미지가 있으면 그걸, 없으면 캔버스 스냅샷
  let thumb = null;
  if (CURRENT_SKIN_URL) {
    try { thumb = await imageUrlToThumbDataURL(CURRENT_SKIN_URL, 96); }
    catch { thumb = null; }
  }
  if (!thumb) thumb = canvasToThumbDataURL(player.app.view, 96);

  // 기존 모달 있으면 제거
  document.getElementById('scoreModal')?.remove();

  // 오버레이 + 카드
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

// --- toast ---
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

/* ===== Electric border + crown helper ===== */
/* ===== Electric border + crown helper ===== */
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
  svg.style.display = 'none';            // ← 기본은 숨김!
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

/* ===== scoreboard 연결: hover한 행 기준으로 미리보기 장식 ===== */
/* ===== scoreboard 연결: hover 기준 장식 ===== */
(function attachAwardsElectric(){
  const scb = document.getElementById('scoreboard');
  if (!scb) return;

  const getPreviewImg = () =>
    scb.querySelector('.rank-left img') ||
    scb.querySelector('.lb-awards img') ||
    scb.querySelector('.rank-left .panel img');

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
      toggleElectric(wrap, true);     // 전기 ON
      setCrownFor(wrap, true);        // 👑 ON
    } else {
      toggleElectric(wrap, false);    // 전기 OFF
      setCrownFor(wrap, false);       // 👑 OFF
    }
  });

  scb.addEventListener('mouseleave', ()=>{
    const pvImg = getPreviewImg();
    const wrap = pvImg?.closest('.lb-electric-wrap');
    toggleElectric(wrap, false);
    setCrownFor(wrap, false);
  });
})();
