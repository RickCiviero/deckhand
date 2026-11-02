/** What the deck's own script reacts to (keys, clicks…), found in the source so the author can see and jump to it. Read-only: nothing is run. */
import type { SourceDoc } from './source.js';

export interface Interaction { event: string; target: string; keys: string[]; pos: number; line: number }

const KEY = /["'](Arrow(?:Left|Right|Up|Down)|PageDown|PageUp|Enter|Escape|Home|End| |Backspace|Tab)["']/g;
const ON = /\.on(click|dblclick|keydown|keyup|mousedown|touchstart|wheel|hashchange)\s*=/g;
const ADD = /addEventListener\(\s*(["'`])(\w+)\1/g;

export function scriptInteractions(doc: SourceDoc): Interaction[] {
  const out: Interaction[] = [];
  for (const e of doc.elements) {
    if (e.tag !== 'script' || e.endTagStart === null) continue;
    const body = doc.text.slice(e.startTagEnd, e.endTagStart);
    const add = (index: number, event: string): void => {
      const lineStart = body.lastIndexOf('\n', index - 1) + 1;
      const head = body.slice(lineStart, index);
      const id = /getElementById\(\s*["'](\w[\w-]*)["']\s*\)\s*\.?\s*$/.exec(head)?.[1];
      const target = id ? `#${id}` : /(document|window)\.$/.exec(head)?.[1] ?? 'element';
      const keys = [...new Set([...body.slice(index, index + 700).matchAll(KEY)].map((k) => (k[1] === ' ' ? 'Space' : k[1]!)))];
      const pos = e.startTagEnd + index;
      out.push({ event, target, keys: /^key/.test(event) ? keys : [], pos, line: doc.text.slice(0, pos).split('\n').length });
    };
    for (const m of body.matchAll(ADD)) add(m.index!, m[2]!);
    for (const m of body.matchAll(ON)) add(m.index!, m[1]!);
  }
  return out.sort((a, b) => a.pos - b.pos).slice(0, 200);
}
