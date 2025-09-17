// === Transparent wave overlay (sticker theme friendly) ===
class Grad { constructor(x,y,z){ this.x=x; this.y=y; this.z=z } dot2(x,y){ return this.x*x + this.y*y } }
class Noise {
  constructor(seed=0){
    this.grad3=[new Grad(1,1,0),new Grad(-1,1,0),new Grad(1,-1,0),new Grad(-1,-1,0),
                new Grad(1,0,1),new Grad(-1,0,1),new Grad(1,0,-1),new Grad(-1,0,-1),
                new Grad(0,1,1),new Grad(0,-1,1),new Grad(0,1,-1),new Grad(0,-1,-1)];
    this.p=[]; for(let i=0;i<256;i++) this.p[i]=Math.floor(Math.random()*256);
    this.perm=new Array(512); this.gradP=new Array(512); this.seed(seed);
  }
  seed(seed){ if(seed>0&&seed<1) seed*=65536; seed=Math.floor(seed); if(seed<256) seed|=seed<<8;
    for(let i=0;i<256;i++){ const v=(i&1)? this.p[i]^(seed&255) : this.p[i]^((seed>>8)&255);
      this.perm[i]=this.perm[i+256]=v; this.gradP[i]=this.gradP[i+256]=this.grad3[v%12]; } }
  fade(t){ return t*t*t*(t*(t*6-15)+10) }
  lerp(a,b,t){ return (1-t)*a + t*b }
  perlin2(x,y){
    let X=Math.floor(x), Y=Math.floor(y); x-=X; y-=Y; X&=255; Y&=255;
    const n00=this.gradP[X+this.perm[Y]].dot2(x,y);
    const n01=this.gradP[X+this.perm[Y+1]].dot2(x,y-1);
    const n10=this.gradP[X+1+this.perm[Y]].dot2(x-1,y);
    const n11=this.gradP[X+1+this.perm[Y+1]].dot2(x-1,y-1);
    const u=this.fade(x); return this.lerp(this.lerp(n00,n10,u), this.lerp(n01,n11,u), this.fade(y));
  }
}

(() => {
  const canvas = document.getElementById("wave-canvas");
  if (!canvas) return;

  // ★ 투명 컨텍스트
  const ctx = canvas.getContext("2d", { alpha: true });

  let w=0, h=0, dpr=1;
  function resize(){
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    setLines();
  }
  window.addEventListener("resize", resize);

  // 스티커 테마 컬러 읽기
  function cssVar(name, fallback){ const v=getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback; }
  const LINE = cssVar("--st-line", "#6b4023");

  const noise = new Noise(Math.random());
  let mouse = { x: 0, y: 0 };
  window.addEventListener("mousemove", e => { mouse.x = e.clientX; mouse.y = e.clientY; });

  // ★ 촘촘함 낮춰서 ‘하양 도배’ 방지
  let xGap = 120, yGap = 28, waveAmpX = 28, waveAmpY = 14;
  let lines = [];

  function setLines(){
    lines = [];
    const totalLines  = Math.ceil((w + 200) / xGap);
    const totalPoints = Math.ceil((h +  30) / yGap);
    for (let i=0; i<=totalLines; i++){
      const pts=[];
      for (let j=0; j<=totalPoints; j++){ pts.push({ x:i*xGap, y:j*yGap }); }
      lines.push(pts);
    }
  }

  resize();

  function tick(time){
    // ★ 배경 칠 X — 투명 유지
    ctx.clearRect(0,0,w,h);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = LINE;
    ctx.globalAlpha = 0.18; // ★ 연하게
    ctx.lineWidth = 1;

    const flow = -time * 0.08;                  // 조금씩 왼쪽으로 흐름
    const mx = (mouse.x - w/2) * 0.01;          // 마우스에 아주 약한 반응
    const my = (mouse.y - h/2) * 0.01;

    for (const points of lines){
      ctx.beginPath();
      for (let idx=0; idx<points.length; idx++){
        const p = points[idx];
        const move = noise.perlin2((p.x+flow)*0.004, (p.y+time*0.002)*0.004) * 10;
        const x = p.x + Math.cos(move)*waveAmpX + mx;
        const y = p.y + Math.sin(move)*waveAmpY + my;
        (idx===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
      }
      ctx.stroke();
    }

    ctx.restore();
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
