import { doc, lorem, art } from './lib.mjs';
// 60 slides with ten rotating layouts (title, bullets with build steps, two columns, picture, quote, code, table, chart, timeline, big number): checks size and thumbnail throughput.
const N = 60;
const L = [
  (i) => '<h1>Section ' + (i + 1) + '</h1><p class="sub">' + lorem[i % 6] + '</p>',
  (i) => '<h2>Bullets ' + (i + 1) + '</h2><ul>' + [0, 1, 2, 3].map((k) => '<li class="build" data-step="' + (k + 1) + '">' + lorem[(i + k) % 6] + '</li>').join('') + '</ul>',
  (i) => '<h2>Two columns ' + (i + 1) + '</h2><div class="cols"><div><p>' + lorem[i % 6] + '</p></div><div><p>' + lorem[(i + 1) % 6] + '</p></div></div>',
  (i) => '<h2>Picture ' + (i + 1) + '</h2><img alt="art ' + i + '" src="' + art(480, 270, '#' + ((i * 37) % 200 + 40).toString(16).padStart(2, '0') + '5a8c', '#c0392b', String(i + 1)) + '">',
  (i) => '<blockquote>' + lorem[i % 6] + '<cite>— Author ' + (i + 1) + '</cite></blockquote>',
  (i) => '<h2>Code ' + (i + 1) + '</h2><pre><code>const total = items.reduce((a, b) =&gt; a + b.price, 0);\nconsole.log("Slide ' + (i + 1) + '", total);</code></pre>',
  (i) => '<h2>Table ' + (i + 1) + '</h2><table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>' + i + '</td><td>' + (i * 2) + '</td><td>' + (i * 3) + '</td></tr></table>',
  (i) => '<h2>Chart ' + (i + 1) + '</h2><svg viewBox="0 0 300 120" width="600" height="240">' + [0, 1, 2, 3, 4].map((k) => '<rect x="' + (20 + k * 54) + '" y="' + (110 - ((i * 7 + k * 13) % 90 + 10)) + '" width="36" height="' + ((i * 7 + k * 13) % 90 + 10) + '" fill="#2d6a9f"/>').join('') + '</svg>',
  (i) => '<h2>Timeline ' + (i + 1) + '</h2><ol class="tl">' + [0, 1, 2].map((k) => '<li><b>' + (2020 + k) + '</b> ' + lorem[(i + k) % 6] + '</li>').join('') + '</ol>',
  (i) => '<div class="big">' + (i * 17 % 100) + '%</div><p class="sub">of the audience on slide ' + (i + 1) + '</p>',
];
const slides = Array.from({ length: N }, (_, i) => '<section class="slide' + (i === 0 ? ' active' : '') + '" data-n="' + (i + 1) + '">' + L[i % L.length](i) + '<div class="foot">' + (i + 1) + '</div></section>').join('\n');
const css = `
html,body{margin:0;height:100%;background:#222;font-family:Arial,sans-serif}
.slide{position:absolute;inset:0;display:none;box-sizing:border-box;padding:64px 90px;background:#fff;color:#222}
.slide.active{display:block}
h1{font-size:72px;margin:120px 0 16px;color:#2d6a9f}h2{font-size:46px;margin:0 0 24px;color:#2d6a9f}.sub{font-size:30px;color:#555;max-width:900px}
ul{font-size:34px;line-height:1.5}.build{opacity:0}.build.on{opacity:1}
.cols{display:flex;gap:50px;font-size:30px}.cols>div{flex:1}
img{max-width:60%;border-radius:10px}
blockquote{font-size:44px;margin:120px 0 0;border-left:8px solid #c0392b;padding-left:30px;font-style:italic}cite{display:block;font-size:24px;margin-top:20px}
pre{background:#f4f4f4;padding:20px;font-size:26px;border-radius:8px}
table{border-collapse:collapse;font-size:32px}th,td{border:1px solid #ccc;padding:10px 30px}
.tl{font-size:28px;line-height:1.6}.big{font-size:200px;font-weight:700;color:#c0392b;margin-top:120px}
.foot{position:absolute;right:30px;bottom:20px;color:#999;font-size:18px}
`;
const js = `
(function () {
  var all = Array.prototype.slice.call(document.querySelectorAll('.slide')), cur = 0, step = 0;
  function steps(s) { return s.querySelectorAll('.build').length; }
  function render() { all.forEach(function (s, k) { s.classList.toggle('active', k === cur); }); Array.prototype.forEach.call(all[cur].querySelectorAll('.build'), function (b) { b.classList.toggle('on', +b.dataset.step <= step); }); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === ' ') { if (step < steps(all[cur])) step++; else if (cur < all.length - 1) { cur++; step = 0; } render(); }
    if (e.key === 'ArrowLeft') { if (step > 0) step--; else if (cur > 0) { cur--; step = steps(all[cur]); } render(); }
  });
  render();
})();`;
export default {
  file: 'long-deck.html',
  html: doc({ title: 'Long Deck', css, body: slides + '\n', js }),
  meta: { slides: N, slideSelector: 'section.slide', exclusive: true, navKey: 'ArrowRight', navProbe: "document.querySelector('.slide.active').dataset.n + '/' + document.querySelectorAll('.build.on').length", navPresses: 8,
    editText: '.slide[data-n="1"] h1', moveSel: '.slide[data-n="4"] img', moveSlide: 3, steps: true, stepsSlide: 1, find: 'Section 31', thumbs: 8, tags: ['60-slides', 'ten-layouts', 'build-steps', 'svg-charts', 'tables', 'code', 'thumbnail-throughput'] },
};
