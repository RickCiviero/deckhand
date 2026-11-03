import { doc, lorem, art } from './lib.mjs';
// Scrollytelling: full-height scroll-snap sections, IntersectionObserver-triggered animations, sticky header, progress bar, parallax.
const N = 9;
const heads = ['The Story', 'The Problem', 'The Idea', 'The Numbers', 'The Product', 'The Team', 'The Plan', 'The Ask', 'Thank You'];
const sections = heads.map((h, i) => {
  const extra = i === 3
    ? '<div class="stats"><div class="stat rv"><b data-count="1200">0</b><span>customers</span></div><div class="stat rv"><b data-count="87">0</b><span>% retention</span></div><div class="stat rv"><b data-count="14">0</b><span>countries</span></div></div>'
    : i === 4
      ? '<img class="shot rv" alt="screenshot" src="' + art(720, 400, '#134e5e', '#71b280', 'product') + '">'
      : '<p class="rv">' + lorem[i % lorem.length] + '</p>';
  return '<section class="chap" id="c' + (i + 1) + '"><div class="inner"><h2 class="rv">' + h + '</h2>' + extra + '</div></section>';
}).join('\n');
const css = `
html{scroll-snap-type:y mandatory;scroll-behavior:smooth}
body{margin:0;font-family:Georgia,serif;background:#0f1b24;color:#eef}
header.bar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(10,20,28,.85);z-index:5;font:600 16px/1 system-ui}
header.bar nav a{color:#9cd;margin-left:18px;text-decoration:none;font-weight:400}
#prog{position:fixed;top:52px;left:0;height:3px;width:0;background:#f7b32b;z-index:5}
.chap{height:100vh;scroll-snap-align:start;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.chap:nth-of-type(even){background:#16293a}.chap:nth-of-type(3n){background:#21304a}
.inner{width:min(900px,80vw)}
.chap h2{font-size:64px;margin:0 0 24px;color:#f7b32b}
.chap p{font-size:30px;line-height:1.5}
.rv{opacity:0;transform:translateY(40px);transition:opacity .7s,transform .7s}
.rv.in{opacity:1;transform:none}
.stats{display:flex;gap:32px}.stat{flex:1;background:#102030;border-radius:12px;padding:24px;text-align:center}
.stat b{display:block;font-size:64px;color:#7fdbca}.stat span{font-size:20px;color:#9ab}
.shot{width:100%;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.chap::before{content:"";position:absolute;inset:-20%;background:radial-gradient(circle at 20% 30%,rgba(247,179,43,.12),transparent 40%);transform:translateY(var(--py,0px))}
`;
const body = '<header class="bar"><span>Scroll Story</span><nav>' + heads.slice(0, 5).map((h, i) => '<a href="#c' + (i + 1) + '">' + h + '</a>').join('') + '</nav></header>\n<div id="prog"></div>\n' + sections + '\n';
const js = `
(function () {
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.querySelector && e.target.querySelector('[data-count]')) count(e.target.parentNode);
    });
  }, { threshold: 0.3 });
  Array.prototype.forEach.call(document.querySelectorAll('.rv'), function (el) { io.observe(el); });
  var counted = false;
  function count(scope) {
    if (counted) return; counted = true;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-count]'), function (b) {
      var to = +b.dataset.count, t0 = null;
      function tick(t) { if (t0 === null) t0 = t; var k = Math.min(1, (t - t0) / 900); b.textContent = Math.round(to * k); if (k < 1) requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
    });
  }
  addEventListener('scroll', function () {
    var max = document.documentElement.scrollHeight - innerHeight;
    document.getElementById('prog').style.width = (max > 0 ? scrollY / max * 100 : 0) + '%';
    document.documentElement.style.setProperty('--py', (scrollY * -0.08) + 'px');
  }, { passive: true });
  document.addEventListener('keydown', function (e) {
    var i = Math.round(scrollY / innerHeight);
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); scrollTo({ top: Math.min(${N - 1}, i + 1) * innerHeight }); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); scrollTo({ top: Math.max(0, i - 1) * innerHeight }); }
  });
})();`;
export default {
  file: 'scroll-story.html',
  html: doc({ title: 'Scroll Story', css, body, js }),
  meta: { slides: N, slideSelector: 'section.chap', exclusive: false, navKey: 'ArrowDown', navProbe: 'Math.round(scrollY)', navPresses: 3, navWait: 1200,
    editText: '#c1 h2', moveSel: '#c5 img.shot', moveSlide: 4, find: 'The Numbers', tags: ['scroll-snap', 'intersection-observer', 'reveal-on-scroll', 'sticky-header', 'counters-raf', 'parallax', 'hidden-until-visible'] },
};
