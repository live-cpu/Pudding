window.addEventListener('load', () => {
  const { Engine, Render, Runner, World, Bodies, Body, Vector,
          Mouse, MouseConstraint, Composite, Events } = window.Matter;
  const PIXI_NS = window.PIXI;
  if (!Engine || !PIXI_NS) return;

  const boxEl     = document.getElementById('ballStage');
  const fileInput = document.getElementById('file');
  const btnUpload = document.getElementById('btnUpload');

  const sBounce = document.getElementById('ctlBounce');
  const sStiff  = document.getElementById('ctlStiff');

  // ---------- 상태 ----------
  const engine = Engine.create();
  engine.world.gravity.y = 1.1;

  let render = null, runner = null, walls = [];
  let currentBody = null;
  let mode = 'image';

  // Pixi
  let pixiApp = null, spriteLayer = null;
  let baseTex = null, baseFitScale = 1;
  let mesh = null;
  const SEG_X = 8, SEG_Y = 5;

  // 클릭 반경
  const GRAB_RADIUS = 80;

  // ---------- 도우미 ----------
  boxEl.style.position = 'relative';
  function styleCanvasOverlay(el) {
    Object.assign(el.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'
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

  // ---------- Matter ----------
  function createRender() {
    const { width, height } = getSize();
    if (render) { Render.stop(render); render.canvas.remove(); render = null; }
    render = Render.create({
      element: boxEl,
      engine,
      options: { width, height, wireframes: false, background: '#ffffff00', pixelRatio: window.devicePixelRatio || 1 }
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
    const offset = 6; // 살짝만 내려줌
    walls = [
      Bodies.rectangle(width/2, height + offset, width, t, { isStatic: true }),
      Bodies.rectangle(width/2, -t/2,            width, t, { isStatic: true }),
      Bodies.rectangle(-t/2, height/2,           t, height, { isStatic: true }),
      Bodies.rectangle(width + t/2, height/2,    t, height, { isStatic: true })
    ];
    World.add(engine.world, walls);
  }

  // ---------- Pixi ----------
  function ensurePixi() {
    if (pixiApp) return;
    pixiApp = new PIXI_NS.Application({ resizeTo: boxEl, backgroundAlpha: 0 });
    boxEl.appendChild(pixiApp.view);
    styleCanvasOverlay(pixiApp.view);

    spriteLayer = new PIXI_NS.Container();
    pixiApp.stage.addChild(spriteLayer);

    pixiApp.ticker.add(() => {
      if (mode !== 'image' || !mesh || !currentBody) return;
      mesh.position.set(currentBody.position.x, currentBody.position.y);
      mesh.rotation = currentBody.angle;
    });

    bringPixiToFront();
  }

  async function loadTextureFromFile(file, maxDim = 2048) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url; await img.decode(); URL.revokeObjectURL(url);
    if (Math.max(img.naturalWidth, img.naturalHeight) > maxDim) {
      const scale = maxDim / Math.max(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return PIXI_NS.Texture.from(canvas);
    }
    return PIXI_NS.Texture.from(img);
  }

  function clearCurrent() {
    if (currentBody) { Composite.remove(engine.world, currentBody); currentBody = null; }
    if (mesh) { mesh.destroy(true); mesh = null; }
  }

  // ---------- 이미지 ----------
  async function buildImage(file) {
    mode = 'image';
    clearCurrent();
    ensurePixi();

    baseTex = await loadTextureFromFile(file);
    const { width: cw, height: ch } = render.options;

    // 면적 = 캔버스의 1/9
    const A = (cw*ch)/9;
    const ar = baseTex.width/baseTex.height;
    const dispW = Math.sqrt(A*ar);
    baseFitScale = dispW/baseTex.width;

    mesh = new PIXI_NS.SimplePlane(baseTex, SEG_X, SEG_Y);
    mesh.pivot.set(baseTex.width/2, baseTex.height/2); // 중앙 기준
    spriteLayer.addChild(mesh);

    const bw = baseTex.width*baseFitScale;
    const bh = baseTex.height*baseFitScale;
    currentBody = Bodies.rectangle(cw*0.5, ch*0.45, bw, bh, { // 중앙보다 살짝 위
      restitution: parseFloat(sBounce.value),
      frictionAir: parseFloat(sStiff.value),
      render: { opacity: 0 }
    });
    World.add(engine.world, currentBody);
  }

  // ---------- 초기 ----------
  createRender(); buildWalls(); ensurePixi();

  // ---------- 업로드 ----------
  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try { await buildImage(file); }
    catch (e) { console.error(e); alert("이미지 로드 실패"); }
  });

  // ---------- 드래그 ----------
  const mouse = Mouse.create(boxEl);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse, constraint: { stiffness: 0.6, render: { visible: false } }
  });
  World.add(engine.world, mouseConstraint);

  // 근처 클릭 시 강제 스냅
  boxEl.addEventListener('mousedown', () => {
    if (!currentBody) return;
    const mp = mouse.position;
    const dist = Vector.magnitude(Vector.sub(mp, currentBody.position));
    if (dist <= GRAB_RADIUS) {
      const c = mouseConstraint.constraint;
      c.bodyB = currentBody;
      c.pointB = { x: 0, y: 0 };
      c.length = 0;
    }
  });

  // ---------- 반응형 ----------
  const ro = new ResizeObserver(() => {
    const { width: cw, height: ch } = getSize();
    createRender(); buildWalls(); bringPixiToFront();
    if (mode==='image' && baseTex && currentBody) {
      const A = (cw*ch)/9;
      const ar = baseTex.width/baseTex.height;
      const dispW = Math.sqrt(A*ar);
      baseFitScale = dispW/baseTex.width;
      const bw = baseTex.width*baseFitScale;
      const bh = baseTex.height*baseFitScale;
      Body.setPosition(currentBody, {x:cw*0.5, y:ch*0.45});
      Body.setVertices(currentBody, Bodies.rectangle(cw*0.5, ch*0.45, bw, bh).vertices);
    }d
  });
  ro.observe(boxEl);
});
