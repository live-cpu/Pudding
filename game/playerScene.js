// game/playerScene.js
export class PlayerScene {
  constructor(mount) {
    const { Application, Graphics, Container } = PIXI;
    const { Engine, Runner, World, Bodies, Body } = Matter;

    this.mount = mount;
    this.app = new Application({
      antialias:true,
      autoDensity:true,
      backgroundAlpha:0,
      resizeTo:mount,
      powerPreference:'high-performance',
      preserveDrawingBuffer:true   // 녹화 안정화
    


});
    mount.appendChild(this.app.view);

    this.engine = Engine.create();
    this.runner = Runner.create();
    this.world = this.engine.world;
    this.world.gravity.y = 0.8;

    // ★ 디노 외부 제어 스위치
    this.externalControl = false;

    Runner.run(this.runner, this.engine);

    // 배경 레이어
    this.bgLayer = new Container();
    this.bgGfx   = new Graphics();
    this.bgLayer.addChild(this.bgGfx);
    this.bgSprite = null;
    this.app.stage.addChild(this.bgLayer);

    // 바닥/렌더
    this.groundGfx = new Graphics();
    this.app.stage.addChild(this.groundGfx);

    // 플레이어 렌더(업로드 이미지 스킨)
    this.playerSprite = null;
    this.baseScale = 1;

    // 스쿼시 파라미터
    this.sx = 1; this.sy = 1;
    this.wasOnGround = false;
    this.landPop = 0;

    // 물리 월드
    this._buildWorld();

    // 입력
    this.keys = new Set();
    addEventListener('keydown', this._onKeyDown, { passive:false });
    addEventListener('keyup',   this._onKeyUp);

    // 루프
    this.app.ticker.add(this._update);
  }

  // ★★★ 여기 ‘클래스 레벨’에 메서드 추가 (다른 메서드들과 같은 깊이) ★★★
  setExternalControl(on){
    // 디노 모드에서 외부(dgame.js)가 스프라이트/물리를 직접 제어할 때 true
    this.externalControl = !!on;
  }

  _buildWorld(){
    const { Bodies, World } = Matter;
    const W = this.app.renderer.width;
    const H = this.app.renderer.height;

    // 기존 제거
    if (this.player)   World.remove(this.world, this.player);
    if (this.ground)   World.remove(this.world, this.ground);
    if (this.leftWall) World.remove(this.world, this.leftWall);
    if (this.rightWall)World.remove(this.world, this.rightWall);

    // 바닥
    this.ground = Bodies.rectangle(W/2, H-18, W, 36, { isStatic:true, friction:1, restitution:0 });
    World.add(this.world, this.ground);

    // 좌/우 벽
    const t = 40;
    this.leftWall  = Bodies.rectangle(-t/2,  H/2, t, H, { isStatic:true });
    this.rightWall = Bodies.rectangle(W+t/2, H/2, t, H, { isStatic:true });
    World.add(this.world, [this.leftWall, this.rightWall]);

    // 플레이어 바디
    this.pw = 88; this.ph = 88;
    this.player = Bodies.rectangle(W*0.25, H-100, this.pw, this.ph, {
      friction:0.21, frictionAir:0.155, restitution:0.05
      // inertia: Infinity, // 회전 고정 원하면 주석 해제
    });
    World.add(this.world, this.player);

    // 배경/바닥 그리기
    this._drawBackground();
    this._drawGround();

    // 업로드 전 플레이스홀더
    if (!this.playerSprite) {
      const g = new PIXI.Graphics();
      g.lineStyle(3, 0x242423, 1);
      g.beginFill(0xffffff);
      g.drawRoundedRect(-this.pw/2, -this.ph/2, this.pw, this.ph, 14);
      g.endFill();
      this.playerSprite = g;
      this.app.stage.addChild(this.playerSprite);
    }
  }

  _drawBackground(){
    const W = this.app.renderer.width, H = this.app.renderer.height;
    if (this.bgSprite) {
      const tex = this.bgSprite.texture;
      const scale = Math.max(W / tex.width, H / tex.height);
      this.bgSprite.position.set(W/2, H/2);
      this.bgSprite.scale.set(scale);
      this.bgGfx.clear();
    } else {
      this.bgGfx.clear().beginFill(0xF3FFD1).drawRect(0,0,W,H).endFill();
    }
  }

