/** Selection Pane model (SEP-01, ARR-07/08): the objects of a slide as a tree, with names, hidden and locked state, and the commands that change them. */
import { getAttr, removeAttrPatch, setAttrPatch, textOf, type ElementInfo, type SourceDoc } from './source.js';
import { getStyleProp, removeStyleProp, setStyleProp } from './style.js';
import type { Command } from './commands.js';
import type { Patch } from './patch.js';

export const NAME_ATTR = 'data-deckhand-name';
export const LOCK_ATTR = 'data-deckhand-locked';

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'span', 'a', 'sup', 'sub', 'mark', 'small', 'code', 'br', 'font', 'wbr']);
const NOT_OBJECT = new Set(['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'title', 'template', 'noscript']);
export const isObjectTag = (tag: string): boolean => !INLINE.has(tag) && !NOT_OBJECT.has(tag);

export interface ObjectNode { id: number; depth: number; name: string; custom: boolean; hidden: boolean; locked: boolean; tag: string }

const plain = (doc: SourceDoc, e: ElementInfo): string => textOf(doc, e).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Custom name, or "Heading: Quarterly…", "Picture: logo.png", "Text: …", "tag.class". */
export function objectName(doc: SourceDoc, e: ElementInfo): { name: string; custom: boolean } {
  const custom = getAttr(e, NAME_ATTR);
  if (custom) return { name: custom, custom: true };
  const clip = (s: string): string => (s.length > 28 ? `${s.slice(0, 28)}…` : s);
  if (/^h[1-6]$/.test(e.tag)) return { name: `Heading: ${clip(plain(doc, e))}`, custom: false };
  if (e.tag === 'img') {
    const file = (getAttr(e, 'src') ?? '').split(/[/?#]/).filter(Boolean).pop() ?? '';
    let shown = file;
    try { shown = decodeURIComponent(file); } catch { /* keep the raw name */ }
    return { name: `Picture: ${shown.slice(0, 28) || 'image'}`, custom: false };
  }
  if (e.tag === 'p' || e.tag === 'li' || e.tag === 'blockquote') return { name: `Text: ${clip(plain(doc, e))}`, custom: false };
  const cls = (getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean)[0];
  return { name: cls ? `${e.tag}.${cls}` : e.tag, custom: false };
}

const isHidden = (e: ElementInfo): boolean => /^none\b/.test(getStyleProp(getAttr(e, 'style') ?? '', 'display') ?? '');

/** The slide's objects, topmost (last in the source, so painted last) first within each parent. */
export function objectTree(doc: SourceDoc, slideId: number): ObjectNode[] {
  const out: ObjectNode[] = [];
  const walk = (id: number, depth: number): void => {
    const e = doc.byId(id);
    if (!e) return;
    for (const c of [...e.children].reverse()) {
      const k = doc.byId(c)!;
      if (!isObjectTag(k.tag)) continue;
      const { name, custom } = objectName(doc, k);
      out.push({ id: k.id, depth, name, custom, hidden: isHidden(k), locked: getAttr(k, LOCK_ATTR) !== undefined, tag: k.tag });
      walk(k.id, depth + 1);
    }
  };
  walk(slideId, 0);
  return out;
}

export const isLocked = (doc: SourceDoc, id: number): boolean => { const e = doc.byId(id); return !!e && getAttr(e, LOCK_ATTR) !== undefined; };

const attrCommand = (label: string, id: number, name: string, value: string | null): Command => ({
  label,
  build(doc): Patch[] {
    const e = doc.byId(id);
    if (!e) return [];
    if (value === null) { const p = removeAttrPatch(doc, e, name); return p ? [p] : []; }
    return getAttr(e, name) === value ? [] : [setAttrPatch(doc, e, name, value)];
  },
});

export const renameObjectCommand = (id: number, name: string): Command => attrCommand('Rename object', id, NAME_ATTR, name.trim().slice(0, 80) || null);
export const lockObjectCommand = (id: number, locked: boolean): Command => attrCommand(locked ? 'Lock object' : 'Unlock object', id, LOCK_ATTR, locked ? '' : null);

/** Hide = inline `display: none` (hidden in the slide show too, as in PowerPoint); showing removes it (ARR-08). */
export function hideObjectsCommand(ids: number[], hidden: boolean): Command {
  return {
    label: hidden ? 'Hide' : 'Show',
    build(doc): Patch[] {
      const out: Patch[] = [];
      for (const id of ids) {
        const e = doc.byId(id);
        if (!e || isHidden(e) === hidden) continue;
        const style = getAttr(e, 'style') ?? '';
        const next = hidden ? setStyleProp(style, 'display', 'none') : removeStyleProp(style, 'display');
        if (!hidden && next.trim() === '') out.push(removeAttrPatch(doc, e, 'style') ?? setAttrPatch(doc, e, 'style', next));
        else out.push(setAttrPatch(doc, e, 'style', next));
      }
      return out;
    },
  };
}
