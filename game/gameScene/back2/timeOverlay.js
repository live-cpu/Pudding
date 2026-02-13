// PixiJS v7 - KST(Asia/Seoul) 시간대 기반 오버레이 + 초경량 파티클 (ES5 호환)

if (!window.PIXI) { throw new Error('[TimeOverlay] PIXI global not found'); }
var BLEND_MODES = PIXI.BLEND_MODES;
var ParticleContainerCompat = PIXI.ParticleContainer ? PIXI.ParticleContainer : PIXI.Container;

// ── 스타일 프리셋 (이미지 참고 팔레트 + 그라데이션 타입) ──
var STYLES = {
  // 00~09: 꿈결 파스텔(고래/별) — 라디얼 그라데이션
  dawn: {
    alpha: 0.58,
    blend: BLEND_MODES.SCREEN,
    gradient: {
      type: 'radial',
      stops: [
        ['#8fd0ff', 0.00],
        ['#7aa7ff', 0.35],
        ['#2b3b8e', 0.75],
        ['#1a275f', 1.00]
      ],
      cx: 0.5, cy: 0.45, r: 0.85
    },
    particles: { type: 'sparkle', count: 26 }
  },

  // 09~17: 없음
  none: { alpha: 0.0, blend: BLEND_MODES.NORMAL, gradient: null, particles: null },

  // 17~20: 사막 노을 — 수직 그라데이션 + Multiply
  dusk: {
    alpha: 0.45,
    blend: BLEND_MODES.MULTIPLY,
    gradient: {
      type: 'vertical',
      stops: [
        ['#ffb347', 0.00],
        ['#ff8a00', 0.35],
        ['#d15700', 0.70],
        ['#7a2d34', 1.00]
      ]
    },
    particles: { type: 'dust', count: 20 }
  },

  // 20~24: 도시 야경 — 수직 그라데이션 + 별 트윙클
  night: {
    alpha: 0.55,
    blend: BLEND_MODES.NORMAL,
    gradient: {
      type: 'vertical',
      stops: [
        ['#0b1030', 0.00],
        ['#141b47', 0.45],
        ['#20286a', 0.75],
        ['#2e2b6f', 1.00]
      ]
    },
    particles: { type: 'stars', count: 24 }
  }
};