  _drawGround(){
    const W = this.app.renderer.width, H = this.app.renderer.height;
    this.groundGfx.clear().beginFill(0x6b4023, 1).drawRect(0,0,W,36).endFill();
    this.groundGfx.position.set(0, H-36);
  }

  _onKeyDown = (e)=>{
    if (['ArrowLeft','ArrowRight','ArrowUp',' '].includes(e.key)) e.preventDefault();
    this.keys.add(e.key);
  }
  _onKeyUp   = (e)=>{ this.keys.delete(e.key); }

  _update = ()=>{
    // ★ 디노 외부 제어 중이면 PlayerScene 갱신을 중지 (dgame이 전담)
    if (this.externalControl) return;

    const { Body } = Matter;
    const H = this.app.renderer.height;

    // 좌우 이동
    const F = 0.0030;
    if (this.keys.has('ArrowLeft'))  Body.applyForce(this.player, this.player.position, { x:-F, y:0 });
    if (this.keys.has('ArrowRight')) Body.applyForce(this.player, this.player.position, { x: F, y:0 });

    // 점프
    const onGround = Math.abs(this.player.position.y - (H-36 - this.ph/2)) < 4 && Math.abs(this.player.velocity.y) < 0.3;
    if ((this.keys.has('ArrowUp') || this.keys.has(' ')) && onGround) {
      Body.setVelocity(this.player, { x:this.player.velocity.x, y:-9.2 });
    }

    // 착지 팝
    if (onGround && !this.wasOnGround) this.landPop = Math.min(Math.abs(this.player.velocity.y)/20, 2);
    this.wasOnGround = onGround;
    this.landPop *= 0.86;

    // 스쿼시/스트레치
    const vy = this.player.velocity.y;
    const t  = Math.min(Math.abs(vy)/8, 0.35);
    let targetSX = 1 + (vy > 0 ? 0.52*t : -0.18*t) + this.landPop*1.2;
    let targetSY = 1 + (vy < 0 ? 0.95*t : -0.25*t) - this.landPop*1;
    const lerp = (a,b,t)=>a+(b-a)*t;
    this.sx = lerp(this.sx, targetSX, 0.25);
    this.sy = lerp(this.sy, targetSY, 0.25);

    // 렌더 동기화
    if (this.playerSprite) {
      this.playerSprite.position.set(this.player.position.x, this.player.position.y);
      this.playerSprite.rotation = this.player.angle;
      this.playerSprite.scale.set(this.baseScale*this.sx, this.baseScale*this.sy);
    }
 }
// ★ PlayerScene 클래스 내부(다른 메서드들과 같은 깊이)에 추가
getColliderRect(){
  // Matter 바디(사각형)의 현재 중심/폭/높이 기준
  const { x, y } = this.player.position;
  const w = this.pw, h = this.ph;   // _buildWorld에서 설정한 바디 크기
  return { x: x - w/2, y: y - h/2, w, h };
}
 

 



  // 업로드 이미지로 "플레이어 스킨" 교체
  async setPlayerTexture(input){
    let tex;
    if (input instanceof PIXI.Texture) tex = input;
    else if (typeof input === 'string') tex = await PIXI.Texture.fromURL(input);

    if (this.playerSprite) { this.app.stage.removeChild(this.playerSprite); this.playerSprite.destroy(true); }

    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5);
    this.baseScale = Math.min(this.pw / tex.width, this.ph / tex.height);
    sp.position.set(this.player.position.x, this.player.position.y);
    sp.rotation = this.player.angle;
    sp.scale.set(this.baseScale*this.sx, this.baseScale*this.sy);

    this.playerSprite = sp;
    this.app.stage.addChild(this.playerSprite);
  }

  // 배경 이미지 교체
  async setBackground(input){
    let tex;
    if (input instanceof PIXI.Texture) tex = input;
    else if (typeof input === 'string') tex = await PIXI.Texture.fromURL(input);

    if (this.bgSprite) { this.bgLayer.removeChild(this.bgSprite); this.bgSprite.destroy(true); this.bgSprite = null; }

    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5);
    this.bgSprite = sp;
    this.bgLayer.addChildAt(this.bgSprite, 0);
    this._drawBackground();
  }

  resize(){
    this.app.renderer.resize(this.mount.clientWidth, this.mount.clientHeight);
    this._buildWorld();
  }
}
