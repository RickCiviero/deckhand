import { doc, lorem } from './lib.mjs';
// Data-heavy deck (bespoke.js-style navigation: only .bespoke-active is shown): KPI tiles, SVG charts, table, tabs, accordion, form controls.
const bars = [40, 65, 52, 80, 74, 96].map((v, i) => '<rect x="' + (30 + i * 60) + '" y="' + (150 - v) + '" width="36" height="' + v + '" fill="#4e79a7"/><text x="' + (48 + i * 60) + '" y="168" font-size="12" text-anchor="middle">' + ['J', 'F', 'M', 'A', 'M', 'J'][i] + '</text>').join('');
const line = '<polyline fill="none" stroke="#e15759" stroke-width="3" points="30,120 90,95 150,105 210,60 270,70 330,30"/>' + [[30, 120], [90, 95], [150, 105], [210, 60], [270, 70], [330, 30]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#e15759"/>').join('');
const css = `
html,body{margin:0;height:100%;background:#eef1f5;font-family:"Segoe UI",Arial,sans-serif;color:#1d2733}
article.bespoke-parent{position:absolute;inset:0}
.bespoke-slide{position:absolute;inset:0;display:none;padding:44px 64px;box-sizing:border-box;background:#fff}
.bespoke-slide.bespoke-active{display:block}
h1{font-size:46px;margin:0 0 18px}h2{font-size:34px;margin:0 0 18px;color:#2d6a9f}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:24px}
.kpi{background:#f4f7fb;border-radius:12px;padding:20px;border-left:6px solid #2d6a9f}.kpi b{display:block;font-size:40px}.kpi span{color:#5b6b7b}
.charts{display:flex;gap:30px}.chart{flex:1;background:#f9fafc;border:1px solid #dde3ea;border-radius:12px;padding:12px}
table.data{border-collapse:collapse;width:100%;font-size:20px}table.data th{background:#2d6a9f;color:#fff;text-align:left}table.data th,table.data td{padding:10px 14px;border-bottom:1px solid #dde3ea}
table.data tr:nth-child(even) td{background:#f4f7fb}
.tabs{display:flex;gap:8px;margin-bottom:16px}.tab{padding:10px 20px;border-radius:8px 8px 0 0;background:#dde3ea;cursor:pointer;font-size:20px}.tab.on{background:#2d6a9f;color:#fff}
.panel{display:none;font-size:24px;line-height:1.5;max-width:900px}.panel.on{display:block}
details{background:#f4f7fb;border-radius:10px;padding:12px 18px;margin:10px 0;font-size:22px;max-width:900px}
form.f{display:grid;grid-template-columns:200px 1fr;gap:14px 20px;max-width:760px;font-size:22px}
form.f input,form.f select,form.f textarea{font-size:20px;padding:8px;border:1px solid #b9c3cf;border-radius:6px}
.btn{background:#2d6a9f;color:#fff;border:0;border-radius:8px;padding:12px 26px;font-size:20px;grid-column:2}
.pager{position:fixed;right:20px;bottom:14px;color:#788;font-size:15px}
`;
const slides = [
  '<h1>Quarterly Dashboard</h1><p style="font-size:26px">' + lorem[0] + '</p><div class="kpis"><div class="kpi"><b>$4.2M</b><span>Revenue</span></div><div class="kpi"><b>+18%</b><span>Growth</span></div><div class="kpi"><b>1,284</b><span>Customers</span></div><div class="kpi"><b>96%</b><span>Retention</span></div></div>',
  '<h2>Charts</h2><div class="charts"><div class="chart"><svg viewBox="0 0 400 180" width="100%">' + bars + '</svg></div><div class="chart"><svg viewBox="0 0 400 180" width="100%"><line x1="30" y1="150" x2="370" y2="150" stroke="#999"/>' + line + '</svg></div></div>',
  '<h2>Table</h2><table class="data"><thead><tr><th>Region</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Share</th></tr></thead><tbody>' + [['North', 120, 140, 180, '31%'], ['South', 90, 95, 110, '19%'], ['East', 150, 170, 210, '34%'], ['West', 60, 80, 90, '16%']].map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>',
  '<h2>Tabs</h2><div class="tabs"><div class="tab on" data-t="1">Summary</div><div class="tab" data-t="2">Risks</div><div class="tab" data-t="3">Next</div></div><div class="panel on" data-p="1">' + lorem[1] + '</div><div class="panel" data-p="2">' + lorem[2] + '</div><div class="panel" data-p="3">' + lorem[3] + '</div>',
  '<h2>Accordion</h2><details open><summary>What changed?</summary>' + lorem[4] + '</details><details><summary>Why does it matter?</summary>' + lorem[5] + '</details><details><summary>What next?</summary>' + lorem[0] + '</details>',
  '<h2>Form</h2><form class="f" onsubmit="return false"><label for="nm">Name</label><input id="nm" placeholder="Ada Lovelace"><label for="rg">Region</label><select id="rg"><option>North</option><option>South</option></select><label for="ms">Message</label><textarea id="ms" rows="3">' + lorem[0] + '</textarea><label>Newsletter</label><label><input type="checkbox" checked> Yes please</label><button class="btn" type="button">Send</button></form>',
].map((s, i) => '<section class="bespoke-slide' + (i === 0 ? ' bespoke-active' : '') + '">' + s + '</section>').join('\n');
const body = '<article class="bespoke-parent">\n' + slides + '\n</article>\n<div class="pager" id="pg">1 / 6</div>\n';
const js = `
(function () {
  var all = Array.prototype.slice.call(document.querySelectorAll('.bespoke-slide'));
  var cur = 0;
  function go(i) { cur = Math.max(0, Math.min(all.length - 1, i)); all.forEach(function (s, k) { s.classList.toggle('bespoke-active', k === cur); }); document.getElementById('pg').textContent = (cur + 1) + ' / ' + all.length; }
  document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === ' ') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1); });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.toggle('on', x === t); });
      Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) { p.classList.toggle('on', p.dataset.p === t.dataset.t); });
    });
  });
})();`;
export default {
  file: 'dashboard.html',
  html: doc({ title: 'Quarterly Dashboard', css, body, js }),
  meta: { slides: 6, slideSelector: '.bespoke-slide', exclusive: true, navKey: 'ArrowRight', navProbe: "document.getElementById('pg').textContent", navPresses: 5,
    editText: '.bespoke-slide:nth-child(1) h1', moveSel: '.bespoke-slide:nth-child(1) .kpi', moveSlide: 0, find: 'Retention', tags: ['custom-active-class', 'svg-charts', 'table', 'tabs', 'details-summary', 'form-controls', 'css-grid'] },
};
