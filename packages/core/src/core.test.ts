import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Editor, detectDeck, getAttr, openBytes, parseSource, saveBytes, setPlainTextCommand, moveCommand, setStyleCommand,
  resetPositionCommand, deleteElementCommand, duplicateElementCommand, reorderCommand, sanitizePastedHtml, sanitizeRequestPath,
  isInside, setStyleProp, removeStyleProp, getStyleProp, isSafeCssValue, renderLiveHtml, assertNoArtifacts, setInnerHtmlCommand,
  textOf, findOutsideRefs, isSimpleInlineHtml, slideSteps, setStepCommand, stepOf, scriptTextProblem, replaceScriptTextCommand, scriptInteractions,
} from './index.js';

const DIR = join(__dirname, '../../../test-decks/decks');
const decks = readdirSync(DIR).filter((f) => f.endsWith('.html'));
const load = (n: string) => new Uint8Array(readFileSync(join(DIR, n)));
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe('RT-01 no-op save is byte-identical', () => {
  for (const name of decks) {
    it(name, () => {
      const bytes = load(name);
      expect(eq(saveBytes(openBytes(bytes)), bytes)).toBe(true);
    });
  }
  it('detects encodings and EOL', () => {
    expect(openBytes(load('latin1-crlf.html')).meta).toMatchObject({ encoding: 'windows-1252', eol: 'crlf', bom: false });
    expect(openBytes(load('utf8-bom.html')).meta).toMatchObject({ encoding: 'utf-8', bom: true });
  });
});

describe('RT-02 minimal diffs', () => {
  const diffRegion = (a: string, b: string) => {
    let s = 0;
    while (a[s] === b[s]) s++;
    let e = 0;
    while (a[a.length - 1 - e] === b[b.length - 1 - e] && e < a.length - s && e < b.length - s) e++;
    return { prefix: a.slice(0, s), suffix: a.slice(a.length - e) };
  };

  it('text edit changes only that text (CRLF + windows-1252 preserved)', () => {
    const bytes = load('latin1-crlf.html');
    const ed = new Editor(openBytes(bytes));
    const h1 = ed.doc.elements.find((e) => e.tag === 'h1')!;
    ed.exec(setPlainTextCommand(h1.id, 'Th\u00e9 new'));
    const out = Buffer.from(saveBytes(ed.doc));
    const orig = Buffer.from(bytes);
    // everything before/after the h1 content is byte-identical
    const before = orig.subarray(0, h1.startTagEnd);
    expect(out.subarray(0, h1.startTagEnd).equals(before)).toBe(true);
    expect(out.toString('latin1')).toContain('Th\xe9 new');
    expect(out.toString('latin1').split('\r\n').length).toBe(orig.toString('latin1').split('\r\n').length);
    expect(out.toString('latin1')).not.toMatch(/[^\r]\n/);
  });

  it('move writes only the style attribute of that element', () => {
    const src = new TextDecoder().decode(load('ai-fixed-stage.html'));
    const ed = new Editor(openBytes(load('ai-fixed-stage.html')));
    const logo = ed.doc.elements.find((e) => getAttr(e, 'class') === 'logo')!;
    ed.exec(moveCommand(logo.id, 'free', { left: '100px', top: '40px' }));
    const out = ed.doc.text;
    const { prefix, suffix } = diffRegion(src, out);
    expect(prefix.length + suffix.length).toBeGreaterThan(src.length - 120);
    expect(out).toContain('<div class="logo" style="left: 100px; top: 40px;"></div>');
  });

  it('only changed declarations are touched, order/format kept', () => {
    const s = 'color: #555; opacity: .9';
    expect(setStyleProp(s, 'color', 'red')).toBe('color: red; opacity: .9');
    expect(setStyleProp(s, 'translate', '1px 2px')).toBe('color: #555; opacity: .9; translate: 1px 2px;');
    expect(removeStyleProp('a: 1; b: 2; c: 3', 'b')).toBe('a: 1; c: 3');
    expect(getStyleProp('background: url(a;b.png); x: 1', 'x')).toBe('1');
    expect(setStyleProp('background: url(a;b.png); x: 1', 'x', '2')).toBe('background: url(a;b.png); x: 2');
  });

  it('keeps single-quote style and spacing when editing an existing attribute', () => {
    const ed = new Editor(openBytes(new TextEncoder().encode("<div id='a' style = 'top:1px'>x</div>")));
    const el = ed.doc.elements.find((e) => e.tag === 'div')!;
    ed.exec(setStyleCommand(el.id, 'top', '5px'));
    expect(ed.doc.text).toBe("<div id='a' style = 'top:5px'>x</div>");
  });

  it('delete / duplicate / reorder slides keep surroundings', () => {
    const ed = new Editor(openBytes(load('utf8-bom.html')));
    const slides = ed.doc.elements.filter((e) => e.tag === 'section');
    ed.exec(duplicateElementCommand(slides[0]!.id));
    expect(ed.doc.elements.filter((e) => e.tag === 'section')).toHaveLength(3);
    ed.undo();
    expect(eq(saveBytes(ed.doc), load('utf8-bom.html'))).toBe(true);
    ed.exec(deleteElementCommand(slides[1]!.id));
    expect(ed.doc.elements.filter((e) => e.tag === 'section')).toHaveLength(1);
    ed.undo();
    ed.exec(reorderCommand(slides[1]!.id, slides[0]!.id));
    const order = ed.doc.elements.filter((e) => e.tag === 'section').map((e) => textOf(ed.doc, e).slice(0, 12));
    expect(order[0]).toContain('Tom');
    ed.undo();
    expect(eq(saveBytes(ed.doc), load('utf8-bom.html'))).toBe(true);
  });
});

