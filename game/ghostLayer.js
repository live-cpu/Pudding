// /game/ghostLayer.js
// PixiJS v7 + Matter.js — 이미지 SimplePlane 왜곡 + 고스트 AI + 플레이어 상호작용(콜라이더 동기화)

import { supabase } from './gdatabase.js';
const { Engine, World, Bodies, Body, Composite, Constraint, Events, Sleeping } = Matter;

/* ---------- Supabase 로더 유틸 ---------- */
function extractSupabaseKey(u){
  const all = [...String(u).matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/g)];
  if (!all.length) return null;
  let [, bucket, path] = all.at(-1);
  const inner = [...path.matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/g)];
  if (inner.length){ bucket = inner.at(-1)[1]; path = inner.at(-1)[2]; }
  return { bucket, path };
}
async function loadTextureSmart(url){
  try{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return new PIXI.Texture(PIXI.BaseTexture.from(img));
  }catch(_){/* fallback */}
  const key = extractSupabaseKey(url);
  if (!key || !supabase) throw new Error('Texture load failed: ' + url);
  const { bucket, path } = key;
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  const blobUrl = URL.createObjectURL(data);
  try{
    const img2 = new Image();
    img2.src = blobUrl;
    await img2.decode();
    return new PIXI.Texture(PIXI.BaseTexture.from(img2));
  } finally { URL.revokeObjectURL(blobUrl); }
}

/* ===================== GhostLayer ===================== */
export class GhostLayer {
  constructor(player){
    this.player = player;
    this.app    = player.app;
    this.stage  = player.app.stage;

    this._paused = false;

    // 렌더 레이어
    this.layer = new PIXI.Container();
    this.layer.name = 'GhostLayer';
    const idx = typeof player.bgLayer !== 'undefined'
      ? this.stage.getChildIndex(player.bgLayer) + 1
      : this.stage.children.length;
    this.stage.addChildAt(this.layer, Math.min(idx, this.stage.children.length));
    this.stage.sortableChildren = true;
    this.layer.zIndex = (player.bgLayer?.zIndex ?? 0) + 1;

    // Matter
    this.engine = Engine.create();
    this.engine.world.gravity.y = 3.2;
    this.engine.enableSleeping = true;
    this.engine.positionIterations   = 10;
    this.engine.velocityIterations   = 8;
    this.engine.constraintIterations = 4;

    this.bounds = { composite: Composite.create() };
    World.add(this.engine.world, this.bounds.composite);
    this._buildBounds();

    this._onColl = (evt)=>{ this._bounceAllOnFloor(evt); this._flipOnBarrier(evt); };
    Events.on(this.engine, 'collisionStart', this._onColl);

    // 상태
    this.blocks = [];
    this.plane = null;
    this._nodeGrid = null;
    this.compGhost = null;

    // AI
    this._aiMove = { targetVX: 0, timer: 0, maxVX: 60, gain: 0.00006, clamp: 0.0006 };
    this._aiJump = { timer: 0, minMs: 1000, maxMs: 1600, vMin: 6, vMax: 10, sideKick: 0.12 };
    this._aiChangeMove(); this._aiScheduleJump();

    // 플레이어 콜라이더 동기화
    this._playerRectGetter = null;     // () => {x,y,w,h}
    this._playerBody = null;
    this._playerLastSize = null;
    this._playerOpt = { restitution: 0.0, friction: 0.25, debug:false };
    this._playerDebugGfx = null;

    // 틱
    this._tickPhysics = () => {
      if (this._paused) return;
      const dt = Math.min(32, this.app.ticker.deltaMS);
      this._ensurePlayerCollider();    // 매 프레임 위치 동기화
      this._limitVelocities(18, 22);   // 안전장치: 폭주 방지
      Engine.update(this.engine, dt);
      this._tickAI(dt);
    };
    this.app.ticker.add(this._tickPhysics);

    this._onResize = () => this._rebuildBounds();
    window.addEventListener('resize', this._onResize);
  }

