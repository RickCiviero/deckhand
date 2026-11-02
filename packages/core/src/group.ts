/** Group / Ungroup (ARR-03): wrap contiguous sibling objects in a <div>, or unwrap one. Edits are exact insertions and deletions of tags; the children keep their markup. */
import { patchCommand, type Command } from './commands.js';
import type { Patch } from './patch.js';
import { getAttr, setAttrPatch, type ElementInfo, type SourceDoc } from './source.js';
import { setStyleProp } from './style.js';

export const GROUP_ATTR = 'data-deckhand-group';

/** Why these objects cannot be grouped, or null when they can: two or more siblings of one parent, next to each other. */
export function groupProblem(doc: SourceDoc, ids: number[]): string | null {
  const els = ids.map((id) => doc.byId(id));
  if (els.length < 2 || els.some((e) => !e)) return 'Select two or more objects to group them.';
  const parent = els[0]!.parent;
  if (parent === null || els.some((e) => e!.parent !== parent)) return 'Only objects with the same parent can be grouped.';
  const sibs = doc.byId(parent)!.children;
  const idx = els.map((e) => sibs.indexOf(e!.id)).sort((a, b) => a - b);
  if (idx.some((v, i) => i > 0 && v !== idx[i - 1]! + 1)) return 'Only objects next to each other in the file can be grouped. Reorder them in the Selection Pane first.';
  return null;
}

type StyleSet = Record<string, string>;
const restyle = (doc: SourceDoc, el: ElementInfo, set: StyleSet): Patch => {
  let style = getAttr(el, 'style') ?? '';
  for (const [p, v] of Object.entries(set)) style = setStyleProp(style, p, v);
  return setAttrPatch(doc, el, 'style', style);
};

/** `wrapper` is the group's own inline style (null for an in-layout group); `childSet` the style changes that keep each child where it was. */
export function groupCommand(ids: number[], wrapper: StyleSet | null, childSet: Map<number, StyleSet>): Command {
  let wrapperStyle: string | null = null;
  if (wrapper) {
    wrapperStyle = Object.entries(wrapper).reduce((st, [k, v]) => setStyleProp(st, k, v), ''); // throws on unsafe declarations
    if (/["<>&]/.test(wrapperStyle)) throw new Error('Unsafe group style');
  }
  return patchCommand('Group', (doc) => {
    if (groupProblem(doc, ids)) return [];
    const els = ids.map((id) => doc.byId(id)!).sort((a, b) => a.start - b.start);
    const first = els[0]!; const last = els[els.length - 1]!;
    const patches: Patch[] = [
      { start: first.start, end: first.start, text: `<div ${GROUP_ATTR}${wrapperStyle !== null ? ` style="${wrapperStyle}"` : ''}>` },
      { start: last.end, end: last.end, text: '</div>' },
    ];
    for (const el of els) { const set = childSet.get(el.id); if (set && Object.keys(set).length) patches.push(restyle(doc, el, set)); }
    return patches;
  });
}

export const isGroup = (doc: SourceDoc, id: number): boolean => { const e = doc.byId(id); return !!e && e.tag === 'div' && getAttr(e, GROUP_ATTR) !== undefined && e.endTagStart !== null; };

/** Remove the wrapper's tags; `childSet` moves the children by the wrapper's offset so they stay put. */
export function ungroupCommand(id: number, childSet: Map<number, StyleSet>): Command {
  return patchCommand('Ungroup', (doc) => {
    const g = doc.byId(id);
    if (!g || !isGroup(doc, id)) return [];
    const patches: Patch[] = [
      { start: g.start, end: g.startTagEnd, text: '' },
      { start: g.endTagStart!, end: g.end, text: '' },
    ];
    for (const k of g.children) { const set = childSet.get(k); if (set && Object.keys(set).length) patches.push(restyle(doc, doc.byId(k)!, set)); }
    return patches;
  });
}
