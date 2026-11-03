import { doc, lorem } from './lib.mjs';
// CSS-only deck: radio inputs + labels switch slides, no JavaScript at all (a common "no JS" presentation trick).
const N = 7;
const titles = ['CSS Only', 'How it works', 'Selectors', 'Transitions', 'Limits', 'Accessibility', 'Wrap up'];
const radios = Array.from({ length: N }, (_, i) => '<input type="radio" name="s" id="s' + (i + 1) + '" class="nav"' + (i === 0 ? ' checked' : '') + '>').join('\n');
const showRules = Array.from({ length: N }, (_, i) => '#s' + (i + 1) + ':checked ~ main .p' + (i + 1)).join(',\n') + '{display:flex;opacity:1}';
const dots = Array.from({ length: N }, (_, i) => '<label for="s' + (i + 1) + '" class="dot" title="' + titles[i] + '"></label>').join('');
const slides = titles.map((t, i) => '<section class="slide p' + (i + 1) + '"><h1>' + t + '</h1><p>' + lorem[i % lorem.length] + '</p>' +
  (i === 3 ? '<div class="box"></div>' : '') + (i === 4 ? '<ul><li>No state</li><li>No timing</li><li>No logic</li></ul>' : '') + '</section>').join('\n');
const css = `
html,body{margin:0;height:100%;font-family:system-ui,Arial,sans-serif;background:#12202e;color:#f3f3f3}
.nav{position:absolute;opacity:0;pointer-events:none}
main{position:absolute;inset:0}
.slide{position:absolute;inset:0;display:none;flex-direction:column;justify-content:center;padding:0 12vw;opacity:0;transition:opacity .4s}
.slide h1{font-size:6vw;margin:0 0 2vw;color:#7fdbca}.slide p{font-size:2.6vw;max-width:60vw;line-height:1.4}
.slide ul{font-size:2.6vw}
${showRules}
.dots{position:fixed;left:0;right:0;bottom:3vh;display:flex;justify-content:center;gap:14px}
.dot{width:16px;height:16px;border-radius:50%;background:#456;cursor:pointer}
${Array.from({ length: N }, (_, i) => '#s' + (i + 1) + ':checked ~ .dots label[for=s' + (i + 1) + ']').join(',')}{background:#7fdbca}
.box{width:12vw;height:12vw;background:#f78c6c;border-radius:1vw;margin-top:2vw;transition:transform .8s}
.p4 .box{transform:rotate(0)}.p4:hover .box{transform:rotate(180deg) scale(1.2)}
`;
const body = radios + '\n<main>\n' + slides + '\n</main>\n<div class="dots">' + dots + '</div>\n';
export default {
  file: 'css-only.html',
  html: doc({ title: 'CSS Only', css, body }),
  meta: { slides: N, slideSelector: 'main > .slide', exclusive: true, navKey: null, editText: '.p1 h1', moveSel: '.p4 .box', moveSlide: 3, find: 'Selectors', tags: ['no-javascript', 'radio-hack', 'css-transitions', 'hover', 'display-none-slides'] },
};