  /* ---------- 공개 API ---------- */
  setEnabled(on = true){
    this._paused = !on;          // 물리·버텍스 동기화 일시정지
    this.layer.visible = !!on;   // 렌더 숨김/표시
    // 바디 수면 처리
    if (this.compGhost){
      const bs = Composite.allBodies(this.compGhost);
      for (const b of bs) Sleeping.set(b, !on);
    }
  }
  hide(){ this.setEnabled(false); }
  show(){ this.setEnabled(true); }

  attachPlayerCollider(getRect, opt={}){
    this._playerRectGetter = getRect;
    Object.assign(this._playerOpt, opt);
    this._ensurePlayerCollider(true);
  }
  detachPlayerCollider(){
    this._playerRectGetter = null;
    if (this._playerBody){ Composite.remove(this.engine.world, this._playerBody, true); this._playerBody = null; }
    if (this._playerDebugGfx){ this._playerDebugGfx.destroy(); this._playerDebugGfx = null; }
  }

  destroy(){
    this.clear();
    this.app.ticker.remove(this._tickPhysics);
    if (this._tickSync) this.app.ticker.remove(this._tickSync);
    window.removeEventListener('resize', this._onResize);
    try{ Events.off(this.engine, 'collisionStart', this._onColl); }catch{}
    try{ this.stage.removeChild(this.layer); }catch{}
  }

  clear(){
    if (this.plane){
      try{ this.plane.destroy({ children:true, texture:false, baseTexture:false }); }catch{}
      this.plane = null;
    }
    this._nodeGrid = null;

    if (this.compGhost){ Composite.remove(this.engine.world, this.compGhost, true); this.compGhost = null; }
    for (const it of this.blocks){ it.sprite?.destroy?.({ children:true, texture:false, baseTexture:false }); }
    this.blocks.length = 0;
    this.layer.removeChildren();

    if (this._tickSync){ this.app.ticker.remove(this._tickSync); this._tickSync = null; }
  }

