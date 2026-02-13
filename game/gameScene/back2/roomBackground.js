import { randomWeather, spawnWeatherEffect } from "./weather.js";

export async function mountRoomBackground(
  player,
  { tilesetUrl, debug=false, showThumb=false } = {}) {
  let retryCount = 0;
  const app   = player.app;
  const stage = app.stage;
  stage.sortableChildren = true;

  // ── 타일셋 프레임 ──
  const BG_LEFT   = { x:47, y:11, w: 8, h:42 };
  const BG_CORE   = { x:16, y:11, w:32, h:42 };
  const BG_RIGHT  = { x: 9, y:11, w: 8, h:42 };
  const FORBID    = { x: 9, y:48, w:46, h: 5 };

  const WINDOW_1  = { x:49, y:97, w:14, h:14 };
  const WINDOW_2  = { x:65, y:97, w:30, h:14 };
  const WINDOW_3  = { x:96, y:97, w:16, h:14 };
  const WINDOWS   = [WINDOW_1, WINDOW_2, WINDOW_3];

  const CHAIR_OVERLAY_FRAMES = {
    chair1: { x: 67, y: 74, w: 11, h: 11 },
    chair2: { x: 82, y: 74, w: 11, h: 11 },
    chair3: { x: 98, y: 74, w: 12, h: 11 },
  };

  const WZONE     = { x:17, y:24, w:30, h:12 };
  const ROOM_W = BG_LEFT.w + BG_CORE.w + BG_RIGHT.w; // 48
  const ROOM_H = BG_CORE.h;                           // 42
  const BASE_H = FORBID.h;                            // 5

  const FURN_SCALE = 0.85;
  const WALL_SCALE = 0.95;
  const OFFSET_X = BG_RIGHT.x; // 9
  const OFFSET_Y = BG_CORE.y;  // 11

  // 레이어들
  const layer = new PIXI.Container();
  layer.sortableChildren = true;
  let insertIdx = 0;
  if (player.bgLayer && stage.children.includes(player.bgLayer)) {
    insertIdx = stage.getChildIndex(player.bgLayer) + 1;
  }
  stage.addChildAt(layer, insertIdx);

  const overlayLayer = new PIXI.Container();
  overlayLayer.sortableChildren = false;
  // layer 바로 위에서 따라오게 (UI 아래에 두고 싶으면 프로젝트 규칙에 맞게 값 조절)
  overlayLayer.zIndex = (layer.zIndex || 0) + 2;
  stage.addChild(overlayLayer);
  
  const weatherLayer = new PIXI.Container();
  weatherLayer.sortableChildren = true;
  weatherLayer.zIndex = 1.5; // 창문(z=1) 위, 가구(z=2~3) 아래
  layer.addChild(weatherLayer);



  // 타일셋 로드 (실패 시 반드시 정리)
  let base;
  try {
    base = await loadBaseTextureStrict(tilesetUrl);
  } catch (e) {
 
    try { layer.destroy(true); } catch(_) {}
    try { overlayLayer.destroy(true); } catch(_) {}
    throw e; // 위로 던져서 showRoom에서 폴백 로직 타게
  }
  const texFrom = (r) => new PIXI.Texture(base, new PIXI.Rectangle(r.x, r.y, r.w, r.h));

  // 배경(벽 3조각 + 베이스보드)
  const spLeft  = new PIXI.Sprite(texFrom(BG_LEFT));
  const spCore  = new PIXI.Sprite(texFrom(BG_CORE));
  const spRight = new PIXI.Sprite(texFrom(BG_RIGHT));
  const spBase  = new PIXI.Sprite(texFrom(FORBID));
  for (const s of [spLeft, spCore, spRight, spBase]) { s.anchor.set(0,0); }
  spLeft.position.set(0, 0);
  spCore.position.set(BG_LEFT.w, 0);
  spRight.position.set(BG_LEFT.w + BG_CORE.w, 0);
  spBase.position.set(0, ROOM_H);
  spLeft.zIndex = spCore.zIndex = spRight.zIndex = spBase.zIndex = 0;
  layer.addChild(spLeft, spCore, spRight, spBase);

  // 카탈로그
  const CATALOG = [
    { id:'desk1',  frame:{x:0,  y:72, w:16, h:24}, z:2, platforms:[{x:0, y:8,  w:16, h:7}], footPad:0 },
    { id:'desk2',  frame:{x:16, y:96, w:32, h:17}, z:2, platforms:[{x:0, y:0,  w:32, h:7}], footPad:0 },
    { id:'desk3',  frame:{x:66, y:48, w:44, h:17}, z:2, platforms:[{x:0, y:0,  w:44, h:2}], footPad:0 },
    { id:'chair1', frame:{x:67, y:74, w:11, h:22}, z:2, platforms:[{x:0, y:11, w:11, h:4}], footPad:1 },
    { id:'chair2', frame:{x:82, y:74, w:11, h:22}, z:2, platforms:[{x:0, y:11, w:11, h:4}], footPad:1 },
    { id:'chair3', frame:{x:98, y:74, w:12, h:22}, z:3, platforms:[{x:0, y:11, w:12, h:4}], footPad:1 },
    { id:'shelf1', frame:{x:17, y:64, w:30, h:32}, z:2, footPad:0 },
    { id:'shelf2', frame:{x:49, y:64, w:14, h:32}, z:2, footPad:0 },
    { id:'door',    frame:{x:64, y:0,  w:16, h:32}, z:1, wall:true },
    { id:'artwork', frame:{x:81, y:1,  w:29, h:14}, z:1, wall:true },
    { id:'memo',    frame:{x:81, y:17, w:30, h:14}, z:1, wall:true },
  ];
  const PICK_WEIGHTS = {
    desk1:1, desk2:1, desk3:1.2,
    chair1:1, chair2:1, chair3:1,
    shelf1:0.7, shelf2:0.9,
    door:0.5, artwork:0.9, memo:0.9,
  };

  // 유틸
  const rand = (a,b)=> a + Math.random()*(b-a);
  const pickWeighted = (items, wmap) => {
    const pool = [];
    for (const it of items) {
      const w = Math.max(0, wmap[it.id] ?? 1);
      for (let i=0;i<Math.round(w*10);i++) pool.push(it);
    }
    return pool.length ? pool[(Math.random()*pool.length)|0] : null;
  };
  const overlapsX = (x, w, placed) => placed.some(p => !(x + w <= p.x || p.x + p.w <= x));
  const rectOverlap = (a,b) => !(a.x+a.w <= b.x || b.x+b.w <= a.x || a.y+a.h <= b.y || b.y+b.h <= a.y);

  // ── 상태 ──
  const windowSprites = [];
  const furniturePlaced = [];
  const overlaySprites = [];
  const wallRects = [];
  let activePlatforms = [];

  // 창문 라이트 빔 관리(초경량)
  const windowLights = [];
  let beamTex = null;

  function getBeamTexture() {
    if (beamTex) return beamTex;
    const h = 256, w = 2;
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.10, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.40, 'rgba(255,255,255,0.25)');
    g.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    beamTex = PIXI.Texture.from(cvs);
    beamTex.baseTexture.label = 'WindowBeam';
    return beamTex;
  }

  function getLightStyleByTime() {
    const k = (window.__overlay && window.__overlay._styleKey) || 'none';
    switch (k) {
      case 'dawn':  return { tint: 0x9fdcff, alpha: 0.55 };
      case 'dusk':  return { tint: 0xffc070, alpha: 0.55 };
      case 'night': return { tint: 0xaeb7ff, alpha: 0.52 };
      default:      return { tint: 0xffffff, alpha: 0.28 };
    }
  }

  function addWindowLightFor(sp) {
    const { tint, alpha } = getLightStyleByTime();
    const beam = new PIXI.Sprite(getBeamTexture());
    beam.anchor.set(0.5, 0);
    beam.blendMode = PIXI.BLEND_MODES.SCREEN; // 필요시 ADD로 교체 가능
    beam.tint = tint;
    beam.alpha = alpha;

    // 폭/길이/각도
    const bw  = sp.width * (0.85 + Math.random()*0.15);
    const len = Math.max(36, Math.min(80, sp.height * 10.2));
    beam.width  = bw;
    beam.height = len;
    const deg = 15 + Math.random() * 18; // 15°~33°
    beam.rotation = (deg * Math.PI) / 180;

    // 시작 위치(창문 하단 중앙 조금 안쪽)
    const startX = sp.x + sp.width / 2;
    const startY = sp.y + sp.height * 0.55;
    // ← 여기 추가: 헤드를 프레임 바깥으로 올려서 단면이 안 보이게
 const headOffset = 7;        // 4~12 사이에서 감으로 맞추기
 beam.position.set(startX, startY - headOffset);
 beam.height = len + headOffset;  // 위로 뺀 만큼 전체 길이 늘려주기

    overlayLayer.addChild(beam);
    windowLights.push(beam);
  }

  // ── 창문 ──
