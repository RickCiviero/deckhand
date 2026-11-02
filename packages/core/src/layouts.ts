/** Layouts derived from the deck itself (ADP-07): slides clustered by structural skeleton, new slides cloned from them. */
import { detectDeck, type SlideRef } from './adapters.js';
import { applyPatches, type Patch } from './patch.js';
import { getAttr, removeAttrPatch, setAttrPatch, type ElementInfo, type SourceDoc } from './source.js';
import type { Command } from './commands.js';

export interface Layout { id: string; name: string; /** Slide whose markup is cloned. */ slideId: number; count: number; slides: number[] }

const STATE_CLASS = /^(active|current|present|past|future|visible|is-active|show|shown)$/;
const classesOf = (e: ElementInfo): string[] => (getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean);
const SKIP = new Set(['script', 'style', 'template']);

const kids = (doc: SourceDoc, e: ElementInfo): ElementInfo[] => e.children.map((c) => doc.byId(c)!).filter((c) => !SKIP.has(c.tag));

function skeleton(doc: SourceDoc, e: ElementInfo, depth = 0): string {
  const cls = classesOf(e).filter((c) => !STATE_CLASS.test(c))[0];
  const inner = depth < 4 ? kids(doc, e).map((k) => skeleton(doc, k, depth + 1)).join(',') : '';
  return `${e.tag}${cls ? `.${cls}` : ''}(${inner})`;
}

const count = (doc: SourceDoc, e: ElementInfo, f: (x: ElementInfo) => boolean): number => doc.elements.filter((x) => x.start > e.start && x.end <= e.end && f(x)).length;

function nameOf(doc: SourceDoc, e: ElementInfo): string {
  const imgs = count(doc, e, (x) => x.tag === 'img' || x.tag === 'svg' || x.tag === 'picture' || x.tag === 'canvas');
  const heads = count(doc, e, (x) => /^h[1-6]$/.test(x.tag));
  const lists = count(doc, e, (x) => x.tag === 'ul' || x.tag === 'ol');
  const texts = count(doc, e, (x) => ['p', 'blockquote', 'li'].includes(x.tag));
  const top = kids(doc, e);
  const cols = top.length >= 2 && top.every((k) => k.tag === top[0]!.tag && classesOf(k).join() === classesOf(top[0]!).join()) && top[0]!.tag !== 'li' && !/^h[1-6]$/.test(top[0]!.tag);
  if (imgs && texts) return 'Picture and text';
  if (imgs) return 'Picture';
  if (cols && heads <= 1) return top.length === 2 ? 'Two columns' : `${top.length} columns`;
  if (lists) return 'Title and bullets';
  if (heads && texts) return 'Title and text';
  if (heads) return 'Title';
  return 'Content';
}

/** The deck's own layouts, one per distinct skeleton, in order of first use. */
export function deckLayouts(doc: SourceDoc, slides: SlideRef[] = detectDeck(doc).slides): Layout[] {
  const groups = new Map<string, number[]>();
  for (const s of slides) {
    const k = skeleton(doc, doc.byId(s.id)!);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s.id);
  }
  const used = new Map<string, number>();
  return [...groups.values()].map((ids) => {
    const base = nameOf(doc, doc.byId(ids[0]!)!);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { id: `layout-${ids[0]}`, name: n > 1 ? `${base} ${n}` : base, slideId: ids[0]!, count: ids.length, slides: ids };
  });
}

const PLACEHOLDER_IMG = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect width=%27400%27 height=%27300%27 fill=%27%23d0d0d0%27/%3E%3C/svg%3E';

/** Source of `root` as a template: texts → "Click to add …", pictures → a grey placeholder, ids and state classes removed. */
function template(doc: SourceDoc, root: ElementInfo): string {
  const patches: Patch[] = [];
  for (const e of doc.elements) {
    if (e.start < root.start || e.end > root.end) continue;
    if (SKIP.has(e.tag)) continue;
    const id = e.attrs.find((a) => a.name === 'id');
    if (id) patches.push({ start: id.start > 0 && doc.text[id.start - 1] === ' ' ? id.start - 1 : id.start, end: id.end, text: '' });
    if (e === root) {
      const cls = classesOf(e);
      if (cls.some((c) => STATE_CLASS.test(c))) {
        const keep = cls.filter((c) => !STATE_CLASS.test(c)).join(' ');
        const p = keep ? setAttrPatch(doc, e, 'class', keep) : removeAttrPatch(doc, e, 'class');
        if (p) patches.push(p);
      }
    }
    if (e.tag === 'img') {
      const src = e.attrs.find((a) => a.name === 'src');
      if (src) patches.push(setAttrPatch(doc, e, 'src', PLACEHOLDER_IMG));
    } else if (e.endTagStart !== null && e !== root && e.children.filter((c) => !SKIP.has(doc.byId(c)!.tag)).length === 0) {
      const inner = doc.text.slice(e.startTagEnd, e.endTagStart);
      if (inner.replace(/<[^>]*>/g, '').trim() !== '' && !/^(svg|canvas|textarea|option|title|a|button)$/.test(e.tag)) {
        patches.push({ start: e.startTagEnd, end: e.endTagStart, text: /^h[1-6]$/.test(e.tag) ? 'Click to add title' : 'Click to add text' });
      }
    }
  }
  const slice = applyPatches(doc.text.slice(root.start, root.end), patches.map((p) => ({ ...p, start: p.start - root.start, end: p.end - root.start })));
  return slice;
}

/** Add a slide after `afterId` (null = at the start) cloned from a layout slide, or an empty one with the deck's slide classes ('blank'). */
export function newSlideCommand(from: number | 'blank', afterId: number | null, referenceId: number): Command {
  return {
    label: 'New slide',
    build(doc) {
      const ref = doc.byId(referenceId);
      const src = from === 'blank' ? ref : doc.byId(from);
      const anchor = doc.byId(afterId ?? referenceId);
      if (!ref || !src || !anchor) return [];
      let html: string;
      if (from === 'blank') {
        const cls = classesOf(src).filter((c) => !STATE_CLASS.test(c)).join(' ');
        html = `<${src.tag}${cls ? ` class="${cls}"` : ''}>\n</${src.tag}>`;
      } else html = template(doc, src);
      const lineStart = doc.text.lastIndexOf('\n', anchor.start - 1) + 1;
      const lead = doc.text.slice(lineStart, anchor.start);
      const indent = /^[ \t]*/.exec(lead)![0];
      const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
      const body = html.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join(eol);
      const own = lead.trim() === '';
      if (afterId === null) return [{ start: anchor.start, end: anchor.start, text: own ? `${body}${eol}${indent}` : body }];
      return [{ start: anchor.end, end: anchor.end, text: own ? `${eol}${indent}${body}` : body }];
    },
  };
}