  /* ---------- 스폰(왜곡 메시 + 노드/스프링) ---------- */
  async spawnFromURL(url, opts = {}){
    const {
      // 기본 물성
      restitution = 0.10,
      damping     = 0.14,
      stiffness   = 0.32,
      diag        = true,

      // 안정화 옵션
      edgeBoost   = 1.10,     // 바깥 테두리 강성 배수 (접힘 방지)
      bendRatio   = 0.35,     // 2칸 굴곡 스프링 강성 = stiffness * bendRatio
      frameRatio  = 0.12,     // 프레임(대각 장거리) 보강
      pinCorners  = false,     // 코너 약핀 (드리프트 방지)
      pinK        = 0.06,     // 코너 핀 강성

      // 렌더/해상도
      sizePx      = 120,
      fitBox      = null,
      verts       = { x: 10, y: 10 },

      // 시작 튕김
      kick        = 0.010,

      // AI
      aiMove      = null,
      aiJump      = null,
     spawnAt     = 'center', // ← 추가: 'center' | 'floor' | {x, y}

      debug       = false
    } = opts;

    if (aiMove) Object.assign(this._aiMove, aiMove);
    if (aiJump) Object.assign(this._aiJump, aiJump);
    this._aiChangeMove(); this._aiScheduleJump();

    const fullTex = await loadTextureSmart(url);
    const imgW = fullTex.width, imgH = fullTex.height;

    this.clear();

    // 표시 크기
    const viewW = this.app.screen.width, viewH = this.app.screen.height;
    const contain = (IW, IH, TW, TH) => {
      const s = Math.min(TW / IW, TH / IH);
      return { w: Math.max(1, Math.round(IW*s)), h: Math.max(1, Math.round(IH*s)) };
    };
    let dispW, dispH;
    if (fitBox && fitBox.w && fitBox.h){
      const mode = fitBox.mode || 'contain';
      const s = (mode==='cover') ? Math.max(fitBox.w/imgW, fitBox.h/imgH) : Math.min(fitBox.w/imgW, fitBox.h/imgH);
      dispW = Math.max(1, Math.round(imgW*s)); dispH = Math.max(1, Math.round(imgH*s));
    } else { ({ w:dispW, h:dispH } = contain(imgW, imgH, sizePx, sizePx)); }

    // 메시 해상도
    const vertsX = Math.max(4, Math.min(verts?.x ?? Math.round(dispW/24), 32));
    const vertsY = Math.max(4, Math.min(verts?.y ?? Math.round(dispH/24), 32));

    // 배치
   // 새 버전: 옵션에 따라 중앙/바닥/임의 위치
const floorTop = this.app.screen.height - 30; // _buildBounds()와 일치
let originX, originY;

if (spawnAt === 'floor') {
  originX = Math.round(viewW/2 - dispW/2);
  originY = Math.round(floorTop - dispH); // 바닥에 딱 닿게
} else if (spawnAt && typeof spawnAt === 'object') {
  originX = Math.round(spawnAt.x);
  originY = Math.round(spawnAt.y);
} else {
  originX = Math.round(viewW/2 - dispW/2);
  originY = Math.round(viewH/2 - dispH/2);
}

    // 메시(한 장)
    const plane = new PIXI.SimplePlane(fullTex, vertsX, vertsY);
    const scaleX = dispW / imgW, scaleY = dispH / imgH;
    plane.scale.set(scaleX, scaleY);
    plane.x = originX; plane.y = originY;
    this.layer.addChild(plane);
    this.plane = plane;

    // 물리
    const comp = Composite.create();
    const grid = [];
    const group = Body.nextGroup(true); // 노드끼리 충돌 X

    const dx = dispW / (vertsX - 1);
    const dy = dispH / (vertsY - 1);
    const nodeR = Math.max(2, Math.min(dx, dy) * 0.18);

    // 노드 만들기
    for (let r=0;r<vertsY;r++){
      grid[r]=[];
      for (let c=0;c<vertsX;c++){
        const x = originX + c*dx, y = originY + r*dy;
        const body = Bodies.circle(x, y, nodeR, {
          restitution, frictionAir: 0.10, density: 0.0018,
          collisionFilter: { group }
        });
        grid[r][c] = body; Composite.add(comp, body);
      }
    }

    // 스프링 유틸
    const link = (a,b,k,len)=>{ if(a&&b) Composite.add(comp, Constraint.create({ bodyA:a, bodyB:b, stiffness:k, damping, length:len })); };
    const isEdge = (r,c)=> r===0 || r===vertsY-1 || c===0 || c===vertsX-1;

    // 1) 이웃(가로/세로/대각) 스프링 (+테두리 보강)
    for (let r=0;r<vertsY;r++){
      for (let c=0;c<vertsX;c++){
        const b = grid[r][c];
        const edgeHere = isEdge(r,c);

        if (c>0){
          const edgeOther = isEdge(r,c-1);
          const k = stiffness * ((edgeHere || edgeOther) ? edgeBoost : 1);
          link(b, grid[r][c-1], k, dx);
        }
        if (r>0){
          const edgeOther = isEdge(r-1,c);
          const k = stiffness * ((edgeHere || edgeOther) ? edgeBoost : 1);
          link(b, grid[r-1][c], k, dy);
        }
        if (diag){
          const dK = Math.max(0.20, stiffness*0.40); // 대각선은 조금 약하게
          const dLn = Math.hypot(dx,dy);
          if (c>0 && r>0)        link(b, grid[r-1][c-1], dK, dLn);
          if (c<vertsX-1 && r>0) link(b, grid[r-1][c+1],  dK, dLn);
        }
      }
    }

    // 2) 굴곡(bend) 스프링 — 2칸 간격 (접힘 방지)
    if (bendRatio > 0){
      const kBend = stiffness * bendRatio; // 권장 시작값 0.3~0.4
      for (let r=0;r<vertsY;r++){
        for (let c=0;c<vertsX;c++){
          const b = grid[r][c];
          if (c>1) link(b, grid[r][c-2], kBend, 2*dx); // 가로 2칸
          if (r>1) link(b, grid[r-2][c], kBend, 2*dy); // 세로 2칸
        }
      }
    }

    // 3) 프레임 보강(대각 장거리) — 전체가 너무 접히는 것 억제
    if (frameRatio > 0){
      const kFrame = stiffness * frameRatio;
      const tl = grid[0][0], tr = grid[0][vertsX-1];
      const bl = grid[vertsY-1][0], br = grid[vertsY-1][vertsX-1];
      link(tl, br, kFrame, Math.hypot(dispW, dispH));
      link(tr, bl, kFrame, Math.hypot(dispW, dispH));
    }

    // 4) 코너 핀 — 약하게 고정해서 드리프트/전도 방지(슬라임 유지)
    if (pinCorners){
      const pins = [];
      const corners = [
        [0,0], [0,vertsX-1], [vertsY-1,0], [vertsY-1,vertsX-1]
      ];
      for (const [rr,cc] of corners){
        const p = grid[rr][cc].position;
        const pin = Bodies.circle(p.x, p.y, 1, { isStatic:true, collisionFilter:{ group } });
        pins.push(pin);
        Composite.add(comp, pin);
        link(grid[rr][cc], pin, pinK, 0);
      }
    }

    // 5) 첫 킥(살짝 위로 + 랜덤 x)
    for (let r=0;r<vertsY;r++) for (let c=0;c<vertsX;c++){
      const body = grid[r][c];
      Body.applyForce(body, body.position, { x:(Math.random()-0.5)*kick, y:-kick });
    }

    // 렌더-물리 동기화
    const posBuf = plane.geometry.getBuffer('aVertexPosition');
    const data = posBuf.data, invSX = 1/scaleX, invSY = 1/scaleY;
    const sync = ()=>{
      if (this._paused) return;
      let i=0;
      for (let r=0;r<vertsY;r++) for (let c=0;c<vertsX;c++){
        const b = grid[r][c];
        data[i++] = (b.position.x - originX) * invSX;
        data[i++] = (b.position.y - originY) * invSY;
      }
      posBuf.update();
    };
    this._tickSync = sync; this.app.ticker.add(sync);

    this.compGhost = comp;
    this._nodeGrid = grid;
    this.blocks = [];
    for (let r=0;r<vertsY;r++) for (let c=0;c<vertsX;c++) this.blocks.push({ body: grid[r][c] });

    World.add(this.engine.world, comp);

    this.layer.visible = true;
    this.layer.zIndex  = 9999;
    this.stage.sortableChildren = true;
  }

