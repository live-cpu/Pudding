import { recordCanvas } from "./rec.js";

async function waitForLeftApp(maxMs = 2000) {
  const start = performance.now();
  while (!window.leftApp) {
    if (performance.now() - start > maxMs) throw new Error("leftApp not ready (timeout)");
    await new Promise(r => setTimeout(r, 50));
  }
  return window.leftApp;
}

// options: rec.js와 동일한 옵션 객체
export async function recordLeft(options) {
  const app = await waitForLeftApp();
  await recordCanvas(app.view, "left.gif", options);
}
