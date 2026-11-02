/** Build steps (states) of a slide: objects that appear on the n-th action (arrow, space, click) of the presentation. */
import { getAttr, removeAttrPatch, setAttrPatch, type ElementInfo, type SourceDoc } from './source.js';
import type { Command } from './commands.js';
import type { Patch } from './patch.js';

export const STEP_ATTRS = ['data-step', 'data-fragment-index'] as const;

/** The element's own step number, or null when it is always visible. */
export function stepOf(e: ElementInfo): number | null {
  for (const a of STEP_ATTRS) {
    const v = getAttr(e, a);
    if (v !== undefined && /^\d{1,3}$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

export interface StepGroup { step: number; ids: number[] }

/** Steps used inside a slide, in order, with the objects that appear at each. */
export function slideSteps(doc: SourceDoc, slideId: number): StepGroup[] {
  const by = new Map<number, number[]>();
  const walk = (id: number): void => {
    const e = doc.byId(id);
    if (!e) return;
    for (const c of e.children) {
      const k = doc.byId(c)!;
      const s = stepOf(k);
      if (s !== null) by.set(s, [...(by.get(s) ?? []), k.id]);
      walk(c);
    }
  };
  walk(slideId);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([step, ids]) => ({ step, ids }));
}

/** Set (1–999) or clear (null) the step of the objects, keeping the attribute the deck already uses (default `data-step`). */
export function setStepCommand(ids: number[], step: number | null): Command {
  return {
    label: step === null ? 'Always show' : `Appear at step ${step}`,
    build(doc): Patch[] {
      const out: Patch[] = [];
      for (const id of ids) {
        const e = doc.byId(id);
        if (!e) continue;
        const own = STEP_ATTRS.find((a) => getAttr(e, a) !== undefined);
        if (step === null) {
          if (own) { const p = removeAttrPatch(doc, e, own); if (p) out.push(p); }
          continue;
        }
        const n = String(Math.max(1, Math.min(999, Math.round(step))));
        const name = own ?? STEP_ATTRS.find((a) => doc.elements.some((x) => getAttr(x, a) !== undefined)) ?? 'data-step';
        if (getAttr(e, name) !== n) out.push(setAttrPatch(doc, e, name, n));
      }
      return out;
    },
  };
}