  /* ---------- 바운더리 ---------- */
  _buildBounds(){
    const w = this.app.screen.width, h = this.app.screen.height, t = 120; // 두껍게
    const floor = Bodies.rectangle(w/2, h+t/2-30, w, t, { isStatic:true, label:'floor', friction:0.35, restitution:0 });
    const ceil  = Bodies.rectangle(w/2, -t/2,     w, t, { isStatic:true, label:'ceil',  friction:0.2,  restitution:0 });
    const left  = Bodies.rectangle(-t/2,  h/2,    t, h, { isStatic:true, label:'left',  friction:0.2,  restitution:0 });
    const right = Bodies.rectangle(w+t/2, h/2,    t, h, { isStatic:true, label:'right', friction:0.2,  restitution:0 });
    Composite.clear(this.bounds.composite, false, true);
    Composite.add(this.bounds.composite, [floor, ceil, left, right]);
  }
  _rebuildBounds(){ this._buildBounds(); }

  /* ---------- 충돌 반응 ---------- */
  _bounceAllOnFloor(evt){
    const hitFloor = evt.pairs.some(p => p.bodyA.label==='floor' || p.bodyB.label==='floor');
    if (!hitFloor) return;
    let sumVy=0,n=0;
    for (const { body } of this.blocks){ if (body.velocity?.y > 0){ sumVy += body.velocity.y; n++; } }
    const avgVy = n ? sumVy/n : 0;
    const bounce = Math.min(8, avgVy*0.45);
    if (bounce <= 0.5) return;
    const sideKick = (Math.random()<0.8?-1:1)*0.2;
    for (const { body } of this.blocks){
      const vx = body.velocity.x*0.94 + sideKick;
      Body.setVelocity(body, { x:vx, y:-bounce });
    }
  }
  _flipOnBarrier(evt){
    const hit = evt.pairs.some(p =>
      p.bodyA.label==='left' || p.bodyB.label==='left' ||
      p.bodyA.label==='right'|| p.bodyB.label==='right'||
      p.bodyA.label==='player'|| p.bodyB.label==='player'
    );
    if (hit) this._aiMove.targetVX = -this._aiMove.targetVX;
  }

