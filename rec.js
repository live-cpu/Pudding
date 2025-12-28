// === 설정(원하면 바꿔도 됨) ===
const WORKER_CDN = "https://cdn.jsdelivr.net/npm/gif.js.optimized/dist/gif.worker.js";
const WORKER_FALLBACK_LOCAL = "./gif.worker.js"; // 로컬 파일 있으면 자동 대체
// rec.js — 객체/포지셔널 양쪽 호출 모두 지원 + 투명/흰배경 선택

// 크로마키 색 (투명 모드 때 사용)
const KEY_HEX = 0x00ff00;   // 0xRRGGBB (GIF의 transparent 인자용)
const KEY_CSS = "#00FF00";  // 캔버스 배경 fill용

// 워커 경로 결정 (기본: 로컬 파일)
function getWorkerURL(override) {
  if (typeof override === "string" && override.trim()) return override;
  return "./gif.worker.js"; // ← 같은 폴더에 gif.worker.js를 둬야 CORS 에러가 없음
}

// 옵션 정규화: 객체/포지셔널 모두 받아서 하나로 합치기
function normalizeArgs(arg3, arg4, arg5, arg6) {
  const defaults = { duration: 5000, fps: 12, scale: 0.5, transparent: false, workerScript: null, onProgress: null };
  if (arg3 && typeof arg3 === "object") {
    // 새 방식: recordCanvas(canvas, filename, { ...options })
    return { ...defaults, ...arg3 };
  }
  // 옛 방식: recordCanvas(canvas, filename, duration, fps, scale, transparent)
  return {
    ...defaults,
    duration: arg3 ?? defaults.duration,
    fps: arg4 ?? defaults.fps,
    scale: arg5 ?? defaults.scale,
    transparent: arg6 ?? defaults.transparent,
  };
}

/**
 * canvas: 캡처할 <canvas> (예: app.view)
 * filename: 저장할 파일명 (예: "left.gif")
 * arg3..arg6: (1) options 객체  또는  (2) duration, fps, scale, transparent
 */
export function recordCanvas(canvas, filename = "capture.gif", arg3, arg4, arg5, arg6) {
  if (!canvas) return Promise.reject(new Error("[rec] canvas가 없습니다."));
  if (!window.GIF) return Promise.reject(new Error("[rec] gif.js가 로드되지 않았습니다. (gif.js 스크립트 태그 확인)"));

  const { duration, fps, scale, transparent, workerScript, onProgress } = normalizeArgs(arg3, arg4, arg5, arg6);

  const w = Math.max(2, Math.floor(canvas.width * (scale ?? 1)));
  const h = Math.max(2, Math.floor(canvas.height * (scale ?? 1)));

  // 임시 캔버스 (다운샘플링 + 배경 채움)
  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d", { willReadFrequently: true });

  // gif.js 인스턴스
  const gif = new window.GIF({
    workers: 2,
    quality: 12,
    width: w,
    height: h,
    workerScript: getWorkerURL(workerScript),
    // 투명 모드면 transparent/배경을 크로마키로, 아니면 흰색 배경
    transparent: transparent ? KEY_HEX : null,
    background: transparent ? KEY_HEX : 0xffffff,
  });

  // 진행률 콜백(선택)
  if (typeof onProgress === "function") {
    gif.on("progress", p => onProgress(p));
  } else {
    // 기본 로깅
    gif.on("progress", p => console.log("[gif] progress " + Math.round(p * 100) + "%"));
  }

  return new Promise((resolve, reject) => {
    const interval = Math.max(1, Math.round(1000 / Math.max(1, fps)));
    let elapsed = 0;

    const timer = setInterval(() => {
      // 배경 먼저 칠하기 (투명모드=크로마키, 아니면 흰색)
      tctx.clearRect(0, 0, w, h);
      tctx.fillStyle = transparent ? KEY_CSS : "#ffffff";
      tctx.fillRect(0, 0, w, h);

      // 원본(WebGL 캔버스 포함) 복사
      tctx.drawImage(canvas, 0, 0, w, h);

      // 프레임 추가
      gif.addFrame(tctx, { copy: true, delay: interval });

      elapsed += interval;
      if (elapsed >= duration) {
        clearInterval(timer);

        gif.on("finished", blob => {
          try {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            resolve(blob); // 원하면 호출부에서 blob을 더 쓸 수 있음
          } catch (e) {
            reject(e);
          }
        });

        gif.on("abort", () => reject(new Error("[gif] 렌더링이 중단되었습니다.")));
        gif.on("error", err => reject(err));

        // 렌더 시작
        gif.render();
      }
    }, interval);
  });
}

