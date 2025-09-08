window.addEventListener('load', () => {
  const stage = document.getElementById('puddingStage');
  if (!stage || !window.PIXI) return;

  const app = new PIXI.Application({
    resizeTo: stage,
    backgroundAlpha: 0,
    antialias: true,
  });
  stage.appendChild(app.view);

  // 도트 느낌과 어울리는 심플한 안내 텍스트
  const txt = new PIXI.Text('Left Stage (visual only)', {
    fontFamily: 'system-ui',
    fontSize: 16,
    fill: 0x666666,
  });
  txt.anchor.set(0.5);
  app.stage.addChild(txt);

  function center() {
    txt.position.set(app.renderer.width / 2, app.renderer.height / 2);
  }
  center();
  app.renderer.on('resize', center);
});
