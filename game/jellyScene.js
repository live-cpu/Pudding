// 워프형 푸딩: SimpleMesh + Matter 소프트바디 + 자동 통통
export class JellyScene {
  constructor(mount) {
    const { Application, Container } = PIXI;
    const { Engine, Runner } = Matter;

    this.mount = mount;
    this.app = new Application({
   antialias:true,
   autoDensity:true,
   backgroundAlpha:0,
   resizeTo:mount,
   powerPreference:'high-performance',
   preserveDrawingBuffer:true   // ★ 캔버스 내용 유지 (녹화시 필수)
 });


    mount.appendChild(this.app.view);

    this.engine = Engine.create();
    this.runner = Runner.create();
    Runner.run(this.runner, this.engine);
    this.world = this.engine.world;
    this.world.gravity.y = 2.8;

    this.stage = new Container();
    this.app.stage.addChild(this.stage);

    // 해상도/물성
    this.segX = 12;
    this.segY = 8;
    this.stiffness = 0.12;
    this.damping   = 0.22;

    // 자동 통통 파라미터
    this.auto = { freq: 3.1, amp: 18, t: 0, lastS: 0 };

    this.baseTexture = null;
    this.mesh = null;
    this.vertices = null; this.uvs = null; this.indices = null;
    this.particles = []; this.constraints = [];
    this.pinA = null; this.pinB = null; this.pinY0A = 0; this.pinY0B = 0;

    this._buildBounds();
    this._buildSoftMesh(null);

    this.app.ticker.add(this._update);
  }

  _buildBounds(){
    const { Bodies, World, Body } = Matter;
    const w = this.app.renderer.width, h = this.app.renderer.height, t = 40;
    if (this.bounds) World.remove(this.world, this.bounds);
    const floor = Bodies.rectangle(w/2, h+t/2, w, t, { isStatic:true, restitution:0.5 });
    const ceil  = Bodies.rectangle(w/2,-t/2, w, t, { isStatic:true });
    const left  = Bodies.rectangle(-t/2, h/2, t, h, { isStatic:true });
    const right = Bodies.rectangle(w+t/2, h/2, t, h, { isStatic:true });
    this.bounds = Body.create({ parts:[floor, ceil, left, right], isStatic:true });
    World.add(this.world, this.bounds);
  }

