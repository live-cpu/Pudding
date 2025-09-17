// /game/wireGhostGallery.js
import { mountGallery } from "./gallery.js";

async function ensurePixi() {
  // 전역 PIXI가 있으면 그대로 사용
  if (window.PIXI) return window.PIXI;
  // 없으면 CDN에서 ESM 동적 로드
  const mod = await import("https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.mjs");
  return mod;
}

/**
 * ghost와 갤러리 연결
 * @param {any} ghost   // GhostLayer 인스턴스(plane 보유 가정)
 * @param {{ container?: string|HTMLElement }} opts
 */
export function wireGhostGallery(ghost, { container = "#gallery" } = {}) {
  let root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) {
    root = document.createElement("aside");
    root.id = "gallery";
    root.style.cssText =
      "position:fixed;left:16px;top:16px;bottom:16px;width:260px;background:rgba(255,255,255,.92);" +
      "backdrop-filter:blur(6px);border-radius:16px;padding:12px;box-shadow:0 10px 24px rgba(0,0,0,.12);" +
      "overflow:hidden;z-index:30";
    document.body.appendChild(root);
  }

  mountGallery(root, async (url) => {
    if (ghost?.setImageFromUrl) {
      await ghost.setImageFromUrl(url);
      return;
    }
    const PIXI = await ensurePixi();
    const tex = await PIXI.Assets.load(url);
    if (ghost?.plane) ghost.plane.texture = tex;
  });
}
