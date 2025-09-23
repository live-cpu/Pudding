import { ensureOnnxMatteReady, requestOnnxMatte } from "./rmbg-web.js";

// rec.js — 객체/포지셔널 양쪽 호출 지원
// - transparent (크로마 투명)
// - preRollFrames / endTrimFrames / settleMs
// - hardEdge(이진화 + morphology, decontam 지원)  ← 기존 유지
// - auto upscale(작은 이미지 업스케일 → 처리 → 최근접 축소) ← 기존 유지
// - despill(녹색기운 감소), keyColor 변경, sharpen ← 기존 유지
// - ★ NEW: dualMatte (검정/흰 배경 두 번 캡처해 알파 복원 → 키색 합성)

const WORKER_CDN = "https://cdn.jsdelivr.net/npm/gif.js.optimized/dist/gif.worker.js";
const WORKER_FALLBACK_LOCAL = "./gif.worker.js";

/* ---------- 키색 ---------- */
function parseHex(css = "#00FE00") {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(css).replace(/^#/, ""));
  if (!m) return { hex: 0x00fe00, css: "#00FE00" };
  const v = parseInt(m[1], 16) >>> 0;
  return { hex: v, css: "#" + m[1].toUpperCase() };
}
let { hex: KEY_HEX, css: KEY_CSS } = parseHex("#00FE00");

/* ---------- 옵션 ---------- */
function getWorkerURL(override) {
  if (typeof override === "string" && override.trim()) return override;
  return WORKER_FALLBACK_LOCAL;
}

function normalizeArgs(arg3, arg4, arg5, arg6) {
  const defaults = {
    duration: 5000, fps: 12, scale: 1,
    transparent: false,
    workerScript: null, onProgress: null,

    // 루프 자연스러움
    preRollFrames: 0,
    endTrimFrames: 0,
    settleMs: 0,

    // hard edge (transparent:true일 때만 의미)
    hardEdge: {
      enabled: false,
      threshold: 215,           // 단일 임계(기본 경로)
      mode: "dilate",           // 'dilate' | 'erode' | 'none'
      iterations: 1,
      radius: 1,                // 1=3x3, 2=5x5
      // 듀얼 임계(히스테리시스) — decontam 경로에서 사용 가능
      thresholdHi: null,        // 예: 230
      thresholdLo: null         // 예: 205
    },

    // 자동 업스케일(처리 전용)
    autoProc: true,
    forceUpscaleBelow: 1024,
    maxProcScale: 8,

    // 업스케일 방식 + 경계 샤픈
    upscale: { method: "nearest", sharpen: 0 },

    // 디컨탐(선 투명, 후 키합성)
    transparentDecontam: true,
    unpremul: true,

    // 그린 디스필 제거
    despill: { enabled: false, greenBias: 20, strength: 0.5 },

    // 키색 변경
    keyColor: "#00FE00",

    // ★ dual matte (검정/흰 배경 두번 캡처해 알파 복원)
    dualMatte: false,
    dualMatteBg: { black: "#000000", white: "#FFFFFF" },
    // dual matte 결과를 GIF 단색투명에 맞추기 위한 이진 알파 컷오프
    dualMatteAlphaCut: null      // 기본 null → hardEdge.thresholdHi || threshold || 215 사용
  };

  if (arg3 && typeof arg3 === "object") {
    const o = { ...defaults, ...arg3 };
    o.hardEdge = { ...defaults.hardEdge, ...(arg3.hardEdge || {}) };
    o.upscale  = { ...defaults.upscale,  ...(arg3.upscale  || {}) };
    o.despill  = { ...defaults.despill,  ...(arg3.despill  || {}) };
    o.dualMatteBg = { ...defaults.dualMatteBg, ...(arg3.dualMatteBg || {}) };
    if (arg3.keyColor) {
      const k = parseHex(arg3.keyColor);
      KEY_HEX = k.hex; KEY_CSS = k.css;
    }
    if (arg3.hardEdge === false) o.hardEdge.enabled = false;
    if (arg3.hardEdge === true)  o.hardEdge.enabled = true;
    return o;
  }

  // 포지셔널: duration, fps, scale, transparent
  return {
    ...defaults,
    duration: arg3 ?? defaults.duration,
    fps: arg4 ?? defaults.fps,
    scale: arg5 ?? defaults.scale,
    transparent: arg6 ?? defaults.transparent
  };
}

/* ---------- 유틸 ---------- */
function unpremultiplyRGBA(data){
  for (let i=0; i<data.length; i+=4){
    const a = data[i+3];
    if (a > 0 && a < 255){
      const k = 255 / a;
      data[i]   = Math.min(255, data[i]   * k) | 0;
      data[i+1] = Math.min(255, data[i+1] * k) | 0;
      data[i+2] = Math.min(255, data[i+2] * k) | 0;
    }
  }
}

function applySharpen(ctx, w, h, amount = 1){
  if (!amount) return;
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);
  const a = Math.min(1.5, Math.max(0.2, amount));
  const W = w, H = h;
  for (let y=0; y<H; y++){
    for (let x=0; x<W; x++){
      let r=0,g=0,b=0;
      const i = (y*W + x)*4;
      const acc = (xx,yy, coef) => {
        if (xx<0||xx>=W||yy<0||yy>=H) return;
        const j = (yy*W + xx)*4;
        r += d[j]*coef; g += d[j+1]*coef; b += d[j+2]*coef;
      };
      acc(x, y, 1+4*a);
      acc(x-1, y, -a); acc(x+1, y, -a);
      acc(x, y-1, -a); acc(x, y+1, -a);
      out[i]   = Math.max(0, Math.min(255, r|0));
      out[i+1] = Math.max(0, Math.min(255, g|0));
      out[i+2] = Math.max(0, Math.min(255, b|0));
      out[i+3] = d[i+3];
    }
  }
  img.data.set(out); ctx.putImageData(img,0,0);
}