describe('undo / redo', () => {
  it('restores exact bytes, coalesces nudges, redoes', () => {
    let t = 0;
    const ed = new Editor(openBytes(load('ai-fixed-stage.html')), () => t);
    const orig = ed.doc.text;
    const logo = ed.doc.elements.find((e) => getAttr(e, 'class') === 'logo')!;
    for (let i = 1; i <= 5; i++) { t += 100; ed.exec(moveCommand(logo.id, 'layout', { translate: `${i}px 0px` }, 'nudge')); }
    expect(ed.doc.text).toContain('translate: 5px 0px');
    expect(ed.undo()).toBe(true);
    expect(ed.doc.text).toBe(orig);
    expect(ed.canUndo).toBe(false);
    ed.redo();
    expect(ed.doc.text).toContain('translate: 5px 0px');
    ed.undo();
    ed.exec(moveCommand(logo.id, 'layout', { translate: '9px 9px' }));
    ed.exec(resetPositionCommand(logo.id));
    ed.undo(); ed.undo();
    expect(ed.doc.text).toBe(orig);
  });
});

describe('slide detection (SPIKE-4)', () => {
  const expectN: Record<string, [string, number]> = {
    'ai-fixed-stage.html': ['generic', 3],
    'responsive-scroll-snap.html': ['generic', 3],
    'reveal-style.html': ['revealjs', 5],
    'latin1-crlf.html': ['generic', 2],
    'utf8-bom.html': ['generic', 2],
    'malformed.html': ['generic', 3],
    'base64-images.html': ['generic', 2],
    'multi-file.html': ['generic', 2],
    'large-100.html': ['generic', 100],
    'hostile.html': ['generic', 2],
    'plain-page.html': ['page', 1],
    'marp-export.html': ['marp', 3],
    'impress-style.html': ['impress', 3],
    'shower-style.html': ['shower', 3],
    'fade-animations.html': ['generic', 3],
    'chart-svg-icons.html': ['generic', 2],
    'remote-fonts-tailwind.html': ['generic', 2],
  };
  for (const [name, [adapter, n]] of Object.entries(expectN)) {
    it(`${name} → ${adapter} / ${n}`, () => {
      const d = detectDeck(openBytes(load(name)));
      expect(d.adapter).toBe(adapter);
      expect(d.slides).toHaveLength(n);
    });
  }
  it('flags hidden reveal slides', () => {
    const d = detectDeck(openBytes(load('reveal-style.html')));
    expect(d.slides.filter((s) => s.hidden)).toHaveLength(1);
  });
});

