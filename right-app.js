window.addEventListener('load', () => {
  const MatterNS = window.Matter;
  const PIXI_NS  = window.PIXI;
  if (!MatterNS || !PIXI_NS) return;

  const {
    Engine, Render, Runner, World, Bodies, Body,
    Mouse, MouseConstraint, Composite, Events
  } = MatterNS;

  const boxEl     = document.getElementById('ballStage');
  const fileInput = document.getElementById('file');
  const btnUpload = document.getElementById('btnUpload');
  const btnTest   = document.getElementById('btnTest');

  const sBounce = document.getElementById('ctlBounce');
  const sStiff  = document.getElementById('ctlStiff');
  // radius 슬라이더는 right에서는 ❌ 사용 안 함

  // ---------- 공용 상태 ----------
  const engine = Engine.create();
  engine.world.gravity.y = 1.1;

  let render = null;
  let runner = null;
  let walls  = [];
  let currentBody   = null;     
  let currentSprite = null;     
  let baseScale     = 1;        

  // squash/stretch 상태
  let squash = { sx:1, sy:1, vsx:0, vsy:0 };

  // Pixi
  let pixiApp = null;
  let spriteLayer = null;
  boxEl.style.position = 'relative';

  // ---------- 유틸 ----------
  function styleCanvasOverlay(el) {
    Object.assign(el.style, {
      position:'absolute', inset:'0',
      width:'100%', height:'100%', display:'block'
    });
  }
  function getSize() {
    const r = boxEl.getBoundingClientRect();
    return { width: Math.max(240, r.width|0), height: Math.max(360, r.height|0) };
  }
  function bringPixiToFront() {
    if (pixiApp && pixiApp.view && pixiApp.view.parentNode === boxEl) {
      pixiApp.view.style.zIndex = '2';
      const matterCanvas = boxEl.querySelector('canvas');
      if (matterCanvas) matterCanvas.style.zIndex = '1';
      boxEl.appendChild(pixiApp.view);
    }
  }

  // ---------- 렌더 & 벽 ----------
  function createRender() {
    const { width, height } = getSize();
    if (render) { Render.stop(render); render.canvas.remove(); render.textures = {}; render = null; }
    render = Render.create({
      element: boxEl, engine,
      options: { width, height, wireframes:false, background:'#ffffff00', pixelRatio: window.devicePixelRatio||1 }
    });
    Render.run(render);
    if (!runner) { runner = Runner.create(); Runner.run(runner, engine); }
    styleCanvasOverlay(render.canvas);
    bringPixiToFront();

  // ⬇️ 추가: Matter 캔버스 전역 노출
  window.rightMatterCanvas = render.canvas;
  console.log("[right-app] expose rightMatterCanvas:", !!window.rightMatterCanvas);

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

  // ---------- Pixi ----------
  function ensurePixi() {
    if (pixiApp) return;
     // ✅ 버퍼 보존 켜기 (녹화용)
  pixiApp = new PIXI_NS.Application({
    resizeTo: boxEl,
    backgroundAlpha: 0,
    antialias: true,
    preserveDrawingBuffer: true,   // ← 여기!
  });
  boxEl.appendChild(pixiApp.view);
  styleCanvasOverlay(pixiApp.view);

  spriteLayer = new PIXI_NS.Container();
  pixiApp.stage.addChild(spriteLayer);

  pixiApp.ticker.add(() => {
    if (!currentBody || !currentSprite) return;
    currentSprite.position.set(currentBody.position.x, currentBody.position.y);
    currentSprite.rotation = currentBody.angle;
    updateSquash();
  });

  bringPixiToFront();

  // ✅ 전역 노출 (right-rec.js에서 기다렸다가 씀)
  window.rightApp = pixiApp;
  console.log("[right-app] expose rightApp:", !!window.rightApp);

  // (선택) Matter 캔버스를 녹화하고 싶다면 이것도 노출
  // if (render?.canvas) window.rightMatterCanvas = render.canvas;
}
  // ---------- 텍스처 로더 ----------
  async function loadTextureFromFile(file, maxDim=2048) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    let sw=img.naturalWidth, sh=img.naturalHeight;
    if (Math.max(sw,sh)>maxDim) {
      const scale=maxDim/Math.max(sw,sh);
      const dw=Math.round(sw*scale), dh=Math.round(sh*scale);
      const canvas=document.createElement('canvas');
      canvas.width=dw; canvas.height=dh;
      canvas.getContext('2d').drawImage(img,0,0,dw,dh);
      return PIXI_NS.Texture.from(canvas);
    }
    return PIXI_NS.Texture.from(img);
  }

  // ---------- 오브젝트 ----------
  function clearCurrent() {
    if (currentBody)   { Composite.remove(engine.world, currentBody); currentBody=null; }
    if (currentSprite) { currentSprite.destroy(true); currentSprite=null; }
  }
  function makeBall(radius) {
    clearCurrent();
    const { width, height } = render.options;
    const r=Math.max(10,radius|0);
    currentBody=Bodies.circle(width*0.5,height*0.25,r,{
      restitution:parseFloat(sBounce.value),
      friction:0.08,
      frictionAir:parseFloat(sStiff.value),
      render:{ fillStyle:'#DCF632' }
    });
    World.add(engine.world,currentBody);
  }

  async function buildImage(file) {
    clearCurrent();
    ensurePixi();

    const tex=await loadTextureFromFile(file);
    const { width, height }=render.options;
    const pad=40;

    let scale=Math.min((width-2*pad)/tex.width,(height-2*pad)/tex.height) * 0.6;
    if (!isFinite(scale)||scale<=0) scale=0.01;
    baseScale=scale;

    const bw=tex.width*scale, bh=tex.height*scale;
    if (bw>300||bh>300) {
      alert("이미지가 너무 커서 업로드할 수 없어요. (최대 300px)");
      return;
    }

    currentSprite=new PIXI_NS.Sprite(tex);
    currentSprite.anchor.set(0.5);
    currentSprite.scale.set(scale);
    spriteLayer.addChild(currentSprite);

    currentBody=Bodies.rectangle(width*0.5,height*0.25,bw,bh,{
      restitution:parseFloat(sBounce.value),
      frictionAir:parseFloat(sStiff.value),
      render:{ opacity:0 }
    });
    World.add(engine.world,currentBody);

    squash={ sx:1, sy:1, vsx:0, vsy:0 };
  }

  // ---------- 젤리 효과 ----------
  function updateSquash(){
    if(!currentSprite) return;
    const k=18, c=5, dt=1/60;
    const ax_sx=-k*(squash.sx-1)-c*squash.vsx;
    const ax_sy=-k*(squash.sy-1)-c*squash.vsy;
    squash.vsx+=ax_sx*dt; squash.vsy+=ax_sy*dt;
    squash.sx +=squash.vsx*dt; squash.sy +=squash.vsy*dt;
    squash.sx=Math.max(0.7,Math.min(1.3,squash.sx));
    squash.sy=Math.max(0.7,Math.min(1.3,squash.sy));
    currentSprite.scale.set(baseScale*squash.sx, baseScale*squash.sy);
  }

  Events.on(engine,"collisionStart",(evt)=>{
    if(!currentBody) return;
    for(const p of evt.pairs){
      if(p.bodyA!==currentBody&&p.bodyB!==currentBody) continue;
      const other=(p.bodyA===currentBody)?p.bodyB:p.bodyA;
      if(!other.isStatic) continue;
      const v=Math.hypot(currentBody.velocity.x,currentBody.velocity.y);
      const impact=Math.min(1.2,v/10);
      squash.vsy-=0.5*impact;
      squash.vsx+=0.4*impact;
    }
  });

  // 👉 클릭 시 출렁 펄스
  function nudgeJelly(){
    squash.vsx += (Math.random()*0.8 - 0.4); // 좌우 무작위로
    squash.vsy -= 1.0;                       // 눌린 느낌
  }
  boxEl.addEventListener('mousedown',()=>{
    if(currentBody) nudgeJelly();
  });

  // ---------- 초기 ----------
  createRender(); buildWalls(); ensurePixi(); makeBall(36);

  // ---------- 컨트롤 ----------
  sBounce.addEventListener('input',()=>{ if(currentBody) currentBody.restitution=parseFloat(sBounce.value); });
  sStiff .addEventListener('input',()=>{ if(currentBody) currentBody.frictionAir =parseFloat(sStiff.value); });

  // ---------- 테스트 ----------
  btnTest.addEventListener('click',()=>{
    const { width }=render.options;
    const r=36;
    const b=Bodies.circle(width*0.3+Math.random()*width*0.4,40,r,{
      restitution:parseFloat(sBounce.value),
      frictionAir:parseFloat(sStiff.value),
      render:{ fillStyle:'#DCF632' }
    });
    World.add(engine.world,b);
  });

  // ---------- 업로드 ----------
  btnUpload.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async()=>{
    const file=fileInput.files?.[0]; if(!file) return;
    try{ await buildImage(file); }
    catch(e){ console.error("이미지 로드 실패",e); alert("이미지를 불러오지 못했어요. 다른 파일로 시도해 주세요."); }
  });

  // ---------- 드래그 ----------
  const mouse=Mouse.create(boxEl);
  const mctl=MouseConstraint.create(engine,{ mouse,constraint:{ stiffness:0.2 } });
  World.add(engine.world,mctl);

});

