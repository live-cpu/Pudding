// /game/gameScene/back2/weather.js

export const WeatherTypes = {
  CLEAR: "clear",
  RAIN: "rain",
  SNOW: "snow",
};

export function randomWeather() {
  const types = Object.values(WeatherTypes);
  return types[Math.floor(Math.random() * types.length)];
}

// 메인 스폰 함수 (마스크 포함)
export function spawnWeatherEffect(app, parentContainer, area, weatherType) {
  if (weatherType === WeatherTypes.CLEAR) return;

  // 날씨 전용 컨테이너
  const weatherContainer = new PIXI.Container();
  parentContainer.addChild(weatherContainer);

  // 🔹 마스크 추가
  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff);
  mask.drawRect(area.x, area.y, area.width, area.height);
  mask.endFill();

  weatherContainer.mask = mask;
  parentContainer.addChild(mask); // 마스크도 parent에 넣어야 적용됨

  if (weatherType === WeatherTypes.RAIN) {
    spawnRain(app, weatherContainer, area);
  } else if (weatherType === WeatherTypes.SNOW) {
    spawnSnow(app, weatherContainer, area);
  }
}

// ---- Rain ----
function spawnRain(app, container, area) {
  const particleCount = 15;
  const texture = PIXI.Texture.WHITE;

  const drops = []; // ✅ 파티클 배열

  for (let i = 0; i < particleCount; i++) {
    const drop = new PIXI.Sprite(texture);
    drop.tint = 0x64A5B3;
    drop.width = 0.8;
    drop.height = 12;
    drop.alpha = 0.6;
    drop.x = area.x + Math.random() * area.width;
    drop.y = area.y + Math.random() * area.height;

    // 개별 속도 저장
    drop.vy = 4 + Math.random() * 2;

    container.addChild(drop);
    drops.push(drop); // 배열에 보관
  }

  // ✅ ticker는 배열 순회
 const tick = () => {
   if (!container || container.destroyed) {
      app.ticker.remove(tick);
      return;
    }
    for (let drop of drops) {
      if (!drop.parent) continue; // 이미 제거된 경우 skip

      drop.y += drop.vy;
      if (drop.y > area.y + area.height) {
        drop.y = area.y - drop.height;
        drop.x = area.x + Math.random() * area.width;
      }
    }
 };
  app.ticker.add(tick);
}

// ---- Snow ----
function spawnSnow(app, container, area) {
  const particleCount = 10;
  const texture = PIXI.Texture.WHITE;

  const snows = []; // ✅ 배열 보관

  for (let i = 0; i < particleCount; i++) {
    const snow = new PIXI.Sprite(texture);
    snow.tint = 0xffffff;
    snow.width = snow.height = 1 + Math.random() * 2;
    snow.alpha = 0.8;
    snow.x = area.x + Math.random() * area.width;
    snow.y = area.y + Math.random() * area.height;

    snow.vy = 0.5 + Math.random() * 1.0;   // 속도
    snow.drift = Math.random() * 0.2;      // 좌우 흔들림

    container.addChild(snow);
    snows.push(snow); // ✅ 배열에 추가
  }

  // ✅ ticker는 배열 순회
  const tick = () => {
    if (!container || container.destroyed) {
      app.ticker.remove(tick);
      return;
    }
    for (let snow of snows) {
      if (!snow.parent) continue; // 제거된 경우 skip

      snow.y += snow.vy;
      snow.x += Math.sin(app.ticker.lastTime / 500) * snow.drift;

      if (snow.y > area.y + area.height) {
        snow.y = area.y - snow.height;
        snow.x = area.x + Math.random() * area.width;
      }
    }
  };
  app.ticker.add(tick);
}
