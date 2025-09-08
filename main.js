// 타이틀 문자를 <span>으로 쪼개고, 각 글자 지연시간을 랜덤으로 줘서 “물결” 느낌
const title = document.getElementById('title');
const text = title.getAttribute('aria-label') || title.textContent;
title.textContent = '';

const spans = [...text].map((ch, i) => {
  const s = document.createElement('span');
  s.className = 'ch';
  s.textContent = ch;
  // 0~120ms 사이 랜덤 지연 → ripple
  s.style.setProperty('--delay', `${(i * 10 + Math.random()*120)/1000}s`);
  title.appendChild(s);
  return s;
});

// 마우스 근처 글자만 살짝 더 말캉하게
let hover = false;
title.addEventListener('mousemove', (e) => {
  hover = true;
  title.dataset.hover = '1';
  const rect = title.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  spans.forEach(s => {
    const r = s.getBoundingClientRect();
    const cx = (r.left + r.right) / 2 - rect.left;
    const dist = Math.abs(mx - cx);
    // 0~1 가중치
    const w = Math.max(0, 1 - dist / 160);
    if (w > 0.45) s.classList.add('is-near'); else s.classList.remove('is-near');
  });
});
title.addEventListener('mouseleave', () => {
  hover = false;
  title.dataset.hover = '0';
  spans.forEach(s => s.classList.remove('is-near'));
});
