import { doc } from './lib.mjs';
// Unicode and typography: RTL, CJK, emoji, combining marks, entities, MathML, ruby, vertical text, bidi isolates, long words, tables. Hash-routed (#/n) with a `current` class.
const sec = (i, inner) => '<section class="slide' + (i === 0 ? ' current' : '') + '" id="s' + (i + 1) + '" lang="en">' + inner + '</section>';
const slides = [
  sec(0, '<h1>Unicode &amp; Typography</h1><p>Naïve café — “smart quotes”, ‘single’, an em dash — and&nbsp;non‑breaking&nbsp;spaces.&nbsp;© 2026 &lt;Deckhand&gt;</p>'),
  sec(1, '<h2>Right to left</h2><p dir="rtl" lang="he" class="rtl">שלום עולם — זהו מצגת לדוגמה עם טקסט בעברית.</p><p dir="rtl" lang="ar" class="rtl">مرحبا بالعالم — هذا عرض تجريبي باللغة العربية.</p><p>Mixed: <bdi>مرحبا</bdi> and English in one line.</p>'),
  sec(2, '<h2>CJK</h2><p lang="ja">こんにちは世界。これは日本語のプレゼンテーションです。</p><p lang="zh-Hans">你好，世界。这是一个中文演示文稿。</p><p lang="ko">안녕하세요 세계. 이것은 한국어 프레젠테이션입니다.</p><p lang="ja"><ruby>漢字<rt>かんじ</rt></ruby>の<ruby>振<rt>ふ</rt>り<ruby>仮名<rt>がな</rt></ruby></ruby></p>'),
  sec(3, '<h2>Emoji and symbols</h2><p class="big">😀 🚀 🧪 🎉 👨‍👩‍👧‍👦 🇮🇹 ❤️</p><p>Arrows → ← ↑ ↓ ⇒ · Math ∑ ∫ √ ≈ ≠ ≤ · Currency € £ ¥ ₹ ₿</p><p>Combining: e&#x301; (e + ´) · n&#x303; · a&#x308;</p>'),
  sec(4, '<h2>Math</h2><math display="block"><mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow></math><p>H<sub>2</sub>O · E = mc<sup>2</sup> · 10<sup>−3</sup></p>'),
  sec(5, '<h2>Vertical and long words</h2><div class="vert" lang="ja">縦書きのテキスト</div><p class="long">Pneumonoultramicroscopicsilicovolcanoconiosis&shy;is and Donaudampfschifffahrtsgesellschaftskapitän<wbr>switwe</p>'),
  sec(6, '<h2>Table</h2><table><tr><th lang="en">English</th><th lang="fr">Français</th><th lang="de">Deutsch</th><th lang="es">Español</th></tr><tr><td>Hello</td><td>Bonjour</td><td>Hallo</td><td>Hola</td></tr><tr><td>Thank you</td><td>Merci</td><td>Danke</td><td>Gracias</td></tr></table>'),
].join('\n');
const css = `
html,body{margin:0;height:100%;background:#f7f3ea;font-family:"Noto Sans","Segoe UI",Arial,sans-serif;color:#2a2a2a}
.slide{position:absolute;inset:0;padding:6vh 8vw;box-sizing:border-box;display:none}
.slide.current{display:block}
h1{font-size:64px;margin:0 0 20px}h2{font-size:46px;margin:0 0 20px;color:#8a3b12}
p{font-size:30px;line-height:1.6;max-width:1100px}.rtl{text-align:right}.big{font-size:64px}
.vert{writing-mode:vertical-rl;font-size:42px;height:260px;float:right;margin-left:30px}
.long{max-width:420px;border:1px dashed #bbb;padding:10px;hyphens:auto}
table{border-collapse:collapse;font-size:30px}th,td{border:1px solid #c9bfa8;padding:10px 26px}th{background:#efe6d0}
math{font-size:48px}
`;
const js = `
(function () {
  var all = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  function go(i) { i = Math.max(0, Math.min(all.length - 1, i)); all.forEach(function (s, k) { s.classList.toggle('current', k === i); }); location.hash = '#/' + (i + 1); }
  addEventListener('hashchange', function () { var m = /#\\/(\\d+)/.exec(location.hash); if (m) go(+m[1] - 1); });
  document.addEventListener('keydown', function (e) {
    var cur = all.findIndex(function (s) { return s.classList.contains('current'); });
    if (e.key === 'ArrowRight' || e.key === ' ') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1);
  });
})();`;
export default {
  file: 'i18n-typography.html',
  html: doc({ title: 'Unicode & Typography', css, body: slides + '\n', js }),
  meta: { slides: 7, slideSelector: 'section.slide', exclusive: true, navKey: 'ArrowRight', navProbe: 'location.hash', navPresses: 4,
    editText: '#s1 h1', moveSel: '#s4 .big', moveSlide: 3, find: 'Bonjour', tags: ['rtl-bidi', 'cjk', 'ruby', 'emoji-zwj', 'combining-marks', 'mathml', 'vertical-writing', 'entities', 'hash-routing'] },
};
