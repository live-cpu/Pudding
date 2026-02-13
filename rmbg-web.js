// rmbg-web.js
// Lightweight RMBG-1.4 (ONNX Runtime Web, WASM) runner with lazy confirm+loader.
// Public API:
//   await ensureOnnxMatteReady(opts)   -> 세션 준비(경고/로드)
//   requestOnnxMatte(bitmap, opts)     -> 알파 ImageData 반환 (비동기, 에러 throw)

const DEFAULT_MODEL =
  "https://huggingface.co/briaai/RMBG-1.4/resolve/main/model.onnx?download=true";

// --- tiny DOM helpers ---
function h(tag, attrs={}, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const kid of kids) el.append(kid);
  return el;
}

// --- Confirm & progress modal (only once) ---
let __onceConfirmed = false;
async function confirmBigDownloadOnce({title="AI 배경 제거(베타)", body="브라우저에서 ONNX 모델(수십 MB)을 로드합니다. 저사양/모바일은 느릴 수 있어요. 계속할까요?"}={}){
  if (__onceConfirmed) return true;
  return new Promise(res=>{
    const wrap = h("div", {style:{
      position:"fixed", inset:"0", background:"rgba(0,0,0,.55)", display:"grid", placeItems:"center", zIndex:999999
    }});
    const card = h("div",{style:{
      width:"min(420px,90vw)", background:"#111", color:"#eee", borderRadius:"14px",
      boxShadow:"0 18px 60px rgba(0,0,0,.6)", padding:"20px", font:"14px system-ui"
    }},
      h("h3",{style:{margin:"0 0 10px",fontSize:"18px"}}, title),
      h("p",{style:{margin:"0 0 16px", lineHeight:"1.5"}}, body),
      h("div",{style:{display:"flex", gap:"8px", justifyContent:"flex-end"}},
        h("button",{style:btnStyle("#333","#fff") , onClick:()=>{wrap.remove(); res(false);}}, "취소"),
        h("button",{style:btnStyle("#4F46E5","#fff"), onClick:()=>{__onceConfirmed=true; wrap.remove(); res(true);}}, "계속")
      )
    );
    wrap.append(card); document.body.appendChild(wrap);
  });
}
function btnStyle(bg, fg){ return {
  appearance:"none", border:"0", borderRadius:"10px", padding:"10px 14px",
  background:bg, color:fg, fontWeight:"700", cursor:"pointer"
}; }

let __loaderEl = null;
function showLoader(text="모델 로드 중…"){
  if (__loaderEl) return;
  const bar = h("div",{style:{
    height:"6px", width:"100%", background:"#2a2a2a", borderRadius:"999px", overflow:"hidden", marginTop:"10px"
  }}, h("div",{id:"__prog", style:{height:"100%", width:"0%", background:"#4F46E5", transition:"width .2s"}}));
  __loaderEl = h("div",{style:{
    position:"fixed", left:"16px", bottom:"16px", background:"#111", color:"#eee",
    borderRadius:"12px", padding:"12px 14px", font:"12px system-ui", boxShadow:"0 8px 28px rgba(0,0,0,.5)", zIndex:999999
  }}, h("div",{}, text), bar);
  document.body.appendChild(__loaderEl);
}
function setLoaderProgress(p){ const el = __loaderEl?.querySelector("#__prog"); if (el) el.style.width = Math.round(p*100)+"%"; }
function hideLoader(){ __loaderEl?.remove(); __loaderEl = null; }

// --- ONNX Runtime Web setup (WASM) ---
let ort = null;
let session = null;

async function loadOrtOnce(wasmBase){
  if (ort) return ort;
  // dynamic import via CDN
  ort = await import("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js");
  // set wasm path (CDN)
  if (wasmBase) ort.env.wasm.wasmPaths = wasmBase;
  else          ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
  return ort;
}

async function createSession(modelUrl, { threads=4, simd=true } = {}){
  const o = await loadOrtOnce();
  // perf env
  o.env.wasm.numThreads = Math.max(1, threads|0);
  o.env.wasm.simd = !!simd;
  showLoader("RMBG 모델 로드 중…");
  setLoaderProgress(0.05);
  session = await o.InferenceSession.create(modelUrl || DEFAULT_MODEL, {
    executionProviders:["wasm"],
    graphOptimizationLevel: "all"
  });
  setLoaderProgress(1);
  hideLoader();
  return session;
}

// --- preprocess: letterbox to 1024x1024, float32 NCHW 0..1
const IN_SIZE = 1024;
const _work = document.createElement("canvas");
_work.width = IN_SIZE; _work.height = IN_SIZE;
const _wctx = _work.getContext("2d", { willReadFrequently:true });