describe('SEC-03 path containment', () => {
  const bad = ['/../secret', '/a/../../b', '/%2e%2e/x', '/%252e%252e/x', '/a%00b', '/a\\b', '//server/share', '/C:/Windows/win.ini', '/c%3a/x',
    '/file.txt::$DATA', '/nul', '/aux.txt', '/trail./x', '/sp /x', '/a/..%2f..%2fb'];
  for (const p of bad) it(`rejects ${p}`, () => expect(sanitizeRequestPath(p)).toBeNull());
  it('accepts normal paths', () => {
    expect(sanitizeRequestPath('/assets/pic.png')).toBe('assets/pic.png');
    expect(sanitizeRequestPath('/a%20b/c.css')).toBe('a b/c.css');
    expect(sanitizeRequestPath('/')).toBe('');
  });
  it('isInside is prefix-safe and case-aware', () => {
    expect(isInside('C:\\d\\deck', 'C:\\d\\deck\\a.png', '\\', true)).toBe(true);
    expect(isInside('C:\\d\\deck', 'C:\\d\\deck2\\a.png', '\\', true)).toBe(false);
    expect(isInside('C:\\d\\deck', 'c:\\D\\DECK\\a', '\\', true)).toBe(true);
    expect(isInside('/d/deck', '/d/DECK/a', '/', false)).toBe(false);
  });
});

describe('TXT-11 sanitizer', () => {
  const cases: [string, RegExp[]][] = [
    ['<script>alert(1)</script>hi', [/^hi$/]],
    ['<img src=x onerror=alert(1)>t', [/^t$/]],
    ['<a href="javascript:alert(1)">x</a>', [/^<a>x<\/a>$/]],
    ['<a href="java\tscript:alert(1)">x</a>', [/^<a>x<\/a>$/]],
    ['<a href=" &#x6A;avascript:alert(1)">x</a>', [/^<a>x<\/a>$/]],
    ['<a href="https://ok.com/?a=1&b=\"2">x</a>', [/href="https:\/\/ok.com/]],
    ['<b onclick="x()">bold</b>', [/^<b>bold<\/b>$/]],
    ['<style>*{x:y}</style>a<!-- c -->b', [/^ab$/]],
    ['<svg><script>1</script></svg>t', [/^t$/]],
    ['<p class="MsoNormal" style="mso-x:1"><o:p>t</o:p></p>', [/^<p>t<\/p>$/]],
    ['<iframe src="x"></iframe>z', [/^z$/]],
    ['a < b & c', [/^a &lt; b &amp; c$/]],
    ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>', [/^(?!.*<img)(?!.*onerror=).*$/s]],
  ];
  for (const [input, res] of cases) it(input.slice(0, 40), () => { const out = sanitizePastedHtml(input); for (const r of res) expect(out).toMatch(r); });
  it('fuzz: output never contains script/handlers/js urls', () => {
    const frags = ['<script>', '</script>', '<img src=x onerror=1>', '<a href="javascript:1">', '"', "'", '<', '>', '&', '<svg>', '<style>', '<!--', '-->', 'text', '<b>', '</b>', '<p>', '<iframe>', ' on', 'click=', '<a href=', 'data:text/html,'];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 3000; i++) {
      let s = '';
      for (let j = 0; j < 12; j++) s += frags[Math.floor(rnd() * frags.length)];
      const out = sanitizePastedHtml(s);
      expect(out).not.toMatch(/<(script|style|svg|iframe|img|object|embed)\b/i);
      expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i); // literal "onclick=" as text is harmless; only tags matter
      expect(out).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
    }
  });
  it('setInnerHtmlCommand sanitizes by default', () => {
    const ed = new Editor(parseSource('<p>x</p>', { encoding: 'utf-8', bom: false, eol: 'none' }));
    ed.exec(setInnerHtmlCommand(0 + ed.doc.elements.findIndex((e) => e.tag === 'p'), '<script>alert(1)</script>ok <b onclick=1>b</b>'));
    expect(ed.doc.text).toBe('<p>ok <b>b</b></p>');
  });
});

