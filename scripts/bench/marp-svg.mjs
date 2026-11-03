import { doc, lorem, art } from './lib.mjs';
// Marp-style export: each slide is a <section> inside <svg><foreignObject>; markdown-ish content (lists, code, tables, quotes), header/footer/pagination; no script needed to read it.
const slide = (i, cls, inner) => '<svg data-marpit-svg viewBox="0 0 1280 720" class="s"><foreignObject width="1280" height="720"><section id="' + (i + 1) + '" class="' + cls + '" data-marpit-pagination="' + (i + 1) + '" data-marpit-pagination-total="8"><header>Marp Export</header>' + inner + '<footer>© Acme 2026</footer></section></foreignObject></svg>';
const slides = [
  slide(0, 'lead', '<h1>Marp Export</h1><p>Markdown slides rendered to HTML</p>'),
  slide(1, '', '<h2>Bullets</h2><ul><li>' + lorem[0] + '</li><li>' + lorem[1] + '<ul><li>Nested one</li><li>Nested two</li></ul></li><li>' + lorem[2] + '</li></ul>'),
  slide(2, '', '<h2>Code</h2><pre><code class="language-ts">export function sum(xs: number[]): number {\n  return xs.reduce((a, b) =&gt; a + b, 0);\n}</code></pre>'),
  slide(3, '', '<h2>Table</h2><table><thead><tr><th>Tool</th><th>Format</th><th>Stars</th></tr></thead><tbody><tr><td>Marp</td><td>Markdown</td><td>7k</td></tr><tr><td>Slidev</td><td>Vue</td><td>31k</td></tr><tr><td>reveal.js</td><td>HTML</td><td>67k</td></tr></tbody></table>'),
  slide(4, 'invert', '<h2>Quote</h2><blockquote><p>' + lorem[3] + '</p></blockquote>'),
  slide(5, '', '<h2>Image</h2><p><img alt="bg" src="' + art(560, 315, '#614385', '#516395', 'image') + '"></p><p>' + lorem[4] + '</p>'),
  slide(6, '', '<h2>Two columns</h2><div class="cols"><div><p>' + lorem[5] + '</p></div><div><p>' + lorem[0] + '</p></div></div>'),
  slide(7, 'lead', '<h1>Thanks</h1><p>Questions?</p>'),
].join('\n');
const css = `
html,body{margin:0;background:#333}
.s{display:block;width:100%;max-width:1280px;margin:0 auto 12px;aspect-ratio:16/9}
section{width:1280px;height:720px;box-sizing:border-box;padding:70px 90px;background:#fff;color:#24292f;font:30px/1.5 "Helvetica Neue",Arial,sans-serif;position:relative;overflow:hidden}
section h1{font-size:84px;margin:0 0 20px;color:#0969da}section h2{font-size:52px;margin:0 0 24px;color:#0969da}
section.lead{display:flex;flex-direction:column;justify-content:center;text-align:center}
section.invert{background:#0d1117;color:#e6edf3}section.invert h2{color:#58a6ff}
section header,section footer{position:absolute;left:90px;right:90px;font-size:18px;color:#6e7781}
section header{top:30px}section footer{bottom:28px}
section::after{content:attr(data-marpit-pagination) "/" attr(data-marpit-pagination-total);position:absolute;right:90px;bottom:28px;font-size:18px;color:#6e7781}
section pre{background:#f6f8fa;border-radius:8px;padding:18px;font:24px/1.5 Consolas,monospace}
section table{border-collapse:collapse;font-size:30px}section th,section td{border:1px solid #d0d7de;padding:10px 24px}section th{background:#f6f8fa}
section blockquote{border-left:8px solid #0969da;margin:0;padding:0 28px;font-size:42px}
section img{height:300px;border-radius:8px}.cols{display:flex;gap:40px}.cols>div{flex:1}
`;
export default {
  file: 'marp-svg.html',
  html: doc({ title: 'Marp Export', css, body: slides + '\n' }),
  meta: { slides: 8, slideSelector: 'svg.s section', exclusive: false, navKey: null, editText: 'section[id="1"] h1', moveSel: 'section[id="6"] img', moveSlide: 5, find: 'Slidev', tags: ['svg-foreignobject', 'markdown-output', 'header-footer-pagination', 'no-javascript', 'code', 'table', 'blockquote', 'invert-theme'] },
};