export class TimeOverlay {
  /**
   * @param {PIXI.Application} app
   * @param {{parent?:PIXI.Container, zIndex?:number, particleBudget?:number}} opts
   */
  constructor(app, opts) {
    opts = opts || {};
    this.app = app;
    this.parent = (opts.parent != null) ? opts.parent : app.stage;
    this.layer = new PIXI.Container();
    this.layer.label = 'TimeOverlay';
    this.layer.eventMode = 'none';
    this.layer.zIndex = (opts.zIndex != null) ? opts.zIndex : 9999;

    // 오버레이 스프라이트(작은 텍스쳐를 화면 크기로 스케일)
    this.overlay = new PIXI.Sprite(PIXI.Texture.WHITE);
    this.overlay.anchor.set(0, 0);
    this.overlay.alpha = 0;
    this.overlay.eventMode = 'none';
    this.overlay.blendMode = BLEND_MODES.NORMAL;

    // 초저가 파티클
    this.particles = new ParticleContainerCompat(
      (opts.particleBudget != null) ? opts.particleBudget : 14,
      { position: true, rotation: true, scale: true, alpha: true }
    );
    this.particles.eventMode = 'none';

    this.layer.addChild(this.overlay, this.particles);
    this.parent.addChild(this.layer);
    this.parent.sortableChildren = true;

    // 상태
    this._styleKey = 'none';
    this._tick = this._onTick.bind(this);
    this._ps = [];
    this._timer = null;
    this._texCache = new Map();

    // ★ 미러 오버레이(다른 컨테이너에 얇은 복제 스프라이트)
    this._mirrors = [];

    // 기본 텍스처(원/플러스)
    this._buildBasicTextures();

    // 리사이즈 대응
    this.resize();
    window.addEventListener('resize', this.resize.bind(this), { passive: true });

    // 탭 비가시화 시 파티클 틱 정지
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._ensureTicker(true);
      else this._ensureTicker(false);
    });
  }

  // 시작(현재 시간 스타일 적용 + 경계 예약)
  start() {
    this.updateByTime();
    this._scheduleNextBoundary();
  }

  // 특정 스타일 적용
  setStyle(key) {
    var style = STYLES[key] || STYLES.none;
    this._styleKey = key;

    // 오버레이 질감(텍스쳐 캐시)
    if (style.gradient) {
      var texKey = JSON.stringify(style.gradient);
      var tex = this._texCache.get(texKey);
      if (!tex) {
        tex = this._makeGradientTexture(style.gradient);
        this._texCache.set(texKey, tex);
      }
      this.overlay.texture = tex;
    } else {
      this.overlay.texture = PIXI.Texture.WHITE;
    }
    this.overlay.blendMode = style.blend;
    this.overlay.alpha = style.alpha;
    this.resize();

    // 파티클
    this._applyParticles(style.particles);

    // 틱 on/off
    this._ensureTicker(!!style.particles);

    // ★ 미러 동기화
    for (var i=0;i<this._mirrors.length;i++){
      var m = this._mirrors[i];
      m.texture   = this.overlay.texture;
      m.blendMode = this.overlay.blendMode;
      m.alpha     = this.overlay.alpha;
    }
    // 외부 훅(선택): 시간대 바뀔 때 방에서 재색칠 등
    if (window.__overlayOnStyleChange) try{ window.__overlayOnStyleChange(); }catch(_){}
  }

  // KST 기준으로 현재 스타일 갱신
  updateByTime(nowUTCms) {
    if (nowUTCms == null) nowUTCms = Date.now();
    var kst = new Date(nowUTCms + 9 * 60 * 60 * 1000);
    var h = kst.getUTCHours();
    var key = 'none';
    if (h >= 0 && h < 9) key = 'dawn';
    else if (h >= 9 && h < 17) key = 'none';
    else if (h >= 17 && h < 20) key = 'dusk';
    else key = 'night';
    this.setStyle(key);
  }

  // 크기 갱신
  resize() {
    var scr = this.app.screen;
    this.overlay.position.set(0, 0);
    this.overlay.width = scr.width;
    this.overlay.height = scr.height;
    // ★ 미러도 리사이즈
    for (var i=0;i<this._mirrors.length;i++) this._sizeMirror(this._mirrors[i]);
  }

  // 정리
  destroy() {
    if (this._timer) clearTimeout(this._timer);
    this._ensureTicker(false);
    this.clearMirrors();
    this.layer.destroy({ children: true });
    this._texCache.forEach(function(t){ t.destroy(true); });
    this._texCache.clear();
  }

  // -------- 내부 구현 --------
  _buildBasicTextures() {
    // 작은 원(별/먼지) — 레거시 방식
    var g1 = new PIXI.Graphics();
    g1.beginFill(0xffffff, 1);
    g1.drawCircle(0, 0, 2);
    g1.endFill();
    this.texCircle = this.app.renderer.generateTexture(g1);

    // 플러스(스파클) — 레거시 방식
    var g2 = new PIXI.Graphics();
    g2.lineStyle(1.5, 0xffffff, 1);
    g2.moveTo(-3, 0).lineTo(3, 0);
    g2.moveTo(0, -3).lineTo(0, 3);
    this.texPlus = this.app.renderer.generateTexture(g2);
  }

  // 범용(수직/라디얼) 그라데이션 텍스처 생성
  _makeGradientTexture(desc) {
    var W = 256, H = 256; // 소형 텍스쳐 → 화면에 스케일 (저메모리)
    var cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    var ctx = cvs.getContext('2d');

    if (desc.type === 'radial') {
      var cx = (desc.cx != null ? desc.cx : 0.5) * W;
      var cy = (desc.cy != null ? desc.cy : 0.5) * H;
      var r  = (desc.r  != null ? desc.r  : 0.8) * Math.max(W, H);
      var grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (var i = 0; i < desc.stops.length; i++) {
        grd.addColorStop(desc.stops[i][1], desc.stops[i][0]);
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    } else {
      var vg = ctx.createLinearGradient(0, 0, 0, H);
      for (var j = 0; j < desc.stops.length; j++) {
        vg.addColorStop(desc.stops[j][1], desc.stops[j][0]);
      }
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    var tex = PIXI.Texture.from(cvs);
    tex.baseTexture.label = 'TimeOverlayGradientX';
    return tex;
  }

  _clearParticles() {
    this._ps.length = 0;
    if (this.particles.removeChildren) this.particles.removeChildren();
  }

  _applyParticles(spec) {
    this._clearParticles();
    if (!spec) return;

    var W = this.app.screen.width, H = this.app.screen.height;
    var N = spec.count | 0;

    for (var i = 0; i < N; i++) {
      var s;
      if (spec.type === 'sparkle') {
        s = new PIXI.Sprite(this.texPlus);
        s.rotation = Math.random() * Math.PI;
        s.scale.set(0.6 + Math.random() * 0.8);
      } else {
        s = new PIXI.Sprite(this.texCircle);
        s.scale.set(spec.type === 'stars' ? (0.6 + Math.random() * 0.8)
                                          : (0.9 + Math.random() * 0.6));
      }
      s.alpha = 0.6 + Math.random() * 0.4;
      s.tint = 0xffffff;
      s.position.set(Math.random() * W, Math.random() * H);

      // 개별 파라미터
      var dir = Math.random() < 0.5 ? -1 : 1;
      var speed = (spec.type === 'dust') ? (0.12 + Math.random() * 0.25)
                : (spec.type === 'sparkle') ? (0.05 + Math.random() * 0.12)
                : (0.04 + Math.random() * 0.10);
      s._vx = dir * speed * (0.5 + Math.random());
      s._vy = (spec.type === 'sparkle') ? (-0.05 + Math.random() * 0.1)
            : (spec.type === 'dust')    ? (-0.02 + Math.random() * 0.04)
            : 0;
      s._twinkle = (spec.type === 'stars');
      s._t = Math.random() * Math.PI * 2;

      this._ps.push(s);
      this.particles.addChild(s);
    }
  }

  _ensureTicker(on) {
    var has = false;
    if (this.app && this.app.ticker && this.app.ticker.listeners) {
      var arr = this.app.ticker.listeners('tick');
      if (arr && arr.indexOf(this._tick) !== -1) has = true;
    }
    if (on && !has) this.app.ticker.add(this._tick);
    if (!on && has) this.app.ticker.remove(this._tick);
  }

  _onTick(delta) {
    var dt = delta / 60;
    var W = this.app.screen.width, H = this.app.screen.height;

    for (var i = 0; i < this._ps.length; i++) {
      var s = this._ps[i];
      s.x += s._vx * 60 * dt;
      s.y += s._vy * 60 * dt;

      if (s.x < -8) s.x = W + 8;
      if (s.x > W + 8) s.x = -8;
      if (s.y < -8) s.y = H + 8;
      if (s.y > H + 8) s.y = -8;

      if (s._twinkle) {
        s._t += 0.03 * 60 * dt;
        s.alpha = 0.35 + 0.35 * (Math.sin(s._t) * 0.5 + 0.5);
      }
    }
  }

  _scheduleNextBoundary() {
    if (this._timer) clearTimeout(this._timer);

    var now = Date.now();
    var kst = new Date(now + 9 * 3600 * 1000);
    var h = kst.getUTCHours();

    var nextH;
    if (h < 9) nextH = 9;
    else if (h < 17) nextH = 17;
    else if (h < 20) nextH = 20;
    else nextH = 24;

    var next = new Date(kst);
    next.setUTCHours(nextH % 24, 0, 0, 0);
    if (nextH === 24) next.setUTCDate(next.getUTCDate() + 1);

    var ms = (next - kst);
    var self = this;
    this._timer = setTimeout(function(){
      self.updateByTime();
      self._scheduleNextBoundary();
    }, Math.max(1000, ms));
  }

  // ── 미러 오버레이 API ──
  _sizeMirror(sp){
    var scr = this.app.screen;
    sp.position.set(0,0);
    sp.width  = scr.width;
    sp.height = scr.height;
  }
  _addMirrorTo(parent, zIndex){
    if (!parent) return null;
    var sp = new PIXI.Sprite(this.overlay.texture);
    sp.anchor.set(0,0);
    sp.alpha = this.overlay.alpha;
    sp.blendMode = this.overlay.blendMode;
    sp.zIndex = (zIndex != null) ? zIndex : 9999;
    parent.addChild(sp);
    parent.sortableChildren = true;
    this._mirrors.push(sp);
    this._sizeMirror(sp);
    return sp;
  }
  addMirror(parent, zIndex){ return this._addMirrorTo(parent, zIndex); }
  clearMirrors(){
    for (var i=0;i<this._mirrors.length;i++){ try{ this._mirrors[i].destroy(); }catch(_){} }
    this._mirrors.length = 0;
  }
}
