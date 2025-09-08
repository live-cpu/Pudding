window.addEventListener('load', () => {
  const MatterNS = window.Matter;
  const PIXI_NS  = window.PIXI;
  if (!MatterNS || !PIXI_NS) return;

  const { Engine, Render, Runner, World, Bodies, Body, Composite, Events } = MatterNS;

  // DOM 요소
  const boxEl     = document.getElementById('ballStage');
  const fileInput = document.getElementById('file');
  const btnUpload = document.getElementById('btnUpload');
  const sBounce   = document.getElementById('ctlBounce');
  const sStiff    = document.getElementById('ctlStiff');

  // 상태
  const engine = Engine.create();
  engine.world.gravity.y = 1.1;

  let render = null, runner = null, walls = [];
  let currentBody = null;
  let mesh = null, baseTex = null;
  let baseFitScale = 1;
  const SEG_X = 8, SEG_Y = 5;

  const jelly = { sx:1, sy:1, vsx:0, vsy:0, bend:0, vbend:0 };

  // Pixi
  let pixiApp = null, spriteLayer = null;

  boxEl.style.position = 'relative';
  function styleCanvasOverlay(el) {
    Object.assign(el.style, {
      position:'absolute', inset:'0', width:'100%', height:'100%', display:'block'
    });
  }

  function getSize() {
    const r = boxEl.getBoundingClientRect();
    return { width: Math.max(240, r.width|0), height: Math.max(360, r.height|0) };
  }

  function bringPixiToFront() {
    if (pixiApp?.view?.parentNode === boxEl) {
      pixiApp.view.style.zIndex = '2';
      const matterCanvas = boxEl.querySelector('canvas');
      if (matterCanvas) matterCanvas.style.zIndex = '1';
      boxEl.appendChild(pixiApp.view);
    }
  }

  // Matter render
  function createRender() {
    const { width, height } = getSize();
    if (render) { Render.stop(render); render.canvas.remove(); render.textures = {}; render = null; }
    render = Render.create({
      element: boxEl,
      engine,
      options: { width, height, wireframes: false, background: '#ffffff00' }
    });
    Render.run(render);
    if (!runner) { runner = Runner.create(); Runner.run(runner, engine); }
    styleCanvasOverlay(render.canvas);
    bringPixiToFront();
  }

  function clearWalls() {
    if (walls.length) { walls.forEach(w => Composite.remove(engine.world, w)); walls = []; }
  }
  function buildWalls() {
    clearWalls();
    const { width, height } = render.options;
    const t = 40;
    walls = [
      Bodies.rectangle(width/2, height + t/2, width, t, { isStatic:true }),
      Bodies.rectangle(width/2, -t/2,         width, t, { isStatic:true }),
      Bodies.rectangle(-t/2, height/2,        t, height, { isStatic:true }),
      Bodies.rectangle(width + t/2, height/2, t, height, { isStatic:true })
    ];
    World.add(engine.world, walls);
  }

  // Pixi
  function ensurePixi() {
    if (pixiApp) return;
    pixiApp = new PIXI_NS.Application({ resizeTo: boxEl, backgroundAlpha:0, antialias:true });
    boxEl.appendChild(pixiApp.view);
    styleCanvasOverlay(pixiApp.view);
    spriteLayer = new PIXI_NS.Container();
    pixiApp.stage.addChild(spriteLayer);

    // 업데이트 루프
    pixiApp.ticker.add(() => {
      if (!mesh || !currentBody) return;
      mesh.position.set(currentBody.position.x, currentBody.position.y);
      mesh.rotation = currentBody.angle;
      updateJelly();
      updateMeshVertices();
    });
    bringPixiToFront();
  }

  // 텍스처 로더
  async function loadTextureFromFile(file, maxDim=2048) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (Math.max(sw,sh) > maxDim) {
      const scale = maxDim / Math.max(sw,sh);
      const dw = Math.round(sw*scale), dh = Math.round(sh*scale);
      const canvas = document.createElement('canvas');
      canvas.width = dw; canvas.height = dh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,dw,dh);
      return PIXI_NS.Texture.from(canvas);
    }
    return PIXI_NS.Texture.from(img);
  }

  function clearCurrent() {
    if (currentBody) { Composite.remove(engine.world, currentBody); currentBody=null; }
    if (mesh) { mesh.destroy(true); mesh=null; }
  }

  // 젤리 update
  function stiffEff() {
    const v = parseFloat(sStiff.value);
    return Math.max(0.001, isFinite(v) ? v : 0.01);
  }
  function updateJelly() {
    const k = 8 + 140 * stiffEff();
    const c = 2 * Math.sqrt(k) * 0.9;
    const dt = 1/60;
    const ax_sx = -k*(jelly.sx-1) - c*jelly.vsx;
    const ax_sy = -k*(jelly.sy-1) - c*jelly.vsy;
    const ax_bd = -k*jelly.bend    - c*jelly.vbend;
    jelly.vsx+=ax_sx*dt; jelly.vsy+=ax_sy*dt; jelly.vbend+=ax_bd*dt;
    jelly.sx+=jelly.vsx*dt; jelly.sy+=jelly.vsy*dt; jelly.bend+=jelly.vbend*dt;
    jelly.sx=Math.max(0.6,Math.min(1.6,jelly.sx));
    jelly.sy=Math.max(0.6,Math.min(1.6,jelly.sy));
    jelly.bend=Math.max(-0.6,Math.min(0.6,jelly.bend));
  }
  function updateMeshVertices() {
    if (!mesh || !baseTex) return;
    const W=baseTex.width, H=baseTex.height;
    const baseScale=baseFitScale;
    const sx=baseScale*jelly.sx, sy=baseScale*jelly.sy;
    const buf=mesh.geometry.getBuffer('aVertexPosition');
    const verts=buf.data;
    for(let iy=0;iy<SEG_Y;iy++){
      const ty=iy/(SEG_Y-1);
      const bendY=(ty-0.5)*H*0.18*jelly.bend;
      for(let ix=0;ix<SEG_X;ix++){
        const tx=ix/(SEG_X-1);
        const localX=(tx-0.5)*W*sx;
        const localY=(ty-0.5)*H*sy+bendY;
        const idx=(iy*SEG_X+ix)*2;
        verts[idx]=localX; verts[idx+1]=localY;
      }
    }
    buf.update();
  }

  // 이미지 생성
  async function buildImage(file) {
    clearCurrent(); ensurePixi();
    baseTex=await loadTextureFromFile(file);
    const {width:cw,height:ch}=render.options;
    // 면적 = 캔버스의 1/9
    const A=(cw*ch)/9;
    const ar=baseTex.width/baseTex.height;
    const dispW=Math.sqrt(A*ar), dispH=Math.sqrt(A/ar);
    baseFitScale=dispW/baseTex.width;
    if (!isFinite(baseFitScale)||baseFitScale<=0) baseFitScale=1;
    mesh=new PIXI_NS.SimplePlane(baseTex,SEG_X,SEG_Y);
    mesh.pivot.set(baseTex.width/2,baseTex.height/2);
    spriteLayer.addChild(mesh);
    const bw=dispW, bh=dispH;
    currentBody=Bodies.rectangle(cw*0.5,ch*0.6,bw,bh,{
      restitution:parseFloat(sBounce.value),
      frictionAir:stiffEff(),
      render:{opacity:0}
    });
    World.add(engine.world,currentBody);
    jelly.sx=jelly.sy=1; jelly.vsx=jelly.vsy=0; jelly.bend=jelly.vbend=0;
  }

  // 초기
  createRender(); buildWalls(); ensurePixi();

  // 컨트롤
  sBounce.addEventListener('input',()=>{ if(currentBody) currentBody.restitution=parseFloat(sBounce.value); });
  sStiff.addEventListener('input',()=>{ if(currentBody) currentBody.frictionAir=stiffEff(); });

  // 업로드
  btnUpload.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async()=>{
    const file=fileInput.files?.[0]; if(!file) return;
    try{ await buildImage(file); }
    catch(e){ console.error(e); alert('이미지를 불러올 수 없습니다.'); }
  });

  // 반응형
  const ro=new ResizeObserver(()=>{
    createRender(); buildWalls(); bringPixiToFront();
  });
  ro.observe(boxEl);
});
