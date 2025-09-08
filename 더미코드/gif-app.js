// 버튼 색상 토글
document.addEventListener("DOMContentLoaded", () => {
  const btns = document.querySelectorAll('.btn');
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
});

// 좌측 높이 = 우측 합
function syncHeight() {
  const R = document.getElementById('rightCol');
  const L = document.getElementById('puddingStage');
  if (R && L) L.style.minHeight = R.offsetHeight + 'px';
}
window.addEventListener('resize', syncHeight);

window.addEventListener("load", () => {
  const PIXI_NS = window.PIXI;
  const MatterNS = window.Matter;
  if (!PIXI_NS || !MatterNS) {
    console.error("PIXI 또는 Matter가 로드되지 않았습니다.");
    return;
  }
  const { Engine, World, Bodies, Body, Constraint, Composite, Mouse, MouseConstraint, Runner } = MatterNS;

  /* ------------- 공통 DOM ------------- */
  const sBounce = document.getElementById('ctlBounce');
  const sStiff  = document.getElementById('ctlStiff');
  const sRadius = document.getElementById('ctlRadius');
  const fileInput = document.getElementById('file');
  const btnTest   = document.getElementById('btnTest');

  /* ------------- 좌측: Pixi + Matter (소프트바디) ------------- */
  const leftEl = document.getElementById('puddingStage');
  const appLeft = new PIXI_NS.Application({ resizeTo: leftEl, backgroundAlpha: 0, antialias: true });
  leftEl.appendChild(appLeft.view);

  const engLeft = Engine.create(); engLeft.world.gravity.y = 1.1;
  const runnerLeft = Runner.create(); Runner.run(runnerLeft, engLeft);

  let tiles = [];           // {sprite, body}
  let constraints = [];
  let baseTex = null;       // 업로드 텍스처
  let grid = { cols: 0, rows: 0, size: 36 };
  let leftSpritesLayer = new PIXI_NS.Container(); appLeft.stage.addChild(leftSpritesLayer);

  function clearLeft() {
    leftSpritesLayer.destroy({ children: true });
    leftSpritesLayer = new PIXI_NS.Container();
    appLeft.stage.addChild(leftSpritesLayer);
    tiles = [];
    Composite.clear(engLeft.world, false);
    constraints = [];
  }

  function buildSoftImage(texture) {
    clearLeft();
    baseTex = texture;

    const w = leftEl.clientWidth, h = leftEl.clientHeight;
    const s = Math.min((w - 40) / texture.width, (h - 40) / texture.height);
    const imgW = texture.width * s;
    const imgH = texture.height * s;
    const originX = (w - imgW) / 2;
    const originY = (h - imgH) / 2;

    const size = grid.size;
    const cols = Math.max(2, Math.floor(imgW / size));
    const rows = Math.max(2, Math.floor(imgH / size));
    grid.cols = cols; grid.rows = rows;

    const bodies2d = [];
    for (let r = 0; r < rows; r++) {
      bodies2d[r] = [];
      for (let c = 0; c < cols; c++) {
        const fx = Math.round(c * imgW / cols);
        const fy = Math.round(r * imgH / rows);
        const fw = Math.round((c + 1) * imgW / cols) - fx;
        const fh = Math.round((r + 1) * imgH / rows) - fy;

        const frame = new PIXI_NS.Rectangle(fx / s, fy / s, fw / s, fh / s);
        const tileTex = new PIXI_NS.Texture(texture.baseTexture, frame);

        const sprite = new PIXI_NS.Sprite(tileTex);
        sprite.anchor.set(0.5);
        sprite.x = originX + fx + fw / 2;
        sprite.y = originY + fy + fh / 2;
        leftSpritesLayer.addChild(sprite);

        const body = Bodies.rectangle(sprite.x, sprite.y, fw, fh, {
          frictionAir: 0.01,
          restitution: parseFloat(sBounce.value),
          chamfer: { radius: Math.min(fw, fh) * 0.12 },
          mass: 0.001 * fw * fh
        });
        World.add(engLeft.world, body);

        tiles.push({ sprite, body });
        bodies2d[r][c] = body;
      }
    }

    const stiff = parseFloat(sStiff.value);
    const len = Math.max(6, grid.size * 0.2);
    function link(a, b, st = stiff, ln = len) {
      const cn = Constraint.create({ bodyA: a, bodyB: b, stiffness: st, damping: 0.08, length: ln });
      World.add(engLeft.world, cn); constraints.push(cn);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const b = bodies2d[r][c];
        if (c + 1 < cols) link(b, bodies2d[r][c + 1]);          // →
        if (r + 1 < rows) link(b, bodies2d[r + 1][c]);          // ↓
        if (r + 1 < rows && c + 1 < cols) link(b, bodies2d[r + 1][c + 1]); // ↘
        if (r + 1 < rows && c - 1 >= 0) link(b, bodies2d[r + 1][c - 1]);   // ↙
      }
    }

    // 상단 가벼운 앵커
    const anchors = [];
    for (let c = 0; c < cols; c++) {
      anchors.push(Constraint.create({
        pointA: { x: originX + (c + 0.5) * (imgW / cols), y: originY - 8 },
        bodyB: bodies2d[0][c],
        stiffness: stiff * 0.6, damping: 0.12, length: 12
      }));
    }
    World.add(engLeft.world, anchors); constraints.push(...anchors);

    // 드래그
    const mouse = Mouse.create(leftEl);
    const mctl = MouseConstraint.create(engLeft, { mouse, constraint: { stiffness: 0.2, damping: 0.1 } });
    World.add(engLeft.world, mctl);

    // 동기화
    appLeft.ticker.add(() => {
      tiles.forEach(t => {
        t.sprite.position.set(t.body.position.x, t.body.position.y);
        t.sprite.rotation = t.body.angle;
      });
    });
  }

  /* ------------- 우측: Pixi + Matter (한 장 카드 바운스) ------------- */
  const rightEl = document.getElementById('ballStage');
  const appRight = new PIXI_NS.Application({ resizeTo: rightEl, backgroundAlpha: 0, antialias: true });
  rightEl.appendChild(appRight.view);

  const engRight = Engine.create(); engRight.world.gravity.y = 1.1;
  const runnerRight = Runner.create(); Runner.run(runnerRight, engRight);

  function buildWalls() {
    const w = rightEl.clientWidth, h = Math.max(360, rightEl.clientHeight);
    const t = 40;
    const walls = [
      Bodies.rectangle(w / 2, h + t / 2, w, t, { isStatic: true }),
      Bodies.rectangle(w / 2, -t / 2, w, t, { isStatic: true }),
      Bodies.rectangle(-t / 2, h / 2, t, h, { isStatic: true }),
      Bodies.rectangle(w + t / 2, h / 2, t, h, { isStatic: true })
    ];
    World.add(engRight.world, walls);
  }
  buildWalls();

  let imgBody = null, imgSprite = null;

  function buildBouncy(texture) {
    if (imgBody) { Composite.remove(engRight.world, imgBody); imgBody = null; }
    if (imgSprite) { imgSprite.destroy(true); imgSprite = null; }

    const w = rightEl.clientWidth, h = Math.max(360, rightEl.clientHeight);

    imgSprite = new PIXI_NS.Sprite(texture);
    imgSprite.anchor.set(0.5);
    appRight.stage.addChild(imgSprite);

    const pad = 40;
    const s = Math.min((w - 2 * pad) / texture.width, (h - 2 * pad) / texture.height);
    imgSprite.scale.set(s);

    const bw = texture.width * s, bh = texture.height * s;

    const restit = parseFloat(sBounce.value);
    const stiff = parseFloat(sStiff.value);
    const cham = parseFloat(sRadius.value) * 0.4;

    imgBody = Bodies.rectangle(w * 0.5, h * 0.25, bw, bh, {
      restitution: restit,
      frictionAir: 0.01 + stiff * 0.03,
      chamfer: { radius: cham }
    });
    World.add(engRight.world, imgBody);

    const mouse = Mouse.create(rightEl);
    const mctl = MouseConstraint.create(engRight, { mouse, constraint: { stiffness: 0.2, damping: 0.1 } });
    World.add(engRight.world, mctl);

    appRight.ticker.add(() => {
      if (!imgBody) return;
      imgSprite.position.set(imgBody.position.x, imgBody.position.y);
      imgSprite.rotation = imgBody.angle;
    });
  }

  /* ------------- 슬라이더: 좌우 동시 반영 ------------- */
  sBounce.addEventListener('input', () => {
    tiles.forEach(t => t.body.restitution = parseFloat(sBounce.value));
    if (imgBody) imgBody.restitution = parseFloat(sBounce.value);
  });
  sStiff.addEventListener('input', () => {
    const v = parseFloat(sStiff.value);
    constraints.forEach(c => { c.stiffness = v; c.damping = 0.08 + (1 - v) * 0.08; });
    if (imgBody) imgBody.frictionAir = 0.01 + v * 0.03;
  });
  sRadius.addEventListener('input', () => {
    grid.size = parseInt(sRadius.value, 10);
    if (baseTex) buildSoftImage(baseTex);
    if (imgBody) imgBody.chamfer = { radius: parseFloat(sRadius.value) * 0.4 };
  });

  /* ------------- 업로드 (중복 클릭 없음) ------------- */
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try {
      const texture = await loadTextureDownscaled(PIXI_NS, file, 2048);
      buildSoftImage(texture);
      buildBouncy(texture);
      syncHeight();
    } catch (e) {
      console.error('이미지 로드 실패:', e);
      alert('이미지를 불러오지 못했어요. 다른 파일로 시도해 주세요.');
    }
  });

  /* ------------- 테스트: 동그라미 스폰 ------------- */
  btnTest.addEventListener('click', () => {
    // 좌측: 기존 이미지/타일 제거 후 동그라미 몇 개
    clearLeft();
    const wL = leftEl.clientWidth, hL = Math.max(360, leftEl.clientHeight);
    const mouseL = Mouse.create(leftEl);
    const mctlL = MouseConstraint.create(engLeft, { mouse: mouseL, constraint: { stiffness: 0.2, damping: 0.1 } });
    World.add(engLeft.world, mctlL);

    for (let i = 0; i < 8; i++) {
      const r = 14 + Math.random()*12;
      const x = 80 + Math.random()*(wL-160);
      const y = 60 + Math.random()*60;
      const g = new PIXI_NS.Graphics().circle(0,0,r).fill(0x333333);
      g.x = x; g.y = y; leftSpritesLayer.addChild(g);

      const b = Bodies.circle(x, y, r, { restitution: parseFloat(sBounce.value), frictionAir: 0.02 });
      World.add(engLeft.world, b);
      tiles.push({ sprite: g, body: b });
    }
    appLeft.ticker.add(()=> {
      tiles.forEach(t => { t.sprite.position.set(t.body.position.x, t.body.position.y); t.sprite.rotation = t.body.angle; });
    });

    // 우측: 이미지 대신 큰 공 하나
    if (imgBody) { Composite.remove(engRight.world, imgBody); imgBody = null; }
    if (imgSprite) { imgSprite.destroy(true); imgSprite = null; }
    const wR = rightEl.clientWidth, hR = Math.max(360, rightEl.clientHeight);
    imgBody = Bodies.circle(wR*0.5, hR*0.25, 60, {
      restitution: parseFloat(sBounce.value),
      frictionAir: 0.015
    });
    World.add(engRight.world, imgBody);
  });

  // 초기 1회
  syncHeight();

  /* ===== 도우미: 큰 이미지를 캔버스로 다운스케일하여 텍스처 생성 ===== */
  async function loadTextureDownscaled(PIXI_NS, file, maxDim = 2048) {
    const blobURL = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = blobURL;
    await img.decode();
    let sw = img.naturalWidth, sh = img.naturalHeight;

    if (Math.max(sw, sh) <= maxDim) {
      // 바로 텍스처
      const tex = await PIXI_NS.Assets.load(blobURL);
      URL.revokeObjectURL(blobURL);
      return tex;
    }

    // 다운스케일
    const scale = maxDim / Math.max(sw, sh);
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, dw, dh);
    URL.revokeObjectURL(blobURL);
    return PIXI_NS.Texture.from(canvas);
  }
});
