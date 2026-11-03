import { doc, lorem, art } from './lib.mjs';
// impress.js-style: free-form steps placed in 3D space (data-x/y/z/rotate/scale), the camera moves between them.
const steps = [
  { x: 0, y: 0, s: 1, r: 0, cls: 'title', html: '<h1>Impress 3D</h1><p>Steps placed in space</p>' },
  { x: 1400, y: 0, s: 1, r: 0, html: '<h2>Overview</h2><ul><li>' + lorem[0] + '</li><li>' + lorem[1] + '</li></ul>' },
  { x: 2800, y: 300, s: 1, r: 25, html: '<h2>Rotated</h2><p>' + lorem[2] + '</p><img alt="rot" src="' + art(420, 240, '#ff7e5f', '#feb47b', 'rot') + '">' },
  { x: 2800, y: 1500, s: 2, r: 0, html: '<h2>Zoomed in</h2><p>' + lorem[3] + '</p>' },
  { x: 700, y: 1500, z: -600, s: 1, r: -15, html: '<h2>Deep</h2><p>' + lorem[4] + '</p>' },
  { x: -1200, y: 1500, s: 1, r: 0, html: '<h2>Chart</h2><svg viewBox="0 0 300 160" width="480" height="256"><rect x="20" y="80" width="40" height="70" fill="#4e79a7"/><rect x="90" y="40" width="40" height="110" fill="#f28e2b"/><rect x="160" y="20" width="40" height="130" fill="#e15759"/><rect x="230" y="60" width="40" height="90" fill="#76b7b2"/></svg>' },
  { x: -1200, y: 100, s: 0.5, r: 90, html: '<h2>Rotated 90</h2><p>' + lorem[5] + '</p>' },
  { x: 0, y: -1300, s: 3, r: 0, cls: 'end', html: '<h1>The End</h1><p>Back to the <a href="#/step-1">first step</a></p>' },
];
const css = `
html,body{margin:0;height:100%;overflow:hidden;background:#d9d9d9;font-family:"Open Sans",Arial,sans-serif;color:#333}
#impress{position:absolute;left:50%;top:50%;width:0;height:0;transform-origin:0 0;transition:transform .8s ease;transform-style:preserve-3d}
.step{position:absolute;width:900px;height:560px;margin-left:-450px;margin-top:-280px;padding:40px 60px;box-sizing:border-box;background:#fff;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.2);opacity:.35;transition:opacity .6s;transform-style:preserve-3d;font-size:30px}
.step.active{opacity:1}
.step h1{font-size:76px;margin:30px 0 10px;color:#c43e1c}.step h2{font-size:52px;margin:0 0 16px;color:#1f5f8b}
.step.title{background:#1f5f8b;color:#fff}.step.title h1{color:#fff}.step.end{background:#c43e1c;color:#fff}.step.end h1,.step.end a{color:#fff}
.step img{max-width:100%;border-radius:8px}
.hint{position:fixed;bottom:10px;left:0;right:0;text-align:center;font-size:16px;color:#777}
`;
const body = '<div id="impress">\n' + steps.map((s, i) =>
  '<div id="step-' + (i + 1) + '" class="step ' + (s.cls ?? '') + '" data-x="' + s.x + '" data-y="' + s.y + '"' + (s.z ? ' data-z="' + s.z + '"' : '') + (s.r ? ' data-rotate="' + s.r + '"' : '') + ' data-scale="' + s.s + '">' + s.html + '</div>').join('\n') +
  '\n</div>\n<div class="hint">Use arrow keys or space to navigate</div>\n';
const js = `
(function () {
  var root = document.getElementById('impress');
  var els = Array.prototype.slice.call(root.querySelectorAll('.step'));
  var cur = -1;
  els.forEach(function (el) {
    var d = el.dataset;
    el.style.transform = 'translate3d(' + (+d.x || 0) + 'px,' + (+d.y || 0) + 'px,' + (+d.z || 0) + 'px) rotate(' + (+d.rotate || 0) + 'deg) scale(' + (+d.scale || 1) + ')';
  });
  function go(i) {
    i = Math.max(0, Math.min(els.length - 1, i));
    if (cur >= 0) els[cur].classList.remove('active');
    cur = i; var d = els[i].dataset, s = +d.scale || 1;
    els[i].classList.add('active');
    var k = Math.min(innerWidth / 1000, innerHeight / 640);
    root.style.transform = 'scale(' + (k / s) + ') rotate(' + (-(+d.rotate || 0)) + 'deg) translate3d(' + (-(+d.x || 0)) + 'px,' + (-(+d.y || 0)) + 'px,' + (-(+d.z || 0)) + 'px)';
    history.replaceState(null, '', '#/' + els[i].id);
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1); }
  });
  go(0);
})();`;
export default {
  file: 'impress-3d.html',
  html: doc({ title: 'Impress 3D', css, body, js }),
  meta: { slides: 8, slideSelector: '#impress > .step', exclusive: false, navKey: 'ArrowRight', navProbe: 'location.hash', navPresses: 5,
    editText: '#step-1 h1', moveSel: '#step-3 img', moveSlide: 2, find: 'Overview', tags: ['3d-transforms', 'free-form-steps', 'camera-transform', 'rotation', 'scale', 'svg'] },
};