function prepareInput(imageBitmap){
  const W = imageBitmap.width, H = imageBitmap.height;
  const s = Math.min(IN_SIZE/W, IN_SIZE/H); // letterbox
  const nw = Math.round(W*s), nh = Math.round(H*s);
  _wctx.clearRect(0,0,IN_SIZE,IN_SIZE);
  _wctx.fillStyle = "#000"; // black background (common for segmentation)
  _wctx.fillRect(0,0,IN_SIZE,IN_SIZE);
  const dx = (IN_SIZE - nw)>>1, dy = (IN_SIZE - nh)>>1;
  _wctx.drawImage(imageBitmap, 0,0,W,H, dx,dy,nw,nh);

  const img = _wctx.getImageData(0,0,IN_SIZE,IN_SIZE).data;
  // NHWC -> NCHW, normalize 0..1
  const chw = new Float32Array(1*3*IN_SIZE*IN_SIZE);
  let p = 0, cR = 0, cG = IN_SIZE*IN_SIZE, cB = 2*IN_SIZE*IN_SIZE;
  for (let i=0;i<img.length;i+=4){
    const r=img[i]/255, g=img[i+1]/255, b=img[i+2]/255;
    chw[cR++] = r; chw[cG++] = g; chw[cB++] = b;
  }
  return { tensor: new ort.Tensor("float32", chw, [1,3,IN_SIZE,IN_SIZE]), dx,dy,nw,nh };
}

// --- postprocess: take single-channel mask [1,1,1024,1024] → to original size (letterbox undo)
const _maskCvs = document.createElement("canvas");
_maskCvs.width = IN_SIZE; _maskCvs.height = IN_SIZE;
const _mctx = _maskCvs.getContext("2d", { willReadFrequently:true });

function maskToImageData(maskData /*Float32Array 0..1*/, dx,dy,nw,nh, outW, outH){
  // Put into 1024 texture
  const tmp = _mctx.createImageData(IN_SIZE, IN_SIZE);
  for (let i=0, j=0; i<IN_SIZE*IN_SIZE; i++, j+=4){
    const a = Math.max(0, Math.min(255, Math.round(maskData[i]*255)));
    tmp.data[j]   = 0;
    tmp.data[j+1] = 0;
    tmp.data[j+2] = 0;
    tmp.data[j+3] = a;
  }
  _mctx.putImageData(tmp, 0, 0);

  // Extract the letterboxed region → scale back to outW/outH
  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  const octx = out.getContext("2d", { willReadFrequently:true });
  octx.clearRect(0,0,outW,outH);

  // draw only the region that contained the image
  const sub = document.createElement("canvas");
  sub.width = nw; sub.height = nh;
  const sctx = sub.getContext("2d", { willReadFrequently:true });
  sctx.drawImage(_maskCvs, dx,dy,nw,nh, 0,0,nw,nh);

  // paint (with smoothing false to keep edges)
  octx.imageSmoothingEnabled = false;
  octx.drawImage(sub, 0,0,nw,nh, (outW-nw)>>1,(outH-nh)>>1,nw,nh);
  return octx.getImageData(0,0,outW,outH); // alpha in A
}

// --- public: once confirm & create session
export async function ensureOnnxMatteReady(onnxOpts={}){
  if (!session){
    const ok = await confirmBigDownloadOnce({});
    if (!ok) throw new Error("user-canceled");
    await createSession(onnxOpts.modelUrl, {threads: onnxOpts.threads??4, simd: onnxOpts.simd??true});
  }
  return true;
}

// --- public: run frame → alpha ImageData
export async function requestOnnxMatte(imageBitmap, {maxDim=1024} = {}){
  if (!session) throw new Error("not-ready");
  // downscale big input for speed (keeping aspect)
  const W = imageBitmap.width, H = imageBitmap.height;
  const s = Math.min(1, maxDim / Math.max(W,H));
  let src = imageBitmap;
  if (s < 1){
    const tmp = document.createElement("canvas");
    tmp.width = Math.round(W*s); tmp.height = Math.round(H*s);
    const tctx = tmp.getContext("2d", { willReadFrequently:true });
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(imageBitmap, 0,0,tmp.width,tmp.height);
    src = await createImageBitmap(tmp);
  }

  const { tensor, dx,dy,nw,nh } = prepareInput(src);
  const feeds = { "input": tensor }; // RMBG-1.4 input name is usually "input"
  const out = await session.run(feeds);
  // Find first output
  const outName = Object.keys(out)[0];
  const arr = out[outName].data; // Float32Array [1,1,1024,1024]
  return maskToImageData(arr, dx,dy,nw,nh, src.width, src.height); // ImageData alpha
}