  _buildSoftMesh(baseTexture){
    const { Bodies, Constraint, World } = Matter;
    const { Texture, SimpleMesh } = PIXI;

    // 정리
    this.particles.forEach(p => World.remove(this.world, p));
    this.particles = [];
    this.constraints.forEach(c => World.remove(this.world, c));
    this.constraints = [];
    if (this.mesh) { this.stage.removeChild(this.mesh); this.mesh.destroy(); this.mesh = null; }
    this.pinA = this.pinB = null;

    // 영역
    const w = this.app.renderer.width, h = this.app.renderer.height;
    const softW = Math.min(w*0.8, 560);
    const softH = Math.min(h*0.6, 380);
    const startX = (w - softW)/2;
    const startY = (h - softH)/2;

    const cols = this.segX, rows = this.segY;
    const vxCount = (cols+1)*(rows+1);
    this.vertices = new Float32Array(vxCount*2);
    this.uvs      = new Float32Array(vxCount*2);
    this.indices  = new Uint16Array(cols*rows*6);

    const cellW = softW/cols, cellH = softH/rows;
    const idx = (ix,iy)=> iy*(cols+1)+ix;

    // 파티클 + 초기 버퍼
    for (let iy=0; iy<=rows; iy++){
      for (let ix=0; ix<=cols; ix++){
        const x = startX + ix*cellW;
        const y = startY + iy*cellH;
        const body = Bodies.circle(x, y, Math.min(cellW,cellH)*0.28, {
          restitution:0.35, frictionAir:0.02, friction:0.01
        });
        this.particles.push(body); World.add(this.world, body);

        const vi = idx(ix,iy)*2;
        this.vertices[vi]=x; this.vertices[vi+1]=y;
        this.uvs[vi]=ix/cols; this.uvs[vi+1]=iy/rows;
      }
    }

    // 인덱스
    let k=0;
    for (let iy=0; iy<rows; iy++){
      for (let ix=0; ix<cols; ix++){
        const i0=idx(ix,iy), i1=idx(ix+1,iy), i2=idx(ix,iy+1), i3=idx(ix+1,iy+1);
        this.indices[k++]=i0; this.indices[k++]=i2; this.indices[k++]=i1;
        this.indices[k++]=i1; this.indices[k++]=i2; this.indices[k++]=i3;
      }
    }

    // 스프링
    const link=(a,b,scale=1)=>{
      const len=scale*Math.hypot(b.position.x-a.position.x,b.position.y-a.position.y);
      const c=Constraint.create({bodyA:a,bodyB:b,length:len,stiffness:this.stiffness,damping:this.damping});
      this.constraints.push(c); World.add(this.world,c);
    };
    for (let iy=0; iy<=rows; iy++){
      for (let ix=0; ix<=cols; ix++){
        const a=this.particles[idx(ix,iy)];
        if(ix+1<=cols) link(a,this.particles[idx(ix+1,iy)]);
        if(iy+1<=rows) link(a,this.particles[idx(ix,iy+1)]);
        if(ix+1<=cols&&iy+1<=rows) link(a,this.particles[idx(ix+1,iy+1)],Math.SQRT2);
        if(ix-1>=0&&iy+1<=rows)     link(a,this.particles[idx(ix-1,iy+1)],Math.SQRT2);
      }
    }

    // 핀(상단 모서리)
    this.pinA = Matter.Constraint.create({
      pointA:{x:startX,y:startY - cellH*0.8},
      bodyB:this.particles[idx(0,0)],
      length:cellH*0.9, stiffness:0.25, damping:this.damping
    });
    this.pinB = Matter.Constraint.create({
      pointA:{x:startX+softW,y:startY - cellH*0.8},
      bodyB:this.particles[idx(cols,0)],
      length:cellH*0.9, stiffness:0.25, damping:this.damping
    });
    this.pinY0A = this.pinA.pointA.y; this.pinY0B = this.pinB.pointA.y;
    World.add(this.world,[this.pinA,this.pinB]);

    // 메쉬
    const tex = baseTexture ? new Texture(baseTexture) : PIXI.Texture.WHITE;
    this.mesh = new PIXI.SimpleMesh(tex, this.vertices, this.uvs, this.indices, PIXI.DRAW_MODES.TRIANGLES);
    if (!baseTexture) this.mesh.tint = 0xD6FF3D;
    this.stage.addChild(this.mesh);
  }

  _update = ()=>{
    // 자동 통통: 상단 핀 사인파 이동 + 상승 시작 타이밍에 바닥행 임펄스
    const dt = this.app.ticker.deltaMS/1000;
    this.auto.t += dt;
    const w = 2*Math.PI*this.auto.freq;
    const s = Math.sin(this.auto.t*w);
    const offset = s * this.auto.amp;

    if (this.pinA) { this.pinA.pointA.y = this.pinY0A + offset; }
    if (this.pinB) { this.pinB.pointA.y = this.pinY0B + offset; }

    // 음→양 교차(위로 튀기 시작) 순간 살짝 펀치
    if (this.auto.lastS <= 0 && s > 0) {
      const rows = this.segY;
      const cols = this.segX;
      const idx = (ix,iy)=> iy*(cols+1)+ix;
      const force = -0.0022; // 위로
      for (let ix=0; ix<=cols; ix++){
        const p = this.particles[idx(ix, rows)];
        Matter.Body.applyForce(p, p.position, { x:0, y:force });
      }
    }
    this.auto.lastS = s;

    // 파티클 → 메쉬 버퍼 반영
    for (let i=0;i<this.particles.length;i++){
      const p=this.particles[i].position;
      this.vertices[i*2]=p.x; this.vertices[i*2+1]=p.y;
    }
    const posBuf = this.mesh.geometry.getBuffer('aVertexPosition');
    posBuf.update(this.vertices);
  }

  async setImage(input){
    let baseTex;
    if (input instanceof PIXI.Texture) baseTex = input.baseTexture;
    else if (typeof input === 'string') {
      const tex = await PIXI.Texture.fromURL(input);
      baseTex = tex.baseTexture;
    }
    this.baseTexture = baseTex;
    this._buildSoftMesh(this.baseTexture);
  }

  resize(){
    this.app.renderer.resize(this.mount.clientWidth, this.mount.clientHeight);
    this._buildBounds();
    this._buildSoftMesh(this.baseTexture || null);
  }
}
