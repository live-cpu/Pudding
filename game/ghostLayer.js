// /game/ghostLayer.js
// PixiJS v7 + Matter.js / Supabase 이미지(퍼블릭/서명 URL) 안전 로더 포함

import { supabase } from './gdatabase.js'; // SUPA_OK가 아니어도 null 가능
const { Engine, World, Bodies, Body, Composite, Constraint } = Matter;

/** Supabase Public/Signed URL에서 bucket/path만 뽑아오기 (중첩 URL도 안전 처리) */
function extractSupabaseKey(u){
  // /storage/v1/object/public|sign/<bucket>/<path>
  const all = [...String(u).matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/g)];
  if (!all.length) return null;

  // 가장 마지막 매치만 취함 (중첩 URL 방지)
  let [, bucket, path] = all[all.length - 1];

  // path 안에도 또 중첩이 있으면 다시 마지막만 취함
  const inner = [...path.matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/g)];
  if (inner.length){
    bucket = inner.at(-1)[1];
    path   = inner.at(-1)[2];
  }
  return { bucket, path };
}

/** URL을 PIXI Texture로 로드. 일반 이미지 → 실패 시 Supabase SDK download로 폴백 */
async function loadTextureSmart(url){
  // 1) 일반 외부/로컬 URL 시도 (CORS 허용시 여기서 끝)
  try{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return new PIXI.Texture(PIXI.BaseTexture.from(img));
  }catch(_){/* 다음 단계 폴백 */}

  // 2) Supabase URL이면 SDK로 blob → Texture
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
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export class GhostLayer {
  constructor(player){
    this.player = player;
    this.app    = player.app;
    this.stage  = player.app.stage;

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
    this.engine.enableSleeping = true; // 미세 흔들림 억제

    this.bounds = { composite: Composite.create() };
    World.add(this.engine.world, this.bounds.composite);
    this._buildBounds();

    this.blocks = [];

    this._tickPhysics = () => {
      // 너무 큰 delta 억제(탭 전환 등) — 안정화
      const dt = Math.min(32, this.app.ticker.deltaMS);
      Engine.update(this.engine, dt);
    };
    this.app.ticker.add(this._tickPhysics);

    this._onResize = () => this._rebuildBounds();
    window.addEventListener('resize', this._onResize);
  }

  destroy(){
    this.clear();
    this.app.ticker.remove(this._tickPhysics);
    if (this._tickSync) this.app.ticker.remove(this._tickSync);
    window.removeEventListener('resize', this._onResize);
    try{ this.stage.removeChild(this.layer); }catch{}
  }

  clear(){
    if (this.compGhost){
      Composite.remove(this.engine.world, this.compGhost, true);
      this.compGhost = null;
    }
    for (const it of this.blocks){
      it.sprite?.destroy?.({ children:true, texture:false, baseTexture:false });
    }
    this.blocks.length = 0;
    this.layer.removeChildren();
    if (this._tickSync){
      this.app.ticker.remove(this._tickSync);
      this._tickSync = null;
    }
  }

  async spawnFromURL(url, opts = {}){
    const {
      maxCols=10, maxRows=10,
      restitution=0.28, damping=0.02, stiffness=0.62, diag=true,
      scaleFit=0.6, kick=0.015, debug=false
    } = opts;

    // 텍스처 로드 (CORS 안전 + Supabase fallback)
    const fullTex = await loadTextureSmart(url);
    const imgW = fullTex.width;
    const imgH = fullTex.height;

    this.clear();

    // 화면 크기는 app.screen 기준 (DPR/리사이즈 안전)
    const viewW = this.app.screen.width;
    const viewH = this.app.screen.height;

    const s = Math.min((viewW*scaleFit)/imgW, (viewH*scaleFit)/imgH);
    const dispW = Math.max(1, Math.round(imgW * s));
    const dispH = Math.max(1, Math.round(imgH * s));

    const approxBlock = 100;
    let cols = Math.max(3, Math.min(maxCols, Math.round(dispW/approxBlock)));
    let rows = Math.max(3, Math.min(maxRows, Math.round(dispH/approxBlock)));
    cols = Math.max(cols, 3); rows = Math.max(rows, 3);

    const bw = Math.round(dispW / cols);
    const bh = Math.round(dispH / rows);
    const srcBw = Math.ceil(imgW / cols);
    const srcBh = Math.ceil(imgH / rows);

    const originX = Math.round(viewW/2 - dispW/2);
    const originY = Math.round(viewH/2 - dispH/2);

    const comp = Composite.create();
    const grid = [];

    for (let r=0; r<rows; r++){
      grid[r] = [];
      for (let c=0; c<cols; c++){
        const fx = originX + c*bw + bw/2;
        const fy = originY + r*bh + bh/2;

        const body = Bodies.rectangle(fx, fy, bw, bh, {
          restitution,
          frictionAir: damping,
          density: 0.002,
        });

        const frame = new PIXI.Rectangle(
          Math.min(c*srcBw, imgW-1),
          Math.min(r*srcBh, imgH-1),
          Math.min(srcBw, imgW - c*srcBw),
          Math.min(srcBh, imgH - r*srcBh)
        );
        const tex = new PIXI.Texture(fullTex.baseTexture, frame);
        const sp  = new PIXI.Sprite(tex);
        sp.anchor.set(0.5);
        sp.x = fx; sp.y = fy;
        sp.width = bw; sp.height = bh;
        this.layer.addChild(sp);

        if (debug){
          const g = new PIXI.Graphics();
          g.lineStyle(1, 0xff00ff, 0.8).drawRect(-bw/2, -bh/2, bw, bh);
          sp.addChild(g);
        }

        this.blocks.push({ sprite: sp, body });
        grid[r][c] = body;
        Composite.add(comp, body);
      }
    }

    const addLink = (a,b) => {
      if (!a || !b) return;
      const cstr = Constraint.create({
        bodyA: a, bodyB: b, stiffness, damping, length: null // rest-length 자동
      });
      Composite.add(comp, cstr);
    };

    for (let r=0; r<rows; r++){
      for (let c=0; c<cols; c++){
        const b = grid[r][c];
        if (c>0) addLink(b, grid[r][c-1]);   // 좌
        if (r>0) addLink(b, grid[r-1][c]);   // 상
        if (diag){
          if (c>0   && r>0)      addLink(b, grid[r-1][c-1]); // 좌상
          if (c<cols-1 && r>0)   addLink(b, grid[r-1][c+1]); // 우상
        }
      }
    }

    // 첫 킥(살짝 위로 + 랜덤 x)
    for (const {body} of this.blocks){
      Body.applyForce(body, body.position, { x:(Math.random()-0.5)*kick, y: -kick });
    }

    // 스프라이트 ↔ 바디 동기화
    const sync = ()=>{
      for (const it of this.blocks){
        const b = it.body, s = it.sprite;
        s.x = b.position.x;
        s.y = b.position.y;
        s.rotation = b.angle;
      }
    };
    this._tickSync = sync;
    this.app.ticker.add(sync);

    this.compGhost = comp;
    World.add(this.engine.world, comp);

    this.layer.visible = true;
    this.layer.zIndex  = 9999;
    this.stage.sortableChildren = true;
  }

  _buildBounds(){
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const t = 80;

    const floor = Bodies.rectangle(w/2, h + t/2 - 20, w, t, { isStatic: true });
    const ceil  = Bodies.rectangle(w/2, -t/2, w, t, { isStatic: true });
    const left  = Bodies.rectangle(-t/2, h/2, t, h, { isStatic: true });
    const right = Bodies.rectangle(w + t/2, h/2, t, h, { isStatic: true });

    Composite.clear(this.bounds.composite, false, true);
    Composite.add(this.bounds.composite, [floor, ceil, left, right]);
  }

  _rebuildBounds(){
    this._buildBounds();
  }
}