  /* ---------- AI ---------- */
  _aiChangeMove(){
    this._aiMove.timer = 1200 + Math.random()*1000;
    const speed = 2.5 + Math.random()*2.5;       // 느린 좌우
    const dir   = Math.random()<0.5 ? -1 : 1;
    this._aiMove.targetVX = dir*speed;
  }
  _aiScheduleJump(){
    const j=this._aiJump; j.timer = j.minMs + Math.random()*(j.maxMs - j.minMs);
  }
  _aiDoJump(){
    if (!this.blocks.length) return;
    const j=this._aiJump;
    const vy = j.vMin + Math.random()*(j.vMax - j.vMin);
    const sx = (Math.random()<0.5?-1:1)*j.sideKick;
    for (const { body } of this.blocks){
      const vx = body.velocity.x*0.95 + sx;
      Body.setVelocity(body, { x:vx, y:-vy });
    }
  }
  _tickAI(dtMS){
    if (!this.blocks.length) return;
    // 이동
    const m=this._aiMove;
    m.timer -= dtMS; if (m.timer<=0) this._aiChangeMove();
    let vxSum=0; for (const {body} of this.blocks) vxSum += body.velocity.x;
    const vxAvg = vxSum / this.blocks.length;
    if (Math.abs(vxAvg) > m.maxVX){
      for (const {body} of this.blocks) Body.setVelocity(body,{x:body.velocity.x*0.98,y:body.velocity.y});
    }else{
      const err = m.targetVX - vxAvg;
      const f = Math.max(-m.clamp, Math.min(m.clamp, err*m.gain));
      for (const {body} of this.blocks) Body.applyForce(body, body.position, {x:f, y:0});
    }
    // 점프
    const j=this._aiJump; j.timer -= dtMS;
    if (j.timer<=0){ this._aiDoJump(); this._aiScheduleJump(); }
  }

  /* ---------- 속도 안전장치(폭주 억제) ---------- */
  _limitVelocities(maxVX=20, maxVY=24){
    if (!this.compGhost) return;
    const bodies = Composite.allBodies(this.compGhost);
    for (const b of bodies){
      const vx = Math.max(-maxVX, Math.min(maxVX, b.velocity.x));
      const vy = Math.max(-maxVY, Math.min(maxVY, b.velocity.y));
      if (vx !== b.velocity.x || vy !== b.velocity.y){
        Body.setVelocity(b, { x:vx, y:vy });
      }
    }
  }

  /* ---------- 플레이어 콜라이더 동기화 ---------- */
  _ensurePlayerCollider(force=false){
    if (!this._playerRectGetter) return;
    const r = this._playerRectGetter();
    if (!r) return;

    const cx = r.x + r.w/2, cy = r.y + r.h/2;
    const sizeChanged = !this._playerLastSize || Math.abs(this._playerLastSize.w - r.w)>0.5 || Math.abs(this._playerLastSize.h - r.h)>0.5;

    if (force || !this._playerBody || sizeChanged){
      if (this._playerBody) Composite.remove(this.engine.world, this._playerBody, true);
      this._playerBody = Bodies.rectangle(cx, cy, r.w, r.h, {
        isStatic:true, label:'player',
        restitution: this._playerOpt.restitution,
        friction: this._playerOpt.friction
      });
      Composite.add(this.engine.world, this._playerBody);
      this._playerLastSize = { w:r.w, h:r.h };
    } else {
      Body.setPosition(this._playerBody, { x:cx, y:cy });
    }

    if (this._playerOpt.debug){
      if (!this._playerDebugGfx){ this._playerDebugGfx = new PIXI.Graphics(); this.layer.addChild(this._playerDebugGfx); }
      const g=this._playerDebugGfx; g.clear(); g.lineStyle(2,0x00ff99,0.7).drawRect(r.x, r.y, r.w, r.h);
    } else if (this._playerDebugGfx){ this._playerDebugGfx.clear(); }
  }
}
