// left-app.js — PixiJS v7 SimplePlane stretch (고정형 + CodePen 스타일 인터랙션)
/* global PIXI */
(() => {
  // ====== Config ======
  const CONFIG = {
    gridTargetSpacing: 18,
    minCols: 8,
    minRows: 8,
    maxCols: 64,
    maxRows: 64,
    mapStiffness: (ctl) => {
      const v = Math.max(0.01, Math.min(0.2, Number(ctl)));
      const t = (v - 0.01) / (0.2 - 0.01);
      return 5 + (200 - 5) * t;
    },
    mapDamping: (ctl) => {
      const v = Math.max(0, Math.min(1, Number(ctl)));
      return 22 + (2.5 - 22) * v;
    },
    mapScale: (ctl) => {
      const v = Math.max(10, Math.min(80, Number(ctl)));
      const t = (v - 10) / (80 - 10);
      return 0.5 + (1.6 - 0.5) * t;
    },
    pointerInfluence: 8.0,   // ← 세게 조정 (CodePen 느낌)
    influenceRadius: 280,
  };

  // ====== DOM ======
  const host = document.getElementById("puddingStage");
  const rightCol = document.getElementById("rightCol");
  const fileInput = document.getElementById("file");
  const radiusSlider = document.getElementById("ctlRadius");
  const stiffSlider = document.getElementById("ctlStiff");
  const bounceSlider = document.getElementById("ctlBounce");

  if (!host) return;
  console.log("[left-app] boot PIXI", (PIXI && PIXI.VERSION) || "n/a");

  // ====== Fixed Stage Size ======
  function measureFixedSize() {
    const hostRect = host.getBoundingClientRect();
    const width = Math.max(320, Math.round(hostRect.width));
    const height = Math.max(360, rightCol ? rightCol.offsetHeight : 480);
    return { width, height };
  }
  const { width: STAGE_W, height: STAGE_H } = measureFixedSize();

  const app = new PIXI.Application({
    width: STAGE_W,
    height: STAGE_H,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preserveDrawingBuffer: true, 
  });
  app.view.style.width = STAGE_W + "px";
  app.view.style.height = STAGE_H + "px";
  host.replaceChildren(app.view);
window.leftApp = app;
console.log("[left-app] expose leftApp:", !!window.leftApp);


  // ====== State ======
  let plane, geoBuf, rest, pos, vel;
  let cols = 0, rows = 0, imgW = 0, imgH = 0;
  let scaleNow = 1;
  let stiffness = CONFIG.mapStiffness(stiffSlider?.value ?? 0.03);
  let damping = CONFIG.mapDamping(bounceSlider?.value ?? 0.6);

  const pointer = { x: 0, y: 0, down: false };

  // ====== Utils ======
  function gridFromSize(w, h) {
    const c = Math.round(
      Math.max(CONFIG.minCols, Math.min(CONFIG.maxCols, w / CONFIG.gridTargetSpacing))
    );
    const r = Math.round(
      Math.max(CONFIG.minRows, Math.min(CONFIG.maxRows, h / CONFIG.gridTargetSpacing))
    );
    return { cols: c, rows: r };
  }
  function getVertexBuffer(geom) {
    let b = geom.getBuffer("aVertexPosition");
    if (!b) b = geom.getBuffer("aPosition");
    return b;
  }
  function toLocal(x, y) {
    if (!plane) return new PIXI.Point(0, 0);
    const inv = plane.worldTransform.clone().invert();
    const pt = new PIXI.Point(x, y);
    return inv.apply(pt);
  }

  // ====== Plane 생성 ======
  function makePlane(tex) {
    if (plane) app.stage.removeChild(plane);

    imgW = tex.width;
    imgH = tex.height;
    const g = gridFromSize(imgW, imgH);
    cols = g.cols;
    rows = g.rows;

    plane = new PIXI.SimplePlane(tex, cols, rows);
    plane.eventMode = "none";
    app.stage.addChild(plane);

    scaleNow = CONFIG.mapScale(radiusSlider?.value ?? 36);
    layoutPlane();

    geoBuf = getVertexBuffer(plane.geometry);
    if (!geoBuf) return;

    const verts = geoBuf.data;
    rest = new Float32Array(verts.length);
    pos = new Float32Array(verts.length);
    vel = new Float32Array(verts.length);

    for (let i = 0; i < verts.length; i++) {
      rest[i] = verts[i];
      pos[i] = verts[i];
      vel[i] = 0;
    }
  }

  function layoutPlane() {
    if (!plane) return;
    const stageW = STAGE_W, stageH = STAGE_H;

    const baseScale = Math.min(stageW / imgW, stageH / imgH) * 0.9;
    plane.scale.set(baseScale * scaleNow);

    plane.x = (stageW - imgW * plane.scale.x) * 0.5;
    plane.y = (stageH - imgH * plane.scale.y) * 0.5;

    if (geoBuf) {
      const verts = geoBuf.data;
      for (let i = 0; i < verts.length; i++) {
        rest[i] = verts[i];
        pos[i] = verts[i];
        vel[i] = 0;
      }
      geoBuf.update();
    }
    app.renderer.render(app.stage);
  }

  // ====== Pointer Interaction ======
  app.view.addEventListener("pointerdown", (e) => {
    pointer.down = true;
    updatePointer(e);
  });
  app.view.addEventListener("pointerup", () => { pointer.down = false; });
  app.view.addEventListener("pointerleave", () => { pointer.down = false; });
  app.view.addEventListener("pointermove", updatePointer);
  function updatePointer(e) {
    const rect = app.view.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
  }

  // ====== Ticker ======
  let lastMS = performance.now();
  app.ticker.add(() => {
    if (!plane || !geoBuf || !pos || !rest || !vel) return;

    const now = performance.now();
    const dt = Math.min(0.045, (now - lastMS) / 1000);
    lastMS = now;

    const verts = geoBuf.data;
    const localPt = toLocal(pointer.x, pointer.y);

    const k = stiffness;
    const c = damping;
    const damp = Math.exp(-c * dt);

    const infR = CONFIG.influenceRadius / (plane.scale.x || 1);
    const infPow = CONFIG.pointerInfluence;

    for (let i = 0; i < verts.length; i += 2) {
      const dx = pos[i] - rest[i];
      const dy = pos[i + 1] - rest[i + 1];
      let ax = -k * dx;
      let ay = -k * dy;

      if (pointer.down) {
        const dlx = pos[i] - localPt.x;
        const dly = pos[i + 1] - localPt.y;
        const d2 = dlx * dlx + dly * dly;
        const r2 = infR * infR;
        if (d2 < r2) {
          const w = Math.exp(-d2 / (r2 * 0.6));
          ax += -(dlx) * infPow * w;
          ay += -(dly) * infPow * w;
        }
      }

      vel[i] = (vel[i] + ax * dt) * damp;
      vel[i + 1] = (vel[i + 1] + ay * dt) * damp;
      pos[i] += vel[i] * dt;
      pos[i + 1] += vel[i + 1] * dt;

      verts[i] = pos[i];
      verts[i + 1] = pos[i + 1];
    }

    geoBuf.update();
  });

  // ====== File Handling ======
  function handleFile() {
    const f = fileInput?.files?.[0];
    if (!f) return;
    console.log("[left-app] file change", f.name);
    const url = URL.createObjectURL(f);
    const tex = PIXI.Texture.from(url);
    const bt = tex.baseTexture;
    const onReady = () => {
      onTextureReady(tex, url);
      bt.off("loaded", onReady);
      bt.off("error", onErr);
    };
    const onErr = (e) => {
      console.error("[left-app] texture load error", e);
      URL.revokeObjectURL(url);
    };
    if (bt.valid) onReady();
    else {
      bt.once("loaded", onReady);
      bt.once("error", onErr);
    }
  }
  function onTextureReady(tex, url) {
    makePlane(tex);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  if (fileInput) {
    fileInput.addEventListener("change", handleFile);
    if (fileInput.files && fileInput.files[0]) handleFile();
  }

  // ====== Sliders ======
  if (radiusSlider) {
    radiusSlider.addEventListener("input", () => {
      scaleNow = CONFIG.mapScale(radiusSlider.value);
      layoutPlane();
    });
  }
  if (stiffSlider) {
    stiffSlider.addEventListener("input", () => {
      stiffness = CONFIG.mapStiffness(stiffSlider.value);
    });
  }
  if (bounceSlider) {
    bounceSlider.addEventListener("input", () => {
      damping = CONFIG.mapDamping(bounceSlider.value);
    });
  }



})();



