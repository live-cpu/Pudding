// game/dgame.js
// Dino runner inside the PlayerScene (uses uploaded skin).
// Adds 6-layer parallax + randomized obstacle variants.

export class DinoGame {
  constructor(player) {
    this.player = player;
    this.app    = player.app;
    this.stage  = player.app.stage;

    // === HUD ===
    this.layer  = new PIXI.Container(); // obstacles
    this.hud    = new PIXI.Container();
    this.txt    = new PIXI.Text('', { fill:0x242423, fontSize:16, fontWeight:'bold' });
    this.msg    = new PIXI.Text('', { fill:0x242423, fontSize:22, fontWeight:'bold' });
    this.hud.addChild(this.txt, this.msg);

    this.running = false;
    this.dead    = false;
    this.score   = 0;
    this.best    = 0;

    // ===== Tunables =====
    this.startSpeed = 280;
    this.baseAccel  = 55;     // 기본 가속
    this.maxSpeed   = 800;    // 최고속도
    this.accelBoostPerScore = 0.7 ; // 점수당 가속 보너스
    this.accelBoostMax      = 12;

    this.gravity = 1250;
    this.jumpV   = -540;
    this.spawnIn = 0.8;

    // Sprite state
    this.x = 0; this.y = 0; this.vy = 0; this.onGround = true;
    this.sx = 1; this.sy = 1; this.landPop = 0;

    this._keyDown = this._keyDown.bind(this);
    this._loop    = this._loop.bind(this);

    this.obstacles = [];

    // === Parallax ===
    this.PARALLAX_SRC = [
      new URL('./parallax/01.png', import.meta.url).href,
      new URL('./parallax/02.png', import.meta.url).href,
      new URL('./parallax/03.png', import.meta.url).href,
      new URL('./parallax/04.png', import.meta.url).href,
      new URL('./parallax/05.png', import.meta.url).href,
      new URL('./parallax/06.png', import.meta.url).href,
    ];
    // 멀리(작게) → 가까이(크게)
    this.PARALLAX_FACTORS = [0.12, 0.2, 0.35, 0.55, 0.8, 1.0];

    this.parallaxContainer = null;
    this.parallaxLayers = []; // [{ts, factor, tex}]
    this._onResize = ()=> this._resizeParallax();
  }

  // ---------------- public ----------------
  start(){
    if (this.running) return;

    // 외부 제어 & Matter stop
    this.player.setExternalControl(true);
    if (this.player.runner) Matter.Runner.stop(this.player.runner);

    // HUD/오브젝트 레이어 부착
    this.stage.addChild(this.layer);
    this.stage.addChild(this.hud);

    // 상태 초기화
    const W = this.app.renderer.width;
    const H = this.app.renderer.height;
    this.groundY = H - 36 - this.player.ph/2;
    this.x = Math.max(80, W * 0.22);
    this.y = this.groundY;
    this.vy = 0; this.onGround = true;
    this.dead = false; this.score = 0;

    this.speed   = this.startSpeed;
    this.spawnIn = 0.8;

    // 업로드 스킨(없으면 플레이스홀더)
    const sp = this.player.playerSprite ?? this._ensurePlaceholder();
    sp.rotation = 0;
    this._applySpriteTransform(sp);

    // HUD
    this._updateHud();
    this.msg.text = ''; this._centerMsg();

    // === Parallax on ===
    this._enableParallax();

    // 루프
    addEventListener('keydown', this._keyDown, { passive:false });
    addEventListener('resize', this._onResize);
    this.last = performance.now();
    this.running = true;
    this.app.ticker.add(this._loop);
  }

  stop(){
    if (!this.running) return;
    this.running = false;

    removeEventListener('keydown', this._keyDown);
    removeEventListener('resize', this._onResize);
    this.app.ticker.remove(this._loop);

    // 레이어 정리
    this.obstacles.forEach(g=>g.destroy?.());
    this.obstacles.length = 0;
    this.layer.removeChildren();
    this.stage.removeChild(this.layer);
    this.stage.removeChild(this.hud);

    // === Parallax off ===
    this._disableParallax();

    // PlayerScene로 복귀
    if (this.player.player){
      const Body = Matter.Body;
      Body.setPosition(this.player.player, { x:this.x, y:this.y });
      Body.setVelocity(this.player.player, { x:0, y:0 });
    }
    if (this.player.runner) Matter.Runner.run(this.player.runner, this.player.engine);
    this.player.setExternalControl(false);
  }

  // ---------------- loop & input ----------------
  _keyDown(e){
    if ([' ','ArrowUp'].includes(e.key)){
      e.preventDefault();
      if (this.dead){
        // 재시작
        this.speed   = this.startSpeed;
        this.spawnIn = 0.8;
        this.score = 0; this.dead = false;
        this._updateHud(); this.msg.text = ''; this._centerMsg();
        this.obstacles.forEach(g=>g.destroy?.()); this.obstacles = [];
        this.x = Math.max(80, this.app.renderer.width*0.22);
        this.y = this.groundY; this.vy = 0; this.onGround = true;
        return;
      }
      if (this.onGround){ this.vy = this.jumpV; this.onGround = false; }
    }
  }

