/** Define Slides (ADP-04): a small CSS selector subset matched against the source model, and the choice stored in the file (Appendix A). */
import { getAttr, setAttrPatch, type ElementInfo, type SourceDoc } from './source.js';
import type { Command } from './commands.js';
import type { Patch } from './patch.js';

export const SLIDES_META = 'deckhand:slides';

interface Compound { tag: string | null; classes: string[]; id: string | null; attrs: { name: string; value: string | null }[] }
interface Step { compound: Compound; combinator: ' ' | '>' }

const STATE_CLASS = /^(active|current|present|past|future|visible|is-active|show|shown)$/;
const IDENT = '[A-Za-z_][\\w-]*';
const IDENT_RE = new RegExp(`^${IDENT}$`);
const COMPOUND = new RegExp(`^(\\*|${IDENT})?((?:\\.${IDENT}|#${IDENT}|\\[${IDENT}(?:=(?:"[^"]*"|'[^']*'|[^\\]]*))?\\])*)$`);
const PART = new RegExp(`\\.(${IDENT})|#(${IDENT})|\\[(${IDENT})(?:=(?:"([^"]*)"|'([^']*)'|([^\\]]*)))?\\]`, 'g');

/** Supported: `tag`, `.class`, `#id`, `[attr]`, `[attr="v"]`, compounds of those, descendant (space) and child (`>`) combinators. */
export function parseSelector(sel: string): Step[] {
  const src = sel.trim();
  if (!src || src.length > 300) throw new Error('Enter a selector such as section.slide');
  const tokens = src.replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const steps: Step[] = [];
  let comb: ' ' | '>' = ' ';
  for (const t of tokens) {
    if (t === '>') { comb = '>'; continue; }
    const m = COMPOUND.exec(t);
    if (!m || (!m[1] && !m[2])) throw new Error(`Unsupported selector part "${t}"`);
    const c: Compound = { tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : null, classes: [], id: null, attrs: [] };
    for (const p of (m[2] ?? '').matchAll(PART)) {
      if (p[1]) c.classes.push(p[1]);
      else if (p[2]) c.id = p[2];
      else c.attrs.push({ name: p[3]!.toLowerCase(), value: p[4] ?? p[5] ?? p[6] ?? null });
    }
    steps.push({ compound: c, combinator: comb });
    comb = ' ';
  }
  if (comb === '>') throw new Error('A selector cannot end with ">"');
  return steps;
}

const matchesCompound = (e: ElementInfo, c: Compound): boolean => {
  if (c.tag && e.tag !== c.tag) return false;
  const cls = (getAttr(e, 'class') ?? '').split(/\s+/);
  if (!c.classes.every((x) => cls.includes(x))) return false;
  if (c.id !== null && getAttr(e, 'id') !== c.id) return false;
  return c.attrs.every((a) => { const v = getAttr(e, a.name); return v !== undefined && (a.value === null || v === a.value); });
};

function matches(doc: SourceDoc, e: ElementInfo, steps: Step[], i: number): boolean {
  const step = steps[i]!;
  if (!matchesCompound(e, step.compound)) return false;
  if (i === 0) return true;
  let p = e.parent === null ? undefined : doc.byId(e.parent);
  while (p) {
    if (matches(doc, p, steps, i - 1)) return true;
    if (step.combinator === '>') return false;
    p = p.parent === null ? undefined : doc.byId(p.parent);
  }
  return false;
}

/** Ids of the elements matching `selector`, in document order; matches nested inside another match are dropped (a slide is the outermost unit). */
export function matchSelector(doc: SourceDoc, selector: string): number[] {
  const steps = parseSelector(selector);
  const hits = doc.elements.filter((e) => !['html', 'head', 'body', 'script', 'style', 'meta', 'link'].includes(e.tag) && matches(doc, e, steps, steps.length - 1));
  const outer: number[] = [];
  let end = -1;
  for (const e of hits) { if (e.start >= end) { outer.push(e.id); end = e.end; } }
  return outer.slice(0, 5000);
}

/** Candidate selectors for an element and each ancestor: tag plus its classes, with the number of slides each would give. */
export function proposeSelectors(doc: SourceDoc, id: number): { id: number; selector: string; count: number }[] {
  const out: { id: number; selector: string; count: number }[] = [];
  for (let e = doc.byId(id); e && !['html', 'body', 'head'].includes(e.tag); e = e.parent === null ? undefined : doc.byId(e.parent)) {
    // state classes (active…) describe one moment, not the kind of slide
    const classes = (getAttr(e, 'class') ?? '').split(/\s+/).filter((c) => IDENT_RE.test(c) && !STATE_CLASS.test(c));
    const selector = e.tag + classes.map((c) => `.${c}`).join('');
    out.push({ id: e.id, selector, count: matchSelector(doc, selector).length });
  }
  return out;
}

/** The custom slide definition stored in the file, if any. */
export function storedSlideSelector(doc: SourceDoc): string | null {
  const m = doc.elements.find((e) => e.tag === 'meta' && getAttr(e, 'name') === SLIDES_META);
  return m ? getAttr(m, 'content') ?? null : null;
}

// a tag that sits alone on its line is removed with the line
const aloneOnLine = (doc: SourceDoc, e: ElementInfo): boolean => doc.text.slice(doc.text.lastIndexOf('\n', e.start - 1) + 1, e.start).trim() === '' && /^[ \t]*\r?(\n|$)/.test(doc.text.slice(e.end));

/** Write (or with `null` remove) `<meta name="deckhand:slides" content="…">` in the head; nothing else in the file changes. */
export function defineSlidesCommand(selector: string | null): Command {
  return {
    label: selector ? 'Define slides' : 'Reset slide definition',
    build(doc): Patch[] {
      if (selector) matchSelector(doc, selector); // throws on an unsupported selector
      const meta = doc.elements.find((e) => e.tag === 'meta' && getAttr(e, 'name') === SLIDES_META);
      if (meta) {
        if (selector) return [setAttrPatch(doc, meta, 'content', selector)];
        if (!aloneOnLine(doc, meta)) return [{ start: meta.start, end: meta.end, text: '' }];
        const start = doc.text.lastIndexOf('\n', meta.start - 1) + 1;
        return [{ start, end: meta.end + /^[ \t]*\r?\n?/.exec(doc.text.slice(meta.end))![0].length, text: '' }];
      }
      if (!selector) return [];
      const head = doc.elements.find((e) => e.tag === 'head');
      if (!head || head.endTagStart === null) return [];
      const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
      const first = head.children.length ? doc.byId(head.children[0]!)! : null;
      const own = !!first && doc.text.slice(doc.text.lastIndexOf('\n', first.start - 1) + 1, first.start).trim() === '';
      const indent = own ? doc.text.slice(doc.text.lastIndexOf('\n', first!.start - 1) + 1, first!.start) : '';
      const esc = selector.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const tag = `<meta name="${SLIDES_META}" content="${esc}">`;
      return [{ start: head.startTagEnd, end: head.startTagEnd, text: own ? `${eol}${indent}${tag}` : tag }];
    },
  };
}
