// right-rec.js — 전체 교체본
import { recordCanvas } from "./rec.js";

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function waitForRightApp(maxMs = 2000) {
  const t0 = performance.now();
  while (!window.rightApp) {
    if (performance.now() - t0 > maxMs) {
      throw new Error("rightApp not ready (timeout)");
    }
    await sleep(50);
  }
  return window.rightApp;
}

// options: rec.js와 동일 (transparent, duration, fps, scale, workerScript 등)
export async function recordRight(options) {
  const app = await waitForRightApp();

  // 기본: Pixi 캔버스 녹화
  const canvas = app.view;

  // 만약 Matter 캔버스를 녹화하고 싶으면 right-app.js에서
  // window.rightMatterCanvas = render.canvas; 로 노출하고 아래로 교체
  // const canvas = window.rightMatterCanvas || app.view;

  return recordCanvas(canvas, "right.gif", options);
}
