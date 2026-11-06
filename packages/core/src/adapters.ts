/** Deck adapters: slide detection (Appendix B + reveal.js). Static pass only; the live pass refines in the UI. */
import { getAttr, type ElementInfo, type SourceDoc } from './source.js';
import { matchSelector, storedSlideSelector } from './selectors.js';

export interface SlideRef {
  /** Element id of the slide root. */
  id: number;
  label: string;
  hidden?: boolean;
}

export interface Detection {
  adapter: 'custom' | 'revealjs' | 'marp' | 'impress' | 'shower' | 'generic' | 'page' | 'website';
  confidence: number;
  slides: SlideRef[];
  /** Suggested CSS-like selector for the Define Slides wizard. */
  selector?: string;
}

const classes = (e: ElementInfo): string[] => (getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean);
const SLIDE_CLASS = /(^|[-_])(slide|page|step|frame|scene|chapter|chap|screen|pane|fullpage)s?($|[-_])/i;
const CHROME = /(nav|progress|counter|controls?|hint|pagination|dots|arrow|prev|next|button|btn)/i;

function label(doc: SourceDoc, e: ElementInfo, i: number): string {
  const h = e.children.map((c) => doc.byId(c)!).find((c) => /^h[1-6]$/.test(c.tag));
  const text = h ? doc.text.slice(h.startTagEnd, h.endTagStart ?? h.startTagEnd).replace(/<[^>]*>/g, '').trim() : '';
  return text ? text.slice(0, 60) : `Slide ${i + 1}`;
}

function detectReveal(doc: SourceDoc): Detection | null {
  const container = doc.elements.find((e) => classes(e).includes('slides') && doc.byId(e.parent ?? -1) && classes(doc.byId(e.parent!)!).includes('reveal'));
  if (!container) return null;
  const slides: SlideRef[] = [];
  for (const cid of container.children) {
    const c = doc.byId(cid)!;
    if (c.tag !== 'section') continue;
    const nested = c.children.map((x) => doc.byId(x)!).filter((x) => x.tag === 'section');
    const unit = nested.length ? nested : [c];
    for (const u of unit) slides.push({ id: u.id, label: label(doc, u, slides.length), hidden: getAttr(u, 'data-visibility') === 'hidden' });
  }
  return slides.length ? { adapter: 'revealjs', confidence: 0.98, slides, selector: '.reveal .slides section' } : null;
}

function detectMarp(doc: SourceDoc): Detection | null {
  const svgs = doc.elements.filter((e) => e.tag === 'svg' && e.attrs.some((a) => a.name === 'data-marpit-svg'));
  if (!svgs.length) return null;
  // the whole svg wrapper is the slide unit (ADP-06)
  return { adapter: 'marp', confidence: 0.98, slides: svgs.map((s, i) => ({ id: s.id, label: marpLabel(doc, s, i) })), selector: 'svg[data-marpit-svg]' };
}
function marpLabel(doc: SourceDoc, svg: ElementInfo, i: number): string {
  const h = doc.elements.find((e) => /^h[1-6]$/.test(e.tag) && e.start >= svg.start && e.end <= svg.end);
  const text = h ? doc.text.slice(h.startTagEnd, h.endTagStart ?? h.startTagEnd).replace(/<[^>]*>/g, '').trim() : '';
  return text ? text.slice(0, 60) : `Slide ${i + 1}`;
}

function detectImpress(doc: SourceDoc): Detection | null {
  const root = doc.elements.find((e) => getAttr(e, 'id') === 'impress');
  if (!root) return null;
  const steps = root.children.map((c) => doc.byId(c)!).filter((c) => classes(c).includes('step'));
  return steps.length ? { adapter: 'impress', confidence: 0.97, slides: steps.map((s, i) => ({ id: s.id, label: label(doc, s, i) })), selector: '#impress .step' } : null;
}

function detectShower(doc: SourceDoc): Detection | null {
  const body = doc.elements.find((e) => e.tag === 'body');
  if (!body || !classes(body).includes('shower')) return null;
  const slides = doc.elements.filter((e) => e.tag === 'section' && classes(e).includes('slide'));
  return slides.length ? { adapter: 'shower', confidence: 0.97, slides: slides.map((s, i) => ({ id: s.id, label: label(doc, s, i) })), selector: 'section.slide' } : null;
}

/** `data-step` / `data-fragment-index` numbers shared by several siblings mark build steps inside one slide (several things appear at step 2), not separate slides. */
const sharesStepNumbers = (kids: ElementInfo[]): boolean => {
  const seen = new Set<string>();
  for (const k of kids) {
    const v = k.attrs.find((a) => a.name === 'data-step' || a.name === 'data-fragment-index')?.value;
    if (v === undefined) continue;
    if (seen.has(v)) return true;
    seen.add(v);
  }
  return false;
};

/** ids like c1, c2, c3… (same prefix, consecutive numbers) are the numbering of a deck's slides. */
const sequentialIds = (kids: ElementInfo[]): boolean => {
  if (kids.length < 3) return false;
  const parts = kids.map((k) => /^(\D*)(\d+)$/.exec(getAttr(k, 'id') ?? ''));
  if (parts.some((m) => !m)) return false;
  const prefix = parts[0]![1]!;
  return parts.every((m, i) => m![1] === prefix && Number(m![2]) === Number(parts[0]![2]) + i);
};