function applyDespill(ctx, w, h, { greenBias=20, strength=0.5 } = {}){
  if (!w || !h) return;
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data, N = w*h, s = Math.max(0, Math.min(1, strength));
  for (let i=0, j=0; i<N; i++, j+=4){
    const a = d[j+3]; if (a<255) continue;
    const r=d[j], g=d[j+1], b=d[j+2];
    const rbMax = Math.max(r,b);
    if (g > rbMax + greenBias){
      const target = rbMax;
      d[j+1] = (g*(1-s) + target*s) | 0;
    }
  }
  ctx.putImageData(img,0,0);
}

/* ---------- 하드엣지(초록배경 위) 기본 경로 ---------- */
function applyHardEdgeChroma(ctx, w, h, { threshold=230, mode="dilate", iterations=2, radius=1 } = {}) {
  if (!w || !h || mode === "none") return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data, N = w*h;

  // 알파 이진화 → 키색/불투명
  for (let i=0, j=0; i<N; i++, j+=4){
    const a = d[j+3];
    if (a < threshold){ d[j]=0; d[j+1]=254; d[j+2]=0; d[j+3]=255; }
    else { d[j+3]=255; }
  }
  if (iterations>0 && (mode==="dilate"||mode==="erode")){
    const mask = new Uint8Array(N);
    for (let i=0, j=0; i<N; i++, j+=4){
      const r=d[j], g=d[j+1], b=d[j+2];
      mask[i] = (r===0 && g===254 && b===0) ? 0 : 1;
    }
    const nxt = new Uint8Array(N);
    const R = Math.max(1, radius|0);
    for (let it=0; it<iterations; it++){
      let idx=0;
      for (let y=0; y<h; y++){
        for (let x=0; x<w; x++, idx++){
          if (mode==="dilate"){
            let m=mask[idx];
            if (!m){
              for (let yy=-R; yy<=R && !m; yy++){
                const ny=y+yy; if (ny<0||ny>=h) continue;
                for (let xx=-R; xx<=R; xx++){
                  const nx=x+xx; if (nx<0||nx>=w) continue;
                  if (mask[ny*w+nx]){ m=1; break; }
                }
              }
            }
            nxt[idx]=m;
          } else {
            let m=mask[idx]?1:0;
            if (m){
              for (let yy=-R; yy<=R && m; yy++){
                const ny=y+yy; if (ny<0||ny>=h){ m=0; break; }
                for (let xx=-R; xx<=R; xx++){
                  const nx=x+xx; if (nx<0||nx>=w){ m=0; break; }
                  if (!mask[ny*w+nx]){ m=0; break; }
                }
              }
            }
            nxt[idx]=m;
          }
        }
      }
      mask.set(nxt);
    }
    for (let i=0, j=0; i<N; i++, j+=4){
      if (mask[i]) d[j+3]=255;
      else { d[j]=0; d[j+1]=254; d[j+2]=0; d[j+3]=255; }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------- 하드엣지(디컨탐) 듀얼 임계 ---------- */
function hardEdgeDecontam(ctx, w, h, he = {}, unpremul=true) {
  if (!w || !h || he.mode === "none") return;
  const thresholdHi = (he.thresholdHi ?? he.threshold ?? 230)|0;
  const thresholdLo = (he.thresholdLo ?? Math.max(0, thresholdHi - 25))|0;
  const mode = he.mode || "dilate";
  const iterations = Math.max(0, he.iterations|0);
  const radius = Math.max(1, he.radius|0) || 1;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data, N = w*h;

  if (unpremul) unpremultiplyRGBA(d);

  const band = new Uint8Array(N); // 0 drop, 1 keep, 2 band
  for (let i=0, j=0; i<N; i++, j+=4){
    const a = d[j+3];
    band[i] = (a >= thresholdHi) ? 1 : (a < thresholdLo ? 0 : 2);
  }
  if (band.includes(2)) {
    const R = radius;
    for (let y=0, idx=0; y<h; y++){
      for (let x=0; x<w; x++, idx++){
        if (band[idx] !== 2) continue;
        let keep=0, cnt=0;
        for (let yy=-R; yy<=R; yy++){
          const ny=y+yy; if (ny<0||ny>=h) continue;
          for (let xx=-R; xx<=R; xx++){
            const nx=x+xx; if (nx<0||nx>=w) continue;
            const v = band[ny*w+nx];
            if (v!==2){ keep += (v===1); cnt++; }
          }
        }
        band[idx] = (cnt && keep/cnt >= 0.5) ? 1 : 0;
      }
    }
  }
  if (iterations>0 && (mode==="dilate"||mode==="erode")){
    const nxt = new Uint8Array(N);
    const R = radius;
    for (let it=0; it<iterations; it++){
      let idx=0;
      for (let y=0; y<h; y++){
        for (let x=0; x<w; x++, idx++){
          if (mode==="dilate"){
            let m = band[idx];
            if (!m){
              for (let yy=-R; yy<=R && !m; yy++){
                const ny=y+yy; if (ny<0||ny>=h) continue;
                for (let xx=-R; xx<=R; xx++){
                  const nx=x+xx; if (nx<0||nx>=w) continue;
                  if (band[ny*w+nx]) { m=1; break; }
                }
              }
            }
            nxt[idx]=m;
          } else {
            let m = band[idx]?1:0;
            if (m){
              for (let yy=-R; yy<=R && m; yy++){
                const ny=y+yy; if (ny<0||ny>=h){ m=0; break; }
                for (let xx=-R; xx<=R; xx++){
                  const nx=x+xx; if (nx<0||nx>=w){ m=0; break; }
                  if (!band[ny*w+nx]) { m=0; break; }
                }
              }
            }
            nxt[idx]=m;
          }
        }
      }
      band.set(nxt);
    }
  }

  for (let i=0, j=0; i<N; i++, j+=4){
    if (band[i]) d[j+3] = 255;
    else { d[j] = 0; d[j+1] = 254; d[j+2] = 0; d[j+3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------- dual matte: 검정/흰 두 캡처로 RGBA 복원 ---------- */
function solveDualMatteRGBA(blackRGBA, whiteRGBA) {
  const out = new Uint8ClampedArray(blackRGBA.length);
  for (let i=0;i<blackRGBA.length;i+=4){
    const rb = blackRGBA[i],   gb = blackRGBA[i+1], bb = blackRGBA[i+2];
    const rw = whiteRGBA[i],   gw = whiteRGBA[i+1], bw = whiteRGBA[i+2];
    // 채널별 알파 후보
    const aR = 1 - (rw - rb)/255;
    const aG = 1 - (gw - gb)/255;
    const aB = 1 - (bw - bb)/255;
    let a = Math.max(0, Math.min(1, Math.max(aR, aG, aB)));
    const fr = a > 1e-6 ? rb / a : 0;
    const fg = a > 1e-6 ? gb / a : 0;
    const fb = a > 1e-6 ? bb / a : 0;
    out[i]   = Math.max(0, Math.min(255, fr|0));
    out[i+1] = Math.max(0, Math.min(255, fg|0));
    out[i+2] = Math.max(0, Math.min(255, fb|0));
    out[i+3] = Math.max(0, Math.min(255, Math.round(a*255)));
  }
  return out;
}

/* ---------- 공통 그리기 유틸 ---------- */
const fillBg = (ctx, W, H, css) => {
  ctx.globalCompositeOperation = "copy";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
};
const clearAll = (ctx, W, H) => {
  ctx.globalCompositeOperation = "copy";
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
};

/* ---------- 메인 ---------- */
export function recordCanvas(canvas, filename = "capture.gif", arg3, arg4, arg5, arg6) {


let onnxReady = false;
let lastMatte = null;      // ImageData (alpha)
let matteBusy = false;     // 추론 중 플래그

async function tryInitOnnxIfNeeded(opts){
  if (onnxReady) return true;
  try {
    await ensureOnnxMatteReady(opts.onnx || {});
    onnxReady = true;
    return true;
  } catch(e){
    console.warn("[ONNX] init skipped:", e);
    return false;
  }
}

function applyAlphaOrChroma(ctx, w, h, alphaImgData, { binarize=220, keyCss="#00FE00" } = {}){
  // 현재 ctx의 RGB 위에 알파를 덮어씀 (binarize 있으면 0/255로)
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data, a = alphaImgData.data;
  for (let i=0; i<d.length; i+=4){
    const A = a[i+3];
    const AA = (binarize==null) ? A : (A >= binarize ? 255 : 0);
    if (AA === 0){
      // GIF 투명색과 충돌 적게: 크로마로 칠해주면 팔레트 일관성↑
      d[i]=0; d[i+1]=254; d[i+2]=0; d[i+3]=255; // #00FE00
    }else{
      d[i+3] = 255; // 완전 불투명
    }
  }
  ctx.putImageData(img, 0, 0);
}

  if (!canvas) return Promise.reject(new Error("[rec] canvas가 없습니다."));
  if (!window.GIF) return Promise.reject(new Error("[rec] gif.js가 로드되지 않았습니다."));


  const opts = normalizeArgs(arg3, arg4, arg5, arg6);
  const {
    duration, fps, scale, transparent, workerScript, onProgress,
    preRollFrames, endTrimFrames, settleMs, hardEdge,
    autoProc, forceUpscaleBelow, maxProcScale,
    transparentDecontam, unpremul,
    upscale, despill,
    dualMatte, dualMatteBg, dualMatteAlphaCut
  } = opts;

  const w = Math.max(2, Math.floor(canvas.width  * (scale ?? 1)));
  const h = Math.max(2, Math.floor(canvas.height * (scale ?? 1)));

  // 처리 해상도(업스케일)
  let procScale = 1;
  if (autoProc && transparent && (hardEdge?.enabled || dualMatte)) {
    const minSide = Math.min(w, h);
    if (minSide <= forceUpscaleBelow) {
      const wanted = Math.ceil(forceUpscaleBelow / Math.max(1, minSide));
      procScale = Math.max(2, Math.min((maxProcScale|0) || 8, wanted));
    }
  }
  const pw = w * procScale, ph = h * procScale;

  // 처리/프레임 캔버스
  const proc = document.createElement("canvas");
  proc.width = pw; proc.height = ph;
  const pctx = proc.getContext("2d", { willReadFrequently: true });
  pctx.imageSmoothingEnabled = (upscale.method === "linear");

  const temp = document.createElement("canvas");
  temp.width = w; temp.height = h;
  const tctx = temp.getContext("2d", { willReadFrequently: true });
  tctx.imageSmoothingEnabled = false; // 최종 축소는 NEAREST

  // gif.js
  const gif = new window.GIF({
    workers: 2,
    quality: 12,
    width: w,
    height: h,
    workerScript: getWorkerURL(workerScript),
    transparent: transparent ? KEY_HEX : null,
    background: transparent ? KEY_HEX : 0xffffff
  });
  if (typeof onProgress === "function") gif.on("progress", p => onProgress(p));
  else gif.on("progress", p => console.log("[gif] " + Math.round(p * 100) + "%"));

  const delay = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  const totalFrames = Math.max(0, Math.round((duration / 1000) * fps));
  const capFrames = Math.max(0, totalFrames - Math.max(0, endTrimFrames | 0));
  let warm = Math.max(0, preRollFrames | 0);
  if (capFrames <= 0) return Promise.reject(new Error("[rec] endTrimFrames가 너무 커서 기록할 프레임이 없습니다."));

  const useDecon = !!(transparent && hardEdge?.enabled && transparentDecontam);
  const alphaCut = (dualMatteAlphaCut ?? hardEdge?.thresholdHi ?? hardEdge?.threshold ?? 215)|0;

  return new Promise((resolve, reject) => {
    let i = 0;
    let timer = null;

    const start = () => {
      timer = setInterval(() => {
        // 업스케일 캔버스 초기화
        if (dualMatte) {
          clearAll(pctx, pw, ph); // dual matte는 자체적으로 배경 채움
        } else {
          if (useDecon) clearAll(pctx, pw, ph);
          else fillBg(pctx, pw, ph, transparent ? KEY_CSS : "#ffffff");
        }

        // preRoll: 상태만 진행 (프레임 추가 X)
        if (warm > 0) {
          // 원본 캔버스의 현재 프레임을 한 번은 그려서 엔진 상태는 진행시켜 줌
          pctx.drawImage(canvas, 0, 0, pw, ph);
          warm--; return;
        }

        /* ====== A) dual matte 경로 ====== */
        if (transparent && dualMatte) {
          // 검정 배경
          fillBg(pctx, pw, ph, dualMatteBg.black || "#000000");
          pctx.drawImage(canvas, 0, 0, pw, ph);
          const black = pctx.getImageData(0,0,pw,ph);

          // 흰 배경
          fillBg(pctx, pw, ph, dualMatteBg.white || "#FFFFFF");
          pctx.drawImage(canvas, 0, 0, pw, ph);
          const white = pctx.getImageData(0,0,pw,ph);

          // RGBA 복원
          const solved = solveDualMatteRGBA(black.data, white.data);

          // (선택) 약한 샤픈
          // solved는 배열이라 샤픈하려면 put→샤픈→get 재반영
          pctx.putImageData(new ImageData(solved, pw, ph), 0, 0);
          if (upscale.sharpen) applySharpen(pctx, pw, ph, upscale.sharpen);

          // (선택) 디스필
          if (despill?.enabled) applyDespill(pctx, pw, ph, {
            greenBias: despill.greenBias ?? 20,
            strength:  despill.strength  ?? 0.5
          });

          // GIF 단색 투명에 맞추기: 알파 이진화 후 키색 합성
          const img = pctx.getImageData(0,0,pw,ph);
          const d = img.data, N = pw*ph;
          for (let k=0, j=0; k<N; k++, j+=4){
            const a = d[j+3];
            if (a < alphaCut){
              d[j]=0; d[j+1]=254; d[j+2]=0; d[j+3]=255; // 키색으로 강제
            } else {
              d[j+3]=255;
            }
          }
          pctx.putImageData(img,0,0);

        /* ====== B) 기존 크로마/하드엣지 경로 ====== */
        } else {
          // 원본 복사
          pctx.drawImage(canvas, 0, 0, pw, ph);

          if (upscale.sharpen) applySharpen(pctx, pw, ph, upscale.sharpen);

          if (transparent && hardEdge?.enabled) {
            const heOpts = {
              threshold: hardEdge.threshold ?? 215,
              thresholdHi: hardEdge.thresholdHi,
              thresholdLo: hardEdge.thresholdLo,
              mode: (hardEdge.mode || "dilate"),
              iterations: Math.max(0, hardEdge.iterations | 0),
              radius: Math.max(1, hardEdge.radius | 0) || 1
            };
            if (useDecon) hardEdgeDecontam(pctx, pw, ph, heOpts, unpremul);
            else          applyHardEdgeChroma(pctx, pw, ph, heOpts);
          }

          if (transparent && despill?.enabled) {
            applyDespill(pctx, pw, ph, {
              greenBias: despill.greenBias ?? 20,
              strength:  despill.strength  ?? 0.5
            });
          }
        }

        // 최종 축소 후 프레임 추가
        fillBg(tctx, w, h, transparent ? KEY_CSS : "#ffffff");
        tctx.drawImage(proc, 0, 0, w, h);

        gif.addFrame(tctx, { copy: true, delay, dispose: 2 });

        if (++i >= capFrames) {
          clearInterval(timer);
          gif.on("finished", blob => {
            try {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = filename;
              document.body.appendChild(a); a.click(); a.remove();
              resolve(blob);
            } catch (e) { reject(e); }
          });
          gif.on("abort", () => reject(new Error("[gif] 렌더링이 중단되었습니다.")));
          gif.on("error", err => reject(err));
          gif.render();
        }
      }, delay);
    };

    if (settleMs > 0) setTimeout(start, settleMs); else start();
  });
}