  _loop(){
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last)/1000); // clamp
    this.last = now;

    if (!this.dead){
      // 가속 = 기본 + 점수 보너스
      const accelBoost = Math.min(this.accelBoostMax, this.score * this.accelBoostPerScore);
      const accel = this.baseAccel + accelBoost;
      this.speed = Math.min(this.maxSpeed, this.speed + accel * dt);

      // 중력/점프
      this.vy += this.gravity * dt;
      this.y  += this.vy * dt;
      if (this.y >= this.groundY){
        if (!this.onGround) this.landPop = Math.min(Math.abs(this.vy)/600, 0.5);
        this.y = this.groundY; this.vy = 0; this.onGround = true;
      }

      // 장애물 스폰/이동
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) this._spawn();
      const vx = -this.speed * dt;
      for (const c of this.obstacles) c.x += vx;

      // 화면 밖 제거
      while (this.obstacles.length && this.obstacles[0].x + this.obstacles[0].pxW/2 < -10){
        this.layer.removeChild(this.obstacles[0]);
        this.obstacles.shift();
      }

      // 충돌/점수
      for (const c of this.obstacles){
        const pr = { x:this.x, y:this.y, w:this.player.pw, h:this.player.ph };
        const cr = { x:c.x, y:c.y - c.pxH/2, w:c.pxW, h:c.pxH };
        const hit = Math.abs(pr.x - cr.x) < (pr.w/2 + cr.w/2)
                 && Math.abs(pr.y - cr.y) < (pr.h/2 + cr.h/2);
        if (hit){ this._die(); break; }
        if (!c.passed && c.x + c.pxW/2 < this.x - pr.w/2){
          c.passed = true; this.score++; this._updateHud();
        }
      }
    }

    // 젤리 스쿼시/스트레치
    this.landPop *= 0.86;
    const t  = Math.min(Math.abs(this.vy)/600, 0.35);
    let targetSX = 1 + (this.vy > 0 ? 0.22*t : -0.12*t) + this.landPop*0.6;
    let targetSY = 1 + (this.vy < 0 ? 0.35*t : -0.18*t) - this.landPop*0.5;
    const lerp = (a,b,t)=>a+(b-a)*t;
    this.sx = lerp(this.sx, targetSX, 0.25);
    this.sy = lerp(this.sy, targetSY, 0.25);

    this._applySpriteTransform(this.player.playerSprite);

    // === Parallax scroll ===
    this._updateParallax(dt);
  }

  // ---------------- render helpers ----------------
  _applySpriteTransform(sp){
    if (!sp) return;
    sp.position.set(this.x, this.y);
    sp.rotation = 0;
    sp.scale.set(this.player.baseScale * this.sx, this.player.baseScale * this.sy);
  }

  // ---- 랜덤 헬퍼 (※ 클래스 레벨! constructor 밖) ----
  _rand(min, max){ return Math.random() * (max - min) + min; }
  _randi(min, max){ return Math.floor(this._rand(min, max + 1)); }
  _pickWeighted(entries){ // [ [value, weight], ... ]
    const sum = entries.reduce((a,[,w])=>a+w,0);
    let r = Math.random()*sum;
    for (const [v,w] of entries){ r -= w; if (r <= 0) return v; }
    return entries[0][0];
  }

  _spawn(){
    // 어떤 형태를 뽑을지 가중 랜덤
    const variant = this._pickWeighted([
      ['single', 4],   // 보통 1개
      ['wide',   3],   // 가로로 길쭉
      ['tall',   2],   // 세로로 길쭉
      ['pair',   2],   // 2개 나란히
      ['stack',  1],   // 위로 쌓기
      ['triple', 1],   // 3연속
    ]);

    const groundY = this.app.renderer.height - 36;
    const startX  = this.app.renderer.width;
    const created = [];

    const make = (w,h,dx=0,dy=0)=>{
      const g = new PIXI.Graphics();
      g.beginFill(0x3c3c3c);
      g.drawRect(-w/2, -h, w, h); // 바닥 기준 위로 h
      g.endFill();
      g.pxW = w; g.pxH = h;
      g.x = startX + w/2 + dx;
      g.y = groundY + dy;
      g.passed = false;
      this.layer.addChild(g);
      this.obstacles.push(g);
      created.push(g);
    };

    switch(variant){
      case 'single': {
        const w = this._randi(16,28);
        const h = this._randi(30,60);
        make(w,h);
        break;
      }
      case 'wide': { // 가로로 긴 박스
        const w = this._randi(40,90);
        const h = this._randi(22,36);
        make(w,h);
        break;
      }
      case 'tall': { // 세로로 긴 박스
        const w = this._randi(14,22);
        const h = this._randi(60,96);
        make(w,h);
        break;
      }
      case 'pair': { // 2개 나란히
        const w1 = this._randi(16,28), h1 = this._randi(28,56);
        const gap = this._randi(24,40);
        make(w1,h1,0,0);
        const w2 = this._randi(16,28), h2 = this._randi(28,56);
        make(w2,h2,(w1/2)+gap+(w2/2),0);
        break;
      }
      case 'stack': { // 위로 2단 쌓기
        const w = this._randi(18,26);
        const h1 = this._randi(24,40);
        const h2 = this._randi(24,40);
        make(w,h1,0,0);
        make(Math.round(w*0.9),h2,0,-h1); // 1단 위에 2단
        break;
      }
      case 'triple': { // 3연속
        const w = this._randi(16,26);
        const gap = this._randi(20,34);
        const hA = this._randi(30,60);
        const hB = this._randi(30,60);
        const hC = this._randi(30,60);
        make(w,hA,0,0);
        make(w,hB,(w+gap),0);
        make(w,hC,(2*w+2*gap),0);
        break;
      }
    }

    // --- 다음 스폰 간격: 묶음(클러스터) 너비/현재 속도 고려 ---
    let clusterW = 30;
    if (created.length){
      const first = created[0];
      const last  = created[created.length-1];
      clusterW = (last.x + last.pxW/2) - (first.x - first.pxW/2); // 전체 가로폭
    }

    // 기본 템포 + 속도 영향(완화) + 랜덤
    const base = 1.1, varr = 0.8;
    const slow = (this.speed - this.startSpeed) / 1400;
    const timeGap = Math.max(0.70, base - slow) + Math.random()*varr;

    // 클러스터가 클수록 여유를 더 줌 (px → 초 변환)
    const pxPerSec = Math.max(180, this.speed + 1);
    const extra = clusterW / pxPerSec;

    this.spawnIn = timeGap + extra;
  }

  _updateHud(){
    this.best = Math.max(this.best, this.score);
    this.txt.text = `SCORE ${String(this.score).padStart(3,'0')}   BEST ${String(this.best).padStart(3,'0')}`;
    this.txt.position.set(this.app.renderer.width - this.txt.width - 12, 10);
  }

  _centerMsg(){
    this.msg.position.set((this.app.renderer.width - this.msg.width)/2, 44);
  }

  _die(){
    this.dead = true;
    this.speed = 0;
    this.msg.text = 'GAME OVER — SPACE to RESTART';
    this._centerMsg();
  }

  _ensurePlaceholder(){
    const g = new PIXI.Graphics();
    g.lineStyle(3, 0x242423, 1);
    g.beginFill(0xffffff);
    g.drawRoundedRect(-this.player.pw/2, -this.player.ph/2, this.player.pw, this.player.ph, 14);
    g.endFill();
    this.player.playerSprite = g;
    this.stage.addChild(g);
    return g;
  }

  // ---------------- parallax ----------------
  async _enableParallax(){
    // 기존 정적 배경은 숨김
    if (this.player.bgSprite) this.player.bgSprite.visible = false;

    // 컨테이너 준비 (bgLayer 맨 아래에 붙임)
    if (!this.parallaxContainer){
      this.parallaxContainer = new PIXI.Container();
      this.player.bgLayer.addChildAt(this.parallaxContainer, 0);
    } else {
      this.parallaxContainer.removeChildren();
    }
    this.parallaxLayers = [];

    const W = this.app.renderer.width;
    const H = this.app.renderer.height;

    // 텍스처 로드
    const textures = await Promise.all(this.PARALLAX_SRC.map(src => PIXI.Texture.fromURL(src)));

    // 멀리→가까이 순서로 깔기
    textures.forEach((tex, i)=>{
      const ts = new PIXI.TilingSprite(tex, W, H);
      const s = Math.max(W/tex.width, H/tex.height); // 화면 채우기 스케일
      ts.tileScale.set(s);
      ts.position.set(0, 0);
      this.parallaxContainer.addChild(ts);
      this.parallaxLayers.push({ ts, factor: this.PARALLAX_FACTORS[i], tex });
    });

    this._resizeParallax(); // 정렬
  }

  _disableParallax(){
    if (this.parallaxContainer){
      this.parallaxContainer.removeChildren();
      this.player.bgLayer.removeChild(this.parallaxContainer);
      this.parallaxContainer.destroy({ children:true });
      this.parallaxContainer = null;
      this.parallaxLayers = [];
    }
    // 정적 배경 원복
    if (this.player.bgSprite) this.player.bgSprite.visible = true;
  }

  _resizeParallax(){
    if (!this.parallaxContainer) return;
    const W = this.app.renderer.width;
    const H = this.app.renderer.height;

    // 각 레이어의 타일 크기/스케일 갱신
    for (const L of this.parallaxLayers){
      const tex = L.tex;
      const s = Math.max(W/tex.width, H/tex.height);
      L.ts.width  = W;
      L.ts.height = H;
      L.ts.tileScale.set(s);
    }
  }

  _updateParallax(dt){
    if (!this.parallaxLayers.length) return;
    // 디노 이동속도에 비례한 스크롤
    for (const L of this.parallaxLayers){
      L.ts.tilePosition.x -= this.speed * L.factor * dt;
    }
  }
}