describe('CSS value safety', () => {
  it('rejects breakouts', () => {
    for (const v of ['red;}</style><script>', 'a;b', 'url(x', '"x', 'expression(1)', 'x\\', 'a/*b', 'red"><img>']) expect(isSafeCssValue(v)).toBe(false);
    for (const v of ['red', 'calc(1px + 2px)', 'var(--x)', "url('a;b.png')", 'translate(1px, 2px)']) expect(isSafeCssValue(v)).toBe(true);
  });
  it('setStyleProp throws for unsafe input', () => {
    expect(() => setStyleProp('', 'left', '1px;} x{')).toThrow();
    expect(() => setStyleProp('', 'left}x', '1px')).toThrow();
  });
  it('attribute values are escaped', () => {
    const ed = new Editor(parseSource('<div>x</div>', { encoding: 'utf-8', bom: false, eol: 'none' }));
    ed.exec(setStyleCommand(0 + ed.doc.elements.findIndex((e) => e.tag === 'div'), 'font-family', "'A \"B\"'"));
    expect(ed.doc.text).not.toMatch(/style="[^"]*"[^>]*"/);
  });
});

describe('RT-05 artifacts', () => {
  it('live html carries ids and agent; source never does', () => {
    const doc = openBytes(load('ai-fixed-stage.html'));
    const live = renderLiveHtml(doc, 'console.log(1)');
    expect(live).toContain('data-deckhand-id=');
    expect(live).toContain('data-deckhand-agent');
    expect(() => assertNoArtifacts(live)).toThrow();
    expect(() => assertNoArtifacts(doc.text)).not.toThrow();
  });
  it('agent script containing </script> cannot break out', () => {
    const live = renderLiveHtml(openBytes(load('plain-page.html')), 'var s="</script><img>"');
    expect(live.match(/<\/script>/gi)!.length).toBe(1);
  });
});

describe('SEC-03 outside references are detected from source', () => {
  it('finds ../ and absolute references but not data/http/anchors', () => {
    const refs = findOutsideRefs('<img src="../secret.png"><link href="/etc/passwd"><div style="background:url(\'..\\x.png\')"></div><img src="a/../../b.png"><a href="#x"><img src="data:image/png;base64,AA"><img src="https://x.com/a.png"><img src="assets/ok.png"><img src=file:///C:/x.png>');
    expect(refs).toEqual(expect.arrayContaining(['../secret.png', '/etc/passwd', 'a/../../b.png', 'file:///C:/x.png']));
    expect(refs.some((r) => r.includes('assets/ok.png') || r.startsWith('data:') || r.startsWith('http') || r === '#x')).toBe(false);
  });
});

describe('text edit fidelity', () => {
  const meta = { encoding: 'utf-8' as const, bom: false, eol: 'none' as const };
  const edit = (src: string, html: string) => {
    const ed = new Editor(parseSource(src, meta));
    const p = ed.doc.elements.find((e) => e.tag === 'p')!;
    ed.exec(setInnerHtmlCommand(p.id, html));
    return ed.doc.text;
  };
  it('keeps class/id/data attributes on inline elements and original <b>/<i> tags', () => {
    expect(edit('<p>a <span class="accent" data-x="1">b</span> <b>c</b></p>', 'A <span class="accent" data-x="1">b</span> <b>c</b>'))
      .toBe('<p>A <span class="accent" data-x="1">b</span> <b>c</b></p>');
  });
  it('restores named entities the source used (&mdash; &nbsp; &copy;)', () => {
    expect(edit('<p>Tom &mdash; Jerry&nbsp;&copy;</p>', 'Tim \u2014 Jerry\u00a0\u00a9')).toBe('<p>Tim &mdash; Jerry&nbsp;&copy;</p>');
  });
  it('still strips handlers, scripts, js: links and url() styles from edited content', () => {
    const out = edit('<p>x</p>', '<span class="k" onclick="x()" style="color:red;background:url(javascript:1)">a</span><a href="javascript:alert(1)">l</a><img src=x onerror=1><script>1</script>');
    expect(out).toBe('<p><span class="k" style="color: red">a</span><a>l</a></p>');
  });
  it('isSimpleInlineHtml refuses embedded objects', () => {
    expect(isSimpleInlineHtml('hello <b>x</b> <span class="a">y</span><br>')).toBe(true);
    expect(isSimpleInlineHtml('hi <img src="a.png">')).toBe(false);
    expect(isSimpleInlineHtml('<svg></svg>')).toBe(false);
  });
});

