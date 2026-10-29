// Generates the offline test corpus into test-decks/. Run: npm run gen:decks
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outer = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-decks');
const root = join(outer, 'decks'); // decks live one level down so "../secret.txt" is outside the deck folder
mkdirSync(join(root, 'assets'), { recursive: true });
const w = (name, data) => writeFileSync(join(root, name), data);

// 1. fixed 1920x1080 stage scaled by JS, absolute positioning, active-class navigation
w('ai-fixed-stage.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fixed stage deck</title>
  <style>
    :root { --brand: #C43E1C; --ink: #222; }
    body { margin: 0; background: #111; }
    #stage { width: 1920px; height: 1080px; position: relative; transform-origin: 0 0; }
    .slide { position: absolute; inset: 0; background: #fff; display: none; font-family: Georgia, serif; }
    .slide.active { display: block; }
    .title { position: absolute; left: 160px; top: 120px; font-size: 96px; color: var(--brand); margin: 0; }
    .body { position: absolute; left: 160px; top: 360px; width: 1200px; font-size: 44px; color: var(--ink); }
    .logo { position: absolute; right: 80px; top: 60px; width: 160px; height: 160px; background: var(--brand); border-radius: 50%; }
  </style>
</head>
<body>
  <div id="stage">
    <section class="slide active" data-slide="1">
      <h1 class="title">Quarterly Review</h1>
      <p class="body">Revenue grew <strong>12%</strong> &mdash; best quarter &amp; a record.</p>
      <div class="logo"></div>
    </section>
    <section class="slide" data-slide="2">
      <h1 class="title">Roadmap</h1>
      <p class="body" style="color: #555; opacity: .9">Ship v1, then iterate.</p>
    </section>
    <section class="slide" data-slide="3">
      <h1 class="title">Thank you</h1>
      <p class="body">Questions?</p>
    </section>
  </div>
  <script>
    var i = 0, slides = document.querySelectorAll('.slide');
    function fit() { var s = Math.min(innerWidth / 1920, innerHeight / 1080); document.getElementById('stage').style.transform = 'scale(' + s + ')'; }
    addEventListener('resize', fit); fit();
    addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { slides[i].classList.remove('active'); i = Math.min(i + 1, slides.length - 1); slides[i].classList.add('active'); }
      if (e.key === 'ArrowLeft') { slides[i].classList.remove('active'); i = Math.max(i - 1, 0); slides[i].classList.add('active'); }
    });
  </script>
</body>
</html>
`);

// 2. responsive flex/grid, scroll-snap
w('responsive-scroll-snap.html', `<!doctype html>
<html>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Responsive deck</title>
<style>
  html { scroll-snap-type: y mandatory; }
  body { margin: 0; font-family: system-ui, sans-serif; }
  .page { min-height: 100vh; scroll-snap-align: start; display: flex; flex-direction: column; justify-content: center; padding: 6vw; box-sizing: border-box; }
  .page:nth-child(even) { background: #f3efe9; }
  h2 { font-size: clamp(32px, 5vw, 72px); margin: 0 0 2vw; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2vw; }
  .card { background: #fff; border: 1px solid #ddd; padding: 2vw; border-radius: 12px; font-size: 2vw; }
</style>
</head>
<body>
<main>
  <section class="page"><h2>Product overview</h2><p>Simple, fast, and local.</p></section>
  <section class="page"><h2>Features</h2>
    <div class="cards"><div class="card">Fast</div><div class="card">Safe</div><div class="card">Portable</div></div>
  </section>
  <section class="page"><h2>Pricing</h2><p>Free for everyone.</p></section>
</main>
</body>
</html>
`);

// 3. reveal.js-style structure
w('reveal-style.html', `<!doctype html>
<html><head><meta charset="utf-8"><title>Reveal style</title>
<style>.reveal{position:relative}.slides section{display:block}</style></head>
<body>
<div class="reveal"><div class="slides">
  <section><h1>Hello reveal</h1><aside class="notes">Say hi</aside></section>
  <section>
    <section><h2>Vertical A</h2></section>
    <section><h2>Vertical B</h2></section>
  </section>
  <section data-visibility="hidden"><h2>Hidden</h2></section>
  <section data-background-color="#222"><h2>Dark</h2></section>
</div></div>
</body></html>
`);

// 4. windows-1252 + CRLF
const latin =
  '<!DOCTYPE html>\r\n<html>\r\n<head>\r\n\t<meta charset="windows-1252">\r\n\t<title>Caf\xe9</title>\r\n</head>\r\n<body>\r\n' +
  '\t<div class="slides">\r\n\t\t<section class="slide"><h1>Caf\xe9 cr\xe8me &amp; \x93quotes\x94</h1></section>\r\n' +
  '\t\t<section class="slide"><h1>Fin\xa0&nbsp;done</h1></section>\r\n\t</div>\r\n</body>\r\n</html>\r\n';
w('latin1-crlf.html', Buffer.from(latin, 'latin1'));

// 5. UTF-8 BOM, mixed indentation, comments, odd quoting, entities
w(
  'utf8-bom.html',
  Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      `<!doctype html>
<html>
<head>
\t<meta charset="utf-8">
  <title>BOM ✓</title>
</head>
<body>
\t<!-- a comment that must survive -->
  <div class='slides'>
\t<section class='slide'  data-x = "1" ><h1>Ünïcödé — 日本語 🎉</h1></section>
    <section class='slide'><p>Tom &amp; Jerry&nbsp;&copy;</p></section>
  </div>
</body>
</html>`,
      'utf8',
    ),
  ]),
);

// 6. malformed HTML
w(
  'malformed.html',
  '<html><body><div class="slides"><div class="slide"><h1>Unclosed <b>bold<p>para\n</div></div></div><div class="slide"><h1>Second</h1></div><div class="slide"><h1>Third',
);

// 7. plain page
w('plain-page.html', '<!doctype html><html><head><meta charset="utf-8"><title>Plain</title></head><body><h1>Just a page</h1><p>No slides here.</p></body></html>\n');

// 8. base64 + local image
const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
w(
  'base64-images.html',
  `<!doctype html><html><head><meta charset="utf-8"><title>Images</title><style>.slide{padding:40px}</style></head><body>
<div class="deck"><section class="slide"><h1>Logo</h1><img src="data:image/png;base64,${px}" alt="px" width="120"></section>
<section class="slide"><h1>Local</h1><img src="assets/pic.png" alt="local" width="120"></section></div>
</body></html>
`,
);
w('assets/pic.png', Buffer.from(px, 'base64'));

// 9. multi-file deck with a ../ reference
w(
  'multi-file.html',
  `<!doctype html><html><head><meta charset="utf-8"><title>Multi</title><link rel="stylesheet" href="assets/theme.css"><script src="assets/deck.js" defer></script></head>
<body><div class="deck"><section class="slide"><h1>External CSS</h1><img src="../secret.txt" alt="outside"></section><section class="slide"><h1>Two</h1></section></div></body></html>
`,
);
w('assets/theme.css', '.slide{padding:48px;font-family:sans-serif}h1{color:#06c}\n');
w('assets/deck.js', 'document.documentElement.setAttribute("data-js","1");\n');
writeFileSync(join(outer, 'secret.txt'), 'TOP-SECRET-OUTSIDE-DECK-FOLDER\n');

// 10. large deck
let big = '<!doctype html><html><head><meta charset="utf-8"><title>Large</title><style>.slide{min-height:100vh;padding:5vw}</style></head><body>\n';
for (let i = 1; i <= 100; i++) {
  big += `<section class="slide" id="slide-${i}">\n  <h1>Slide ${i}</h1>\n  <p>${'Lorem ipsum dolor sit amet. '.repeat(20)}</p>\n</section>\n`;
}
w('large-100.html', big + '</body></html>\n');

// 11. hostile deck: every attempt records its outcome in window.__results (read by e2e tests)
w(
  'hostile.html',
  `<!doctype html><html><head><meta charset="utf-8"><title>Hostile</title>
<style>.slide{padding:40px}</style></head><body>
<div class="deck">
<section class="slide" id="s1"><h1>Hostile deck</h1><p id="log">running</p></section>
<section class="slide"><h1>Second</h1></section>
</div>
<script>
  var r = (window.__results = {});
  try { var wo = window.open('https://example.com'); r.open = wo ? 'OPENED' : 'blocked'; } catch (e) { r.open = 'blocked'; }
  try { top.location = 'https://example.com/pwn'; r.top = 'attempted'; } catch (e) { r.top = 'blocked'; }
  try { parent.document.body.innerHTML = 'PWNED'; r.parent = 'WROTE PARENT'; } catch (e) { r.parent = 'blocked'; }
  r.api = [typeof window.deckhand, typeof window.electron, typeof require, typeof process].join(',');
  fetch('file:///C:/Windows/win.ini').then(function (x) { r.fetchFile = 'READ ' + x.status; }).catch(function () { r.fetchFile = 'blocked'; });
  fetch('../secret.txt').then(function (x) { return x.text(); }).then(function (t) { r.fetchDotDot = t.indexOf('TOP-SECRET') >= 0 ? 'LEAKED' : 'no-leak'; }).catch(function () { r.fetchDotDot = 'blocked'; });
  fetch('/%2e%2e/secret.txt').then(function (x) { return x.text(); }).then(function (t) { r.fetchEnc = t.indexOf('TOP-SECRET') >= 0 ? 'LEAKED' : 'no-leak'; }).catch(function () { r.fetchEnc = 'blocked'; });
  try { navigator.clipboard.readText().then(function () { r.clip = 'READ'; }).catch(function () { r.clip = 'blocked'; }); } catch (e) { r.clip = 'blocked'; }
  try { parent.postMessage({ type: 'deckhand:op', op: 'save', path: 'C:/evil' }, '*'); window.postMessage({ type: 'deckhand:hello' }, '*'); } catch (e) {}
  try { var a = []; for (var i = 0; i < 40; i++) a.push(new Array(1e6).fill(i)); r.mem = 'allocated'; } catch (e) { r.mem = 'oom caught'; }
  setTimeout(function () { var t = Date.now(); while (Date.now() - t < 25000) {} }, 6000);
</script>
</body></html>
`,
);

console.log('test decks written to', root);
