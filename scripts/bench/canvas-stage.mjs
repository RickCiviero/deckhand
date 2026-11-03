import { doc, lorem, art } from './lib.mjs';
// Fixed 1280x720 stage scaled to the window: canvas animation, animated SVG (SMIL + CSS keyframes), media elements, absolute layout.
const css = `
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif}
#stage{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0}
.slide{position:absolute;inset:0;display:none;background:#fff;overflow:hidden}
.slide.is-active{display:block}
.t{position:absolute;margin:0;color:#14213d}
.h{left:80px;top:60px;font-size:60px;font-weight:700}
.p{left:80px;top:170px;width:600px;font-size:28px;line-height:1.4}
.card{position:absolute;border-radius:18px;background:#fca311;color:#14213d;padding:24px;box-sizing:border-box;font-size:26px}
.spin{position:absolute;left:900px;top:300px;width:90px;height:90px;border:10px solid #e5e5e5;border-top-color:#fca311;border-radius:50%;animation:spin 1.2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.marquee{position:absolute;left:0;right:0;bottom:30px;height:50px;overflow:hidden;background:#14213d;color:#fff;font-size:26px;line-height:50px}
.marquee span{display:inline-block;white-space:nowrap;padding-left:100%;animation:mq 14s linear infinite}
@keyframes mq{to{transform:translateX(-100%)}}
.pulse{position:absolute;left:760px;top:120px;width:240px;height:240px;border-radius:50%;background:#fca311;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{transform:scale(1.25);opacity:.6}}
.counter{position:absolute;left:80px;top:300px;font-size:120px;font-weight:700;color:#14213d}
#cv{position:absolute;left:640px;top:120px;border-radius:12px;background:#0b132b}
.dark{background:#0b132b}.dark .t{color:#fff}
.nav{position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#999;font-size:14px;z-index:3}
`;
const slide = (i, inner, cls = '') => '<section class="slide' + (i === 0 ? ' is-active' : '') + (cls ? ' ' + cls : '') + '" data-n="' + (i + 1) + '">' + inner + '</section>';
const slides = [
  slide(0, '<h1 class="t h">Canvas Stage</h1><p class="t p">' + lorem[0] + '</p><div class="pulse"></div><div class="spin"></div><div class="marquee"><span>Breaking: animated slides are still slides — ' + lorem[1] + '</span></div>'),
  slide(1, '<h2 class="t h">Particles (canvas)</h2><canvas id="cv" width="560" height="360"></canvas><p class="t p">' + lorem[2] + '</p>', 'dark'),
  slide(2, '<h2 class="t h">SVG animation</h2><svg class="t" style="left:80px;top:200px" width="520" height="320" viewBox="0 0 520 320"><circle cx="80" cy="160" r="30" fill="#fca311"><animate attributeName="cx" values="80;440;80" dur="4s" repeatCount="indefinite"/></circle><rect x="40" y="260" width="440" height="8" rx="4" fill="#ccc"/><path d="M40 60 Q 260 0 480 60" stroke="#14213d" stroke-width="6" fill="none" stroke-dasharray="500" stroke-dashoffset="500"><animate attributeName="stroke-dashoffset" from="500" to="0" dur="3s" repeatCount="indefinite"/></path></svg><p class="t p" style="left:700px;top:240px;width:480px">' + lorem[3] + '</p>'),
  slide(3, '<h2 class="t h">Counter</h2><div class="counter" id="ctr">0</div><p class="t p" style="top:480px">Updated by requestAnimationFrame</p>'),
  slide(4, '<h2 class="t h">Cards</h2>' + [0, 1, 2].map((k) => '<div class="card" style="left:' + (80 + k * 380) + 'px;top:220px;width:340px;height:300px"><b>Card ' + (k + 1) + '</b><br>' + lorem[k] + '</div>').join('')),
  slide(5, '<h2 class="t h">Media</h2><video controls width="480" height="270" poster="' + art(480, 270, '#355c7d', '#c06c84', 'video poster') + '" style="position:absolute;left:80px;top:180px"></video><audio controls style="position:absolute;left:640px;top:200px"></audio><img alt="pic" style="position:absolute;left:640px;top:300px;width:480px;border-radius:12px" src="' + art(480, 270, '#f8b195', '#6c5b7b', 'pic') + '">'),
  slide(6, '<h2 class="t h">Layered shapes</h2><div class="card" style="left:200px;top:200px;width:400px;height:300px;transform:rotate(-6deg);background:#14213d;color:#fff">Back</div><div class="card" style="left:360px;top:260px;width:400px;height:300px;transform:rotate(4deg);opacity:.92">Front</div><div class="card" style="left:760px;top:180px;width:320px;height:200px;border-radius:50%;background:#e5e5e5;text-align:center;padding-top:70px">Oval</div>'),
  slide(7, '<h1 class="t h" style="top:260px;left:0;right:0;text-align:center">Thank you</h1>', 'dark'),
].join('\n');
const body = '<div id="stage">\n' + slides + '\n</div>\n<div class="nav">Arrow keys</div>\n';
const js = `
(function () {
  var stage = document.getElementById('stage');
  var all = Array.prototype.slice.call(stage.querySelectorAll('.slide'));
  var cur = 0;
  function fit() { var k = Math.min(innerWidth / 1280, innerHeight / 720); stage.style.transform = 'scale(' + k + ')'; stage.style.left = ((innerWidth - 1280 * k) / 2) + 'px'; stage.style.top = ((innerHeight - 720 * k) / 2) + 'px'; }
  addEventListener('resize', fit); fit();
  function go(i) { cur = Math.max(0, Math.min(all.length - 1, i)); all.forEach(function (s, k) { s.classList.toggle('is-active', k === cur); }); }
  document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === ' ') go(cur + 1); else if (e.key === 'ArrowLeft') go(cur - 1); });
  var cv = document.getElementById('cv'), cx = cv.getContext('2d'), ps = [];
  for (var i = 0; i < 40; i++) ps.push({ x: Math.random() * 560, y: Math.random() * 360, vx: Math.random() * 2 - 1, vy: Math.random() * 2 - 1 });
  var ctr = document.getElementById('ctr'), n = 0;
  (function loop() {
    cx.fillStyle = '#0b132b'; cx.fillRect(0, 0, 560, 360); cx.fillStyle = '#fca311';
    ps.forEach(function (p) { p.x = (p.x + p.vx + 560) % 560; p.y = (p.y + p.vy + 360) % 360; cx.beginPath(); cx.arc(p.x, p.y, 4, 0, 6.3); cx.fill(); });
    n++; if (n % 6 === 0) ctr.textContent = String(n / 6);
    requestAnimationFrame(loop);
  })();
})();`;
export default {
  file: 'canvas-stage.html',
  html: doc({ title: 'Canvas Stage', css, body, js }),
  meta: { slides: 8, slideSelector: '#stage > .slide', exclusive: true, navKey: 'ArrowRight', navProbe: "document.querySelector('.slide.is-active').dataset.n", navPresses: 4,
    editText: '.slide[data-n="1"] h1', moveSel: '.slide[data-n="5"] .card', moveSlide: 4, find: 'Particles', tags: ['fixed-stage-scale', 'canvas-raf', 'svg-smil', 'css-keyframes', 'video-audio-elements', 'absolute-layout', 'rotation', 'infinite-animations'] },
};
