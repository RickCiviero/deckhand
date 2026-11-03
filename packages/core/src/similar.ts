/** Apply to all similar: objects that share the selected object's tag and class list, on every slide, receive its look. */
import { styleMultiCommand, type Command } from './commands.js';
import { isObjectTag } from './objects.js';
import { getAttr, type SourceDoc } from './source.js';
import { isSafeCssProp, isSafeCssValue, PAINTABLE, styleDeclarations } from './style.js';

const sig = (doc: SourceDoc, id: number): string => {
  const e = doc.byId(id)!;
  return `${e.tag}|${(getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean).sort().join('.')}`;
};

/** Other objects on the slides that look like this one (same tag, same classes). */
export function similarObjects(doc: SourceDoc, id: number, slideIds: number[]): number[] {
  if (!doc.byId(id)) return [];
  const want = sig(doc, id);
  const out: number[] = [];
  const walk = (parent: number): void => {
    for (const c of doc.byId(parent)?.children ?? []) {
      const k = doc.byId(c)!;
      if (isObjectTag(k.tag) && k.id !== id && sig(doc, k.id) === want) out.push(k.id);
      walk(c);
    }
  };
  for (const s of slideIds) walk(s);
  return out;
}

/** The visual declarations of an object's inline style (colour, background, border, font…). */
export function paintOf(doc: SourceDoc, id: number): Record<string, string> {
  const e = doc.byId(id);
  const set: Record<string, string> = {};
  if (e) for (const [p, v] of styleDeclarations(getAttr(e, 'style') ?? '')) if (PAINTABLE.test(p) && isSafeCssProp(p) && isSafeCssValue(v)) set[p] = v;
  return set;
}

export function applyToSimilarCommand(doc: SourceDoc, id: number, slideIds: number[]): Command | null {
  const set = paintOf(doc, id);
  const targets = similarObjects(doc, id, slideIds);
  if (!Object.keys(set).length || !targets.length) return null;
  return styleMultiCommand(`Apply to ${targets.length} similar object${targets.length === 1 ? '' : 's'}`, targets.map((t) => ({ id: t, set })));
}