describe('generic detection on a deck with build steps (reported by a user)', () => {
  it('finds the 8 slides, not the 9 build-step boxes inside one of them', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = openBytes(readFileSync(new URL('../../../test-decks/decks/lorem-steps.html', import.meta.url)));
    const det = detectDeck(doc);
    expect(det.adapter).toBe('generic');
    expect(det.slides).toHaveLength(8);
    expect(det.selector).toBe('section.slide');
    expect(det.slides.every((s) => doc.byId(s.id)!.tag === 'section')).toBe(true);
  });
});

describe('build steps (states) of a slide', () => {
  const lorem = () => openBytes(readFileSync(new URL('../../../test-decks/decks/lorem-steps.html', import.meta.url)));
  it('lists the steps of the architecture slide in order, with the objects of each', () => {
    const doc = lorem();
    const slide = detectDeck(doc).slides[3]!;
    const steps = slideSteps(doc, slide.id);
    expect(steps.map((g) => g.step)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.find((g) => g.step === 2)!.ids.length).toBe(2);
  });
  it('retiming an object changes only its data-step attribute; clearing removes it; undo restores the bytes', () => {
    const doc = lorem();
    const orig = saveBytes(doc);
    const ed = new Editor(doc);
    const id = slideSteps(doc, detectDeck(doc).slides[3]!.id).find((g) => g.step === 1)!.ids[0]!;
    ed.exec(setStepCommand([id], 4));
    expect(stepOf(ed.doc.byId(id)!)).toBe(4);
    ed.exec(setStepCommand([id], null));
    expect(stepOf(ed.doc.byId(id)!)).toBeNull();
    ed.undo(); ed.undo();
    expect(eq(saveBytes(ed.doc), orig)).toBe(true);
  });
});

describe('editing text that a script puts on the slide', () => {
  const lorem = () => openBytes(readFileSync(new URL('../../../test-decks/decks/lorem-steps.html', import.meta.url)));
  const MSG = 'Quis nostrud exercitation ullamco laboris nisi ut aliquip.';
  it('rewrites a chat line inside its string literal and nothing else; undo restores the bytes', () => {
    const doc = lorem();
    const orig = saveBytes(doc);
    const ed = new Editor(doc);
    expect(scriptTextProblem(doc, MSG, "Don't panic, it's fine.")).toBeNull();
    ed.exec(replaceScriptTextCommand(MSG, "Don't panic, it's fine."));
    expect(ed.doc.text).toContain(`addMsg("c", "Don't panic, it's fine.")`);
    expect(ed.doc.text.length - doc.text.length).toBe("Don't panic, it's fine.".length - MSG.length);
    ed.undo();
    expect(eq(saveBytes(ed.doc), orig)).toBe(true);
  });
  it('escapes the quote of the surrounding literal and refuses markup, newlines and unknown text', () => {
    const doc = lorem();
    const ed = new Editor(doc);
    ed.exec(replaceScriptTextCommand(MSG, 'She said "hi"'));
    expect(ed.doc.text).toContain('addMsg("c", "She said \\"hi\\"")');
    expect(scriptTextProblem(doc, MSG, 'a\nb')).not.toBeNull();
    expect(scriptTextProblem(doc, MSG, '</script><b>')).not.toBeNull();
    expect(scriptTextProblem(doc, 'text that is nowhere in the script', 'x')).not.toBeNull();
    expect(replaceScriptTextCommand('nowhere text', 'x').build(doc)).toEqual([]);
  });
});

describe('interactions the deck script listens for', () => {
  it('finds the keyboard navigation and the replay button of the Lorem deck', () => {
    const doc = openBytes(readFileSync(new URL('../../../test-decks/decks/lorem-steps.html', import.meta.url)));
    const found = scriptInteractions(doc);
    const key = found.find((i) => i.event === 'keydown')!;
    expect(key.target).toBe('document');
    expect(key.keys).toEqual(expect.arrayContaining(['ArrowRight', 'Space']));
    expect(found.some((i) => i.event === 'click' && i.target === '#replay')).toBe(true);
  });
});
