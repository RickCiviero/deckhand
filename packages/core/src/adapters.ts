/** Deck adapters: slide detection (Appendix B + reveal.js). Static pass only; the live pass refines in the UI. */
import { getAttr, type ElementInfo, type SourceDoc } from './source.js';

export interface SlideRef {
  /** Element id of the slide root. */
  id: number;
  label: string;
  hidden?: boolean;
}

export interface Detection {
  adapter: 'revealjs' | 'generic' | 'page';
  confidence: number;
  slides: SlideRef[];
  /** Suggested CSS-like selector for the Define Slides wizard. */
  selector?: string;
}

const classes = (e: ElementInfo): string[] => (getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean);
const SLIDE_CLASS = /(^|[-_])(slide|page|step|frame|scene)s?($|[-_])/i;
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

function detectGeneric(doc: SourceDoc): Detection | null {
  let best: { parent: ElementInfo; kids: ElementInfo[]; score: number } | null = null;
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
      if (kids.some((k) => classes(k).some((c) => /^(active|current|present|visible|is-active)$/.test(c)))) score += 3;
      if (kids.every((k) => classes(k).some((c) => CHROME.test(c)))) score -= 5;
      if (kids.length >= 3) score += 1;
      if (!best || score > best.score) best = { parent, kids, score };
    }
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

export function detectDeck(doc: SourceDoc): Detection {
  const reveal = detectReveal(doc);
  if (reveal) return reveal;
  const generic = detectGeneric(doc);
  if (generic) return generic;
  const body = doc.elements.find((e) => e.tag === 'body');
  return { adapter: 'page', confidence: 0.3, slides: body ? [{ id: body.id, label: 'Page' }] : [] };
}
