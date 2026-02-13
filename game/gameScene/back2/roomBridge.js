// /game/gameScene/back2/roomBridge.js
// 방/배경 브릿지 + 시간 오버레이 전역 유지(최상단으로 올리기)

import { mountRoomBackground } from './roomBackground.js';
import { TimeOverlay } from './timeOverlay.js';

export function createRoomBack2Bridge(
  player,
  { tilesetUrl, groundImageUrl, debug=false, showThumb=false } = {}
) {
 let roomBG = null;
  let _isRoom = false;
  let overlay = null;
  // 기본값을 미리 깔아두기 (null 방지)
  let lastImageUrl = groundImageUrl || null;

  // (보조) 특정 타깃 위로 올리기
  function placeOverlayAbove(target){
    if (!overlay || !target || !target.parent) return;
    const parent = target.parent;
    if (overlay.layer.parent !== parent) parent.addChild(overlay.layer);
    parent.sortableChildren = true;
    overlay.layer.zIndex = (target.zIndex || 0) + 1;
  }

  // 🔧 핵심: 스테이지 내 최댓값 zIndex + 여유치로 올리기
  function raiseOverlayToTop() {
    if (!overlay || !player || !player.app) return;

    const stage = player.app.stage;

    // 스테이지의 모든 자식 zIndex 중 최댓값 계산
    let maxZ = 0;
    for (const ch of stage.children) {
      const z = (typeof ch.zIndex === 'number') ? ch.zIndex : 0;
      if (z > maxZ) maxZ = z;
    }

    // overlay를 반드시 stage에 붙이고 최댓값 + 여유치로 올림
    if (overlay.layer.parent !== stage) stage.addChild(overlay.layer);
    stage.sortableChildren = true;
    overlay.layer.zIndex = maxZ + 10; // 여유 있게 +10
  }

  function ensureOverlay() {
    if (!player || !player.app) return;
    if (overlay) return;

    overlay = new TimeOverlay(player.app, {
      parent: player.app.stage,
      zIndex: 10,
      particleBudget: 64
    });
    player.app.stage.sortableChildren = true;
    overlay.start();
    window.__overlay = overlay;

    // 생성 직후 한 번 최상단으로
    raiseOverlayToTop();
  }

  // 브릿지 생성 시 1회 시도
  ensureOverlay();

  async function showRoom() {
    ensureOverlay();
   try { roomBG && roomBG.destroy && roomBG.destroy(); } catch (_) {}
   try {
     roomBG = await mountRoomBackground(player, { tilesetUrl, debug, showThumb });
     _isRoom = true;
     syncPlatforms();
   } catch (e) {
     console.warn('[showRoom] mount 실패 → 이미지 폴백:', e?.message || e);
     _isRoom = false;
     // 이미지 폴백 시도 (groundImageUrl이 있으면)
     if (groundImageUrl) await showImage(groundImageUrl);
     return;
   }

    // 의자 컷오버레이 레이어 바로 위로 정렬, 그다음 전역 최상단 보정
    if (roomBG.overlayLayer) placeOverlayAbove(roomBG.overlayLayer);
    raiseOverlayToTop();
  }

async function showImage(url) {
  ensureOverlay();

  try { roomBG && roomBG.destroy && roomBG.destroy(); } catch (_) {}
  roomBG = null;

  // ✅ URL fallback
  // ✅ URL 결정
   if (url) lastImageUrl = url;
   const target = lastImageUrl || groundImageUrl;

   try {
     if (!target) throw new Error('no image url');
     await player.setBackground(target);
     _isRoom = false;
     player.setRoomPlatforms?.(null);
     raiseOverlayToTop();
   } catch (e) {
     console.warn('[showImage] fallback to room:', e?.message || e);
     await showRoom(); // 로드 실패 시 방 모드로 폴백
   }
}


  const showGround = showImage; // 별칭

  function syncPlatforms() {
    if (!roomBG) return;
    const rects = (roomBG.getWorldPlatforms && roomBG.getWorldPlatforms()) || [];
    if (player.setRoomPlatforms) {
      player.setRoomPlatforms({ layer: roomBG.layer, rects });
    }
  }

async function toggle() {
  if (_isRoom) {
    return showImage(lastImageUrl || groundImageUrl); // fallback 강제
  } else {
    return showRoom();
  }
}


  function handleResize() {
    if (_isRoom && roomBG && roomBG.fit) roomBG.fit();
    syncPlatforms();
    if (roomBG && roomBG.overlayLayer) placeOverlayAbove(roomBG.overlayLayer);
    // 리사이즈 후에도 항상 최상단 보정
    raiseOverlayToTop();
  }
  addEventListener('resize', handleResize);

  function destroy() {
    removeEventListener('resize', handleResize);
    try { roomBG && roomBG.destroy && roomBG.destroy(); } catch (_) {}
    roomBG = null;
    if (player.setRoomPlatforms) player.setRoomPlatforms(null);
    _isRoom = false;
    // overlay는 전역 유지. 완전 제거하려면 아래 주석 해제:
    // if (overlay) { overlay.destroy(); overlay = null; }
  }

return {
  get isRoom(){ return _isRoom; },
  get layer(){ return roomBG?.layer; },
  get overlayLayer(){ return roomBG?.overlayLayer; },
 get lastImageUrl(){ return lastImageUrl; },  
  showRoom,
  showImage,
  showGround,
  toggle,
  syncPlatforms,
  destroy,
  raiseOverlayToTop,
};
}
