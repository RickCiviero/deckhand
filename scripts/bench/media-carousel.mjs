import { doc, lorem, art } from './lib.mjs';
// Horizontal carousel (slides side by side in a track moved with translateX) full of embedded content: picture/srcset, figure, video/audio, iframe srcdoc, object, svg image, links, image map.
const imgs = [art(800, 450, '#4568dc', '#b06ab3', 'one'), art(800, 450, '#11998e', '#38ef7d', 'two'), art(800, 450, '#fc4a1a', '#f7b733', 'three')];
const frameDoc = '<!doctype html><body style="margin:0;font-family:Arial;background:#fff8e1"><h3 style="margin:12px">Nested document</h3><p style="margin:12px">' + lorem[2] + '</p></body>';
const css = `
html,body{margin:0;height:100%;overflow:hidden;background:#101010;font-family:Arial,sans-serif;color:#222}
.viewport{position:absolute;inset:0;overflow:hidden}
.track{display:flex;height:100%;width:600vw;transition:transform .5s ease}
.pane{flex:0 0 100vw;height:100%;box-sizing:border-box;padding:6vh 7vw;background:#fafafa}
.pane:nth-child(even){background:#eef3f8}
.pane h2{font-size:44px;margin:0 0 20px}.pane p{font-size:24px;max-width:760px}
.row{display:flex;gap:30px;align-items:flex-start}
figure{margin:0}figure img,picture img{width:420px;border-radius:10px;display:block}figcaption{font-size:18px;color:#555;margin-top:8px}
iframe{width:520px;height:260px;border:2px solid #bbb;border-radius:8px;background:#fff}
.dots{position:fixed;bottom:2vh;left:0;right:0;text-align:center}.dots button{width:14px;height:14px;border-radius:50%;border:0;margin:0 5px;background:#889;cursor:pointer}.dots button.on{background:#fc4a1a}
a.link{color:#0b6bcb;font-size:22px}
`;
const panes = [
  '<h2>Media Carousel</h2><p>' + lorem[0] + '</p><figure><img alt="Hero" src="' + imgs[0] + '"><figcaption>Figure 1 — a data-URI image</figcaption></figure>',
  '<h2>Responsive picture</h2><div class="row"><picture><source media="(min-width: 800px)" srcset="' + imgs[1] + '"><img alt="Responsive" src="' + imgs[2] + '"></picture><p>' + lorem[1] + '</p></div>',
  '<h2>Video and audio</h2><div class="row"><video controls width="420" height="236" poster="' + imgs[2] + '"></video><div><audio controls></audio><p>' + lorem[3] + '</p></div></div>',
  '<h2>Embedded document</h2><div class="row"><iframe title="nested" sandbox srcdoc="' + frameDoc.replace(/"/g, '&quot;') + '"></iframe><p>' + lorem[4] + '</p></div>',
  '<h2>SVG and links</h2><svg width="520" height="260" viewBox="0 0 520 260"><image href="' + imgs[0] + '" x="0" y="0" width="520" height="260"/><text x="20" y="240" fill="#fff" font-size="28">SVG image</text></svg><p><a class="link" href="https://example.com/docs">Read the documentation</a> · <a class="link" href="#p6">Next pane</a></p>',
  '<h2>Image map</h2><img alt="Map" usemap="#m" width="560" src="' + imgs[1] + '"><map name="m"><area shape="rect" coords="0,0,280,150" href="#p1" alt="Top left"><area shape="circle" coords="420,225,80" href="#p2" alt="Circle"></map><p>Thank you.</p>',
].map((p, i) => '<section class="pane" id="p' + (i + 1) + '">' + p + '</section>').join('\n');
const body = '<div class="viewport"><div class="track" id="track">\n' + panes + '\n</div></div>\n<div class="dots" id="dots">' + panes.split('<section').slice(1).map((_, i) => '<button type="button" data-i="' + i + '" aria-label="Pane ' + (i + 1) + '"' + (i === 0 ? ' class="on"' : '') + '></button>').join('') + '</div>\n';
const js = `
(function () {
  var track = document.getElementById('track'), cur = 0, n = ${6};
  var dots = Array.prototype.slice.call(document.querySelectorAll('#dots button'));
  function go(i) { cur = Math.max(0, Math.min(n - 1, i)); track.style.transform = 'translateX(' + (-cur * 100) + 'vw)'; dots.forEach(function (d, k) { d.classList.toggle('on', k === cur); }); }
  dots.forEach(function (d) { d.addEventListener('click', function () { go(+d.dataset.i); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1); });
  var x0 = null;
  document.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; });
  document.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1)); x0 = null; });
})();`;
export default {
  file: 'media-carousel.html',
  html: doc({ title: 'Media Carousel', css, body, js }),
  meta: { slides: 6, slideSelector: '.pane', exclusive: false, navKey: 'ArrowRight', navProbe: "document.getElementById('track').style.transform", navPresses: 4,
    editText: '#p1 h2', moveSel: '#p1 figure', moveSlide: 0, find: 'Embedded document', tags: ['translate-carousel', 'picture-srcset', 'video-audio', 'iframe-srcdoc', 'svg-image', 'image-map', 'touch-swipe', 'figure-figcaption'] },
};
