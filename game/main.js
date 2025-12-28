// game/main.js
import { JellyScene }  from './jellyScene.js';
import { PlayerScene } from './playerScene.js';
import { DinoGame }    from './dgame.js';

import { uploadImage } from './gdatabase.js';
import { SUPA_OK }     from './gdatabase.js';
import { initGallerySimple } from './gallery.js';
import { GhostLayer } from './ghostLayer.js';

// --- URL normalizer (중복 public URL 방지)
function normalizeSupabaseUrl(u){
  const m = [...String(u || '').matchAll(
    /https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/[^?#]+/g
  )];
  return m.length ? m.at(-1)[0] : u;  // 마지막 매치만 사용 (중첩 제거)
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
let gallery = null;

const jelly  = new JellyScene(leftMount);
const player = new PlayerScene(rightMount);

// --- Ghost layer ---
const ghost = new GhostLayer(player);
player.app.stage.sortableChildren = true;
ghost.layer.zIndex = (player.bgLayer?.zIndex ?? 0) + 1;

// expose for console test
window.spawnGhost = async (url, opts={})=>{
  url = normalizeSupabaseUrl(url); // ✅ 중복 URL 정리
  console.log('[spawnGhost] call', url, opts);
  ghost.layer.visible = true;
  ghost.layer.zIndex = 9999;
  try { await ghost.spawnFromURL(url, { debug:true, ...opts }); }
  catch(e){ console.error('[spawnGhost] failed:', e); }
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
      if (!dino) dino = new DinoGame(player);
      dino.start();
      btnDino.textContent = '디노 종료';
      inDino = true;
    } else {
      dino.stop();
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

const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';

recStart.addEventListener('click', async ()=>{
  recModal.classList.add('hidden');
  btnDownload.disabled = true;
  recDot.classList.remove('hidden');

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
    fps:30, sec:5, filename,
    mode: selected.bg
  }, renderScene, before, after);

  recDot.classList.add('hidden');
  btnDownload.disabled = false;
});

function recordGIF(sourceCanvas, { fps=30, sec=5, filename='download.gif', mode='bg' },
                   renderScene=()=>{}, before=()=>{}, after=()=>{}){
  return new Promise((resolve)=>{
    const off = document.createElement('canvas');
    off.width  = sourceCanvas.width;
    off.height = sourceCanvas.height;
    const ctx = off.getContext('2d', { willReadFrequently:true });

    const transparentColor = (mode === 'chroma') ? 0x00FF00 : null;
    const gif = new GIF({
      workers: 2, quality: 10, workerScript: WORKER,
      transparent: transparentColor
    });

    const delay = 1000/fps, total = Math.round(fps*sec);
    let i = 0;

    before();

    const timer = setInterval(()=>{
      renderScene();

      if (mode === 'chroma') {
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(0,0,off.width,off.height);
      } else {
        ctx.clearRect(0,0,off.width,off.height);
      }

      ctx.drawImage(sourceCanvas, 0, 0);
      gif.addFrame(off, { copy:true, delay });

      if (++i >= total){
        clearInterval(timer);
        after();
        gif.on('finished', blob=>{
          const a = document.createElement('a');
          const url = URL.createObjectURL(blob);
          a.href = url; a.download = filename; a.click();
          URL.revokeObjectURL(url);
          resolve();
        });
        gif.render();
      }
    }, delay);
  });
}

// --- Supabase upload ---
const ENABLE_UPLOAD_PASSWORD = false;

// 💡 Supabase 키 없으면 버튼 비활성화 & 안내
if (!SUPA_OK) {
  btnStore.disabled = true;
  const gal = document.getElementById('gallery');
  if (gal) gal.innerHTML = '<div class="gal-empty">Supabase 키가 설정되지 않아 갤러리를 표시할 수 없습니다.</div>';
}

btnStore.addEventListener('click', async ()=>{
  if (!SUPA_OK) { alert('Supabase 키가 설정되지 않았습니다.'); return; }
  if (!LAST_UPLOAD_FILE){ alert('먼저 이미지를 업로드하세요!'); return; }
  try{
    let password = null;
    if (ENABLE_UPLOAD_PASSWORD){
      const v = prompt('이 이미지를 보호할 비밀번호(선택). 비우면 공개');
      password = v && v.trim() ? v.trim() : null;
    }
    await uploadImage(LAST_UPLOAD_FILE, 'player', { password });
    toast('업로드 완료!');
    if (gallery && typeof gallery.reload === 'function') gallery.reload();
  }catch(err){
    console.error(err);
    alert('업로드 실패: ' + err.message);
  }
});

// --- apply bridges ---
window.applyBackgroundFromURL = async (url)=>{
  url = normalizeSupabaseUrl(url); // ✅ 선택: 안전
  await player.setBackground(url);
  if (btnBgToggle){ btnBgToggle.textContent = '배경전환'; }
  bgIndex = -1;
};
window.applyPlayerSkinFromURL = async (url)=>{
  url = normalizeSupabaseUrl(url); // ✅ 선택: 안전
  await player.setPlayerTexture(url);
};

// --- apply menu ---
function openApplyMenu(url){
  url = normalizeSupabaseUrl(url); // ✅ 중복 URL 정리
  document.querySelectorAll('.apply-menu').forEach(el=>el.remove());

  const box = document.createElement('div');
  box.className = 'apply-menu';
  box.innerHTML = `
    <button class="am-btn" data-act="bg">배경</button>
    <button class="am-btn" data-act="player">플레이어</button>
    <button class="am-btn" data-act="ghost">가상플레이어(물리)</button>
    <button class="am-btn" data-act="close">닫기</button>
  `;
  document.body.appendChild(box);

  box.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.am-btn');
    if (!btn) return;
    const act = btn.dataset.act;

    console.log('[apply-menu]', act, url);

    if (act === 'close'){ box.remove(); return; }
    try{
      if (act === 'bg'){
        await window.applyBackgroundFromURL(url);
      } else if (act === 'player'){
        await window.applyPlayerSkinFromURL(url);
      } else if (act === 'ghost'){
        await ghost.spawnFromURL(url, {
          maxCols: 10, maxRows: 10,
          restitution: 0.28, damping: 0.02, stiffness: 0.62, diag: true,
          scaleFit: 0.6, kick: 0.015,
          debug: true
        });
        toast('가상플레이어 스폰됨');
      }
    }catch(err){
      console.error('[ghost spawn error]', err);
      alert('고스트 스폰 실패: ' + err.message);
    } finally {
      box.remove();
    }
  });
}

// --- gallery init ---
const galleryMount = document.getElementById('gallery');
gallery = galleryMount ? initGallerySimple({
  mount: galleryMount,
  pageSize: 12,
  onPick: ({ url }) => openApplyMenu(url)
}) : null;

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