function spawnWindows() {
  windowSprites.splice(0).forEach(s => s.destroy());
  wallRects.splice(0);
  windowLights.splice(0).forEach(s => s.destroy());

  let placed = 0;
  const targetCount = 2 + (Math.random()*2|0);
  let triesAll = 100; // ⬅️ 충분히 크게
    for (let i = 0; i < targetCount && triesAll > 0; ) {
      triesAll--;
      const frame = WINDOWS[(Math.random()*WINDOWS.length)|0];
      const tex   = texFrom(frame);
      const w = tex.width, h = tex.height;
      const rx = Math.round(rand(WZONE.x, WZONE.x + Math.max(0, WZONE.w - w)));
      const ry = Math.round(rand(WZONE.y, WZONE.y + Math.max(0, WZONE.h - h)));
      const lx = rx - OFFSET_X, ly = ry - OFFSET_Y;
      const rect = { x: lx, y: ly, w, h };
      if (wallRects.some(r => rectOverlap(r, rect))) continue;

      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0,0);
      sp.zIndex = 1;
      sp.position.set(lx, ly);
      layer.addChild(sp);

      windowSprites.push(sp);
      wallRects.push(rect);

      // 창문 광원 추가
      addWindowLightFor(sp);

     // ✅ 날씨 파티클 추가
         const weatherType = randomWeather();
    console.log("window weather:", weatherType);

    const area = { x: sp.x, y: sp.y, width: sp.width, height: sp.height };

    spawnWeatherEffect(app, weatherLayer, area, weatherType); // ✅ 수정
     placed++; 
      i++;
    }
     // ✅ 최소 보장: 하나도 못 놓았으면 다시 시도
	if (placed === 0 && retryCount < 3) {  // 최대 3번까지만 재시도
    retryCount++;
    console.warn("spawnWindows 실패 → 재시도");
    spawnWindows();
  }
      }




  // ── 가구 ──
  function spawnFurniture() {
    furniturePlaced.splice(0).forEach(({sp}) => sp.destroy());
    overlaySprites.splice(0).forEach(s => s.destroy());
    activePlatforms = [];

    // 바닥 가구
    const floorY = ROOM_H, marginX = 2;
    const placedX = [];
    const floorCandidates = CATALOG.filter(c => !c.wall);
    const floorCount = 3 + (Math.random()*3|0);

    for (let i=0;i<floorCount;i++){
      const item = pickWeighted(floorCandidates, PICK_WEIGHTS);
      if (!item) break;

      const tex = texFrom(item.frame);
      const sp  = new PIXI.Sprite(tex);
      sp.anchor.set(0,0);
      sp.zIndex = item.z ?? 2;

      sp.scale.set(FURN_SCALE);
      const sw = Math.round(tex.width  * FURN_SCALE);
      const sh = Math.round(tex.height * FURN_SCALE);

      let tries = 20, x = 0;
      while (tries--){
        x = Math.round(marginX + Math.random() * Math.max(0, ROOM_W - sw - marginX));
        if (!overlapsX(x, sw, placedX)) break;
      }
      placedX.push({ x, w: sw });

      const pad = (item.footPad ?? 0) * FURN_SCALE;
      const FLOOR_BIAS = 1;
      const y = floorY - sh + pad;

      sp.position.set(x, y);
      layer.addChild(sp);
      furniturePlaced.push({ sp, item });

      if (Array.isArray(item.platforms)) {
        for (const p of item.platforms) {
          const px = Math.round(sp.x + p.x * sp.scale.x);
          const py = Math.round(sp.y + p.y * sp.scale.y);
          const pw = Math.round(p.w * sp.scale.x);
          const ph = Math.round(p.h * sp.scale.y);
          activePlatforms.push({ x: px, y: py, w: pw, h: ph, tag: item.id });
        }
      }

      // 의자 오버레이
      if (item.id === 'chair1' || item.id === 'chair2' || item.id === 'chair3') {
        const ovFrame = CHAIR_OVERLAY_FRAMES[item.id];
        if (ovFrame) {
    const ovTex = texFrom(ovFrame);
    const ov = new PIXI.Sprite(ovTex);
    ov.anchor.set(0, 0);
    ov.scale.set(FURN_SCALE);
    ov.position.set(0, 0); // 의자 내부 좌표
    sp.addChild(ov);       // ✅ 부모를 의자로
  }
      }
    }

    // 벽걸이
    const wallItems = CATALOG.filter(c => c.wall);
    const wallCount = 2 + (Math.random()*2|0);
    let triesAll = 80;

    for (let i=0; i<wallCount && triesAll>0; ) {
      triesAll--;
      const item = pickWeighted(wallItems, PICK_WEIGHTS);
      if (!item) break;

      const tex = texFrom(item.frame);
      const w = Math.round(tex.width  * WALL_SCALE);
      const h = Math.round(tex.height * WALL_SCALE);

      const rx = Math.round(rand(WZONE.x, WZONE.x + Math.max(0, WZONE.w - w)));
      const ry = Math.round(rand(WZONE.y, WZONE.y + Math.max(0, WZONE.h - h)));
      const lx = rx - OFFSET_X, ly = ry - OFFSET_Y;
      const rect = { x: lx, y: ly, w, h };
      if (wallRects.some(r => rectOverlap(r, rect))) continue;

      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0,0);
      sp.zIndex = item.z ?? 1;
      sp.scale.set(WALL_SCALE);
      sp.position.set(lx, ly);
      layer.addChild(sp);

      wallRects.push(rect);
      furniturePlaced.push({ sp, item });
      i++;
    }

    layer.sortChildren();

  // ✅ 최소 보장: 아무 가구도 없으면 다시 시도
  if (furniturePlaced.length === 0) {
    console.warn("spawnFurniture 실패 → 재시도");
    spawnFurniture();


  }
  }

  // ── 화면 맞춤 ──
  function fit(){
    const W = app.renderer.width;
    const H = app.renderer.height;
    const GROUND_H = 36;
    const totalH = ROOM_H + BASE_H;

    const s = Math.max(W/ROOM_W, (H - GROUND_H)/totalH);
    layer.scale.set(s);

    const fittedW = ROOM_W * s;
    const x = (W - fittedW) / 2;
    const y = (H - GROUND_H) - (ROOM_H * s);
    layer.position.set(x, y);

    overlayLayer.scale.copyFrom(layer.scale);
    overlayLayer.position.copyFrom(layer.position);
    overlayLayer.zIndex = (layer.zIndex || 0) + 1;
  }

  // ── 월드 플랫폼 변환 ──
  function getWorldPlatforms(){
    const out = [];
    const sx = layer.scale.x, sy = layer.scale.y;
    for (const { sp, item } of furniturePlaced){
      if (!Array.isArray(item.platforms)) continue;
      for (const p of item.platforms){
        const lx = sp.x + p.x * sp.scale.x;
        const ly = sp.y + p.y * sp.scale.y;
        const lw =      p.w * sp.scale.x;
        const lh =      p.h * sp.scale.y;
        out.push({
          x: layer.position.x + lx * sx,
          y: layer.position.y + ly * sy,
          w: lw * sx,
          h: lh * sy,
          tag: item.id
        });
      }
    }
    return out;
  }

  // 디버그/썸네일
  if (debug) {
    const ov = new PIXI.Graphics();
    ov.lineStyle(1, 0x00ff00, 0.9).drawRect(0, 0, ROOM_W, ROOM_H);
    ov.lineStyle(1, 0xff0000, 0.9).drawRect(0, ROOM_H, ROOM_W, BASE_H);
    ov.lineStyle(1, 0x00aaff, 0.9).drawRect(WZONE.x - OFFSET_X, WZONE.y - OFFSET_Y, WZONE.w, WZONE.h);
    ov.zIndex = 9999;
    layer.addChild(ov);
  }
  if (showThumb) {
    const thumb = new PIXI.Sprite(new PIXI.Texture(base));
    thumb.alpha = 0.2;
    thumb.scale.set(0.35);
    thumb.position.set(6, 6);
    thumb.zIndex = 9998;
    layer.addChild(thumb);
    setTimeout(()=> thumb.destroy(), 1200);
  }

  // ── 초기화 ──
  function reset() {
    retryCount = 0;
    weatherLayer.removeChildren().forEach(c => c.destroy());
    spawnWindows();
    spawnFurniture();

    // ✅ 최종 보장: 둘 다 실패한 경우 재시도
    if (windowSprites.length === 0 || furniturePlaced.length === 0) {
      console.warn("reset: 생성 실패 → 재시도");
      setTimeout(reset, 50); // 50ms 뒤 다시 시도
      return;
    }

    fit();
    layer.sortChildren();
    try { player.setRoomPlatforms?.({ layer, rects: getWorldPlatforms() }); } catch (_) {}
  }


  reset();

  return {
    layer,
    overlayLayer,
    reset,
    fit,
    getWorldPlatforms,
    destroy(){
      try { player.setRoomPlatforms?.(null); } catch(_) {}
      windowSprites.splice(0).forEach(s => s.destroy());
      furniturePlaced.splice(0).forEach(({sp}) => sp.destroy());
      overlaySprites.splice(0).forEach(s => s.destroy());
      windowLights.splice(0).forEach(s => s.destroy());
      spLeft.destroy(true); spCore.destroy(true); spRight.destroy(true);
      spBase.destroy(true);
      layer.destroy(true);
      overlayLayer.destroy(true);
 
    }
  };
}

// 안전 로더
async function loadBaseTextureStrict(url){
  const res = await fetch(url, { mode:'cors', cache:'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('empty blob');
  const bmp  = await createImageBitmap(blob);
  return new PIXI.BaseTexture(bmp, { scaleMode: PIXI.SCALE_MODES.NEAREST });
}
