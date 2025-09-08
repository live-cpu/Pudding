// game/main.js
import { JellyScene }  from './jellyScene.js';
import { PlayerScene } from './playerScene.js';
import { DinoGame } from './dgame.js';


const leftMount  = document.getElementById('leftMount');
const rightMount = document.getElementById('rightMount');
const fileInput  = document.getElementById('fileInput');

const btnUpload    = document.getElementById('btnUpload');
const btnDownload  = document.getElementById('btnDownload');
const btnStore     = document.getElementById('btnStore');
const btnBgToggle  = document.getElementById('btnBgToggle'); // (있으면 사용)

const btnDino = document.getElementById('btnDino');
let dino = null;
let inDino = false;

if (btnDino){
  btnDino.addEventListener('click', ()=>{
    if (!inDino){
      if (!dino) dino = new DinoGame(player); // 업로드 스킨 자동 사용
      dino.start();
      btnDino.textContent = '디노 종료';
      inDino = true;
    } else {
      dino.stop();
      btnDino.textContent = '디노';
      inDino = false;
    }
  });
}

// ==== 씬 생성 ====
const jelly  = new JellyScene(leftMount);
const player = new PlayerScene(rightMount);

// 배경 이미지(토글용)
const BG1 = new URL('./back.jpg',  import.meta.url).href;
const BG2 = new URL('./back2.jpg', import.meta.url).href;
let bgIndex = 0;
player.setBackground(BG1);

// 리사이즈
addEventListener('resize', () => { jelly.resize(); player.resize(); });

// 업로드
let lastURL = null;
btnUpload.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  if(lastURL) URL.revokeObjectURL(lastURL);
  lastURL = URL.createObjectURL(file);

  await jelly.setImage(lastURL);          // 왼쪽 푸딩 텍스처
  await player.setPlayerTexture(lastURL); // 오른쪽 스킨 교체

  btnDownload.disabled = false;
});

// 배경 전환(선택사항)
if (btnBgToggle){
  btnBgToggle.addEventListener('click', async ()=>{
    bgIndex ^= 1;
    await player.setBackground(bgIndex ? BG2 : BG1);
    btnBgToggle.textContent = bgIndex ? '배경전환(2)' : '배경전환(1)';
  });
}

// ========= 레코더 옵션 모달 =========
const recModal  = document.getElementById('recModal');
const recStart  = document.getElementById('recStart');
const recCancel = document.getElementById('recCancel');
const optSideLeft  = document.getElementById('optSideLeft');
const optSideRight = document.getElementById('optSideRight');
// 버튼 표기는 '배경/투명'으로, id는 기존 그대로 사용
const optBgWhite   = document.getElementById('optBgWhite');   // → '배경'
const optBgChroma  = document.getElementById('optBgChroma');  // → '투명'
const recDot       = document.getElementById('recDot');

btnDownload.addEventListener('click', ()=> recModal.classList.remove('hidden'));
recCancel  .addEventListener('click', ()=> recModal.classList.add('hidden'));

// side: 'left' | 'right', bg: 'bg'(화면그대로) | 'chroma'(투명)
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

// ========= GIF 녹화 =========
// 로컬에 gif.worker.js 있어야 함
const WORKER = new URL('./gif.worker.js', import.meta.url).href;

recStart.addEventListener('click', async ()=>{
  recModal.classList.add('hidden');
  btnDownload.disabled = true;
  recDot.classList.remove('hidden');

  // 대상/강제렌더/전후 훅
  let srcCanvas, filename, renderScene, before = ()=>{}, after = ()=>{};

  if (selected.side === 'left') {
    srcCanvas   = jelly.app.view;
    filename    = 'jelly.gif';
    renderScene = ()=> jelly.app.renderer.render(jelly.app.stage);
    // 왼쪽은 배경 이미지가 따로 없으니 'bg'여도 화면(메쉬만) 그대로 캡처
  } else {
    srcCanvas   = player.app.view;
    filename    = 'player.gif';
    renderScene = ()=> player.app.renderer.render(player.app.stage);

    if (selected.bg === 'chroma') {
      // 투명 모드: 배경/바닥 숨기고 캐릭터만
      const v1 = player.bgLayer.visible, v2 = player.groundGfx.visible;
      before = ()=>{ player.bgLayer.visible=false; player.groundGfx.visible=false; };
      after  = ()=>{ player.bgLayer.visible=v1;    player.groundGfx.visible=v2;    };
    }
    // 배경 모드: 아무 것도 숨기지 않음 → 화면 그대로(선택된 back.jpg/back2.jpg 포함)
  }

  await recordGIF(srcCanvas, {
    fps:30, sec:5, filename,
    mode: selected.bg // 'bg' | 'chroma'
  }, renderScene, before, after);

  recDot.classList.add('hidden');
  btnDownload.disabled = false;
});

/**
 * mode:
 *  - 'bg'     : 화면 그대로(매트 없음, transparent=null)
 *  - 'chroma' : 크로마키(#00FF00) 투명 처리
 */
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
      // 최신 프레임을 먼저 WebGL로 그리게 함
      renderScene();

      // 배경 처리
      if (mode === 'chroma') {
        // 투명: 크로마키 칠한 뒤 합성
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(0,0,off.width,off.height);
      } else {
        // 배경: 화면 그대로 → 매트 없음
        ctx.clearRect(0,0,off.width,off.height);
      }

      // 화면 합성
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

// 자리만
btnStore.addEventListener('click', ()=> alert('저장소 업로드는 다음 단계에서 연결할게요 (Supabase/Firebase).'));