function detectGeneric(doc: SourceDoc): Detection | null {
  type Cand = { parent: ElementInfo; kids: ElementInfo[]; score: number };
  const cands: Cand[] = [];
  let best: Cand | null = null;
  for (const parent of doc.elements) {
    if (['head', 'ul', 'ol', 'table', 'tbody', 'select', 'svg'].includes(parent.tag)) continue;
    const groups = new Map<string, ElementInfo[]>();
    for (const cid of parent.children) {
      const c = doc.byId(cid)!;
      if (['script', 'style', 'link', 'meta', 'template'].includes(c.tag)) continue;
      const key = `${c.tag}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
    }
    for (const [, kids] of groups) {
      if (kids.length < 2) continue;
      let score = 0;
      const sharedSlideClass = kids.every((k) => classes(k).some((c) => SLIDE_CLASS.test(c)));
      if (sharedSlideClass) score += 4;
      else if (kids.filter((k) => classes(k).some((c) => SLIDE_CLASS.test(c))).length >= 2) score += 2;
      if (['section', 'div', 'article'].includes(kids[0]!.tag)) score += 2;
      if (kids.every((k) => k.attrs.some((a) => /^data-(slide|index|step)/.test(a.name) || (a.name === 'id' && /slide|page|step/i.test(a.value))))) score += 2;
      if (sequentialIds(kids)) score += 2;
      if (kids.some((k) => classes(k).some((c) => /^(active|current|present|visible|is-active)$/.test(c)))) score += 3;
      if (kids.every((k) => classes(k).some((c) => CHROME.test(c)))) score -= 5;
      if (kids.length >= 3) score += 1;
      if (kids.length >= 5) score += 1; // a long run of look-alike siblings is much more likely a deck than a layout
      if (sharesStepNumbers(kids)) score -= 5; // build steps, not slides
      cands.push({ parent, kids, score });
      if (!best || score > best.score) best = { parent, kids, score };
    }
  }
  // a group that sits inside a member of another solid group is the contents of one slide (steps, columns, cards), not the deck
  for (let moved = true; best && moved;) {
    moved = false;
    const inside = best.parent;
    const outer = cands.filter((c) => c !== best && c.score >= 5 && c.kids.some((k) => k.start <= inside.start && inside.end <= k.end)).sort((a, b) => b.score - a.score)[0];
    if (outer) { best = outer; moved = true; }
  }
  if (!best || best.score < 3) return null;
  const cls = classes(best.kids[0]!).find((c) => SLIDE_CLASS.test(c));
  return {
    adapter: 'generic',
    confidence: Math.min(1, best.score / 9),
    slides: best.kids.map((k, i) => ({ id: k.id, label: label(doc, k, i) })),
    selector: cls ? `${best.kids[0]!.tag}.${cls}` : best.kids[0]!.tag,
  };
}

const LANDMARKS = new Set(['header', 'nav', 'main', 'section', 'article', 'aside', 'footer']);
const NOT_CONTENT = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript']);
const sectionName = (doc: SourceDoc, e: ElementInfo, i: number): string => {
  if (e.tag === 'header') return 'Header';
  if (e.tag === 'nav') return 'Navigation';
  if (e.tag === 'footer') return 'Footer';
  const l = label(doc, e, i);
  if (!l.startsWith('Slide ')) return l;
  const cls = classes(e)[0];
  return cls ? cls.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()).slice(0, 40) : `Section ${i + 1}`;
};

/** A web page: its top-level blocks (header, nav, sections, footer) are the units the editor lists, like slides in a deck. */
function detectWebsite(doc: SourceDoc): Detection | null {
  const body = doc.elements.find((e) => e.tag === 'body');
  if (!body) return null;
  const content = (p: ElementInfo): ElementInfo[] => p.children.map((c) => doc.byId(c)!).filter((c) => !NOT_CONTENT.has(c.tag));
  let kids = content(body);
  // a lone wrapper (div#app, div.page) holds the real blocks
  while (kids.length === 1 && (kids[0]!.tag === 'div' || kids[0]!.tag === 'main') && content(kids[0]!).length > 1) kids = content(kids[0]!);
  // <main> with several sections inside: the sections are the units
  kids = kids.flatMap((k) => (k.tag === 'main' && content(k).length > 1 ? content(k) : [k]));
  const blocks = kids.filter((k) => LANDMARKS.has(k.tag) || (k.tag === 'div' && content(k).length > 0));
  if (blocks.length < 2 || !blocks.some((k) => LANDMARKS.has(k.tag))) return null;
  return { adapter: 'website', confidence: 0.7, slides: blocks.map((k, i) => ({ id: k.id, label: sectionName(doc, k, i) })) };
}

export function detectDeck(doc: SourceDoc): Detection {
  // a definition the user made (Define Slides) wins over every heuristic
  const stored = storedSlideSelector(doc);
  if (stored) {
    try {
      const ids = matchSelector(doc, stored);
      if (ids.length) return { adapter: 'custom', confidence: 1, slides: ids.map((id, i) => ({ id, label: label(doc, doc.byId(id)!, i) })), selector: stored };
    } catch { /* an unusable stored selector falls back to detection */ }
  }
  const reveal = detectReveal(doc);
  if (reveal) return reveal;
  const framework = detectMarp(doc) ?? detectImpress(doc) ?? detectShower(doc);
  if (framework) return framework;
  const generic = detectGeneric(doc);
  // a solid generic match is a deck; a weak one on a page with landmarks (header, footer, sections) is a website
  if (generic && generic.confidence >= 5 / 9) return generic;
  const site = detectWebsite(doc);
  if (site) return site;
  if (generic) return generic;
  const body = doc.elements.find((e) => e.tag === 'body');
  return { adapter: 'page', confidence: 0.3, slides: body ? [{ id: body.id, label: 'Page' }] : [] };
}
