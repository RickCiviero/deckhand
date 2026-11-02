/** Find and Replace over the text of the slides (not markup): matches are exact source ranges, so a replacement changes only those characters. */
import { detectDeck } from './adapters.js';
import type { Command } from './commands.js';
import type { Patch } from './patch.js';
import { escapeText, type ElementInfo, type SourceDoc } from './source.js';

export interface FindOptions { matchCase?: boolean; wholeWord?: boolean }
export interface FindMatch { slide: number; id: number; start: number; end: number; text: string; before: string; after: string }

const SKIP = new Set(['script', 'style', 'template', 'title', 'noscript', 'textarea']);
const MAX = 1000;

/** Text ranges directly inside `e` (between its child elements and comments). */
function* textRanges(doc: SourceDoc, e: ElementInfo): Generator<[number, number]> {
  if (e.endTagStart === null || SKIP.has(e.tag)) return;
  let pos = e.startTagEnd;
  // children the parser re-created for malformed markup (e.g. a reopened <b>) point back to earlier source: they are not inside this element's text
  const cuts = e.children.map((c) => doc.byId(c)!).filter((c) => c.start >= e.startTagEnd).sort((a, b) => a.start - b.start);
  const emit = function* (from: number, to: number): Generator<[number, number]> {
    const seg = doc.text.slice(from, to);
    let at = 0;
    for (const m of seg.matchAll(/<!--[\s\S]*?-->/g)) {
      if (m.index! > at) yield [from + at, from + m.index!];
      at = m.index! + m[0].length;
    }
    if (at < seg.length) yield [from + at, to];
  };
  for (const c of cuts) {
    if (c.start > pos) yield* emit(pos, c.start);
    pos = Math.max(pos, c.end);
  }
  if (pos < e.endTagStart) yield* emit(pos, e.endTagStart);
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** All occurrences of `query` in the slides' text, in document order. The query is matched against the source, so `&` finds `&amp;`. */
export function findText(doc: SourceDoc, query: string, opts: FindOptions = {}): FindMatch[] {
  if (!query) return [];
  const needle = escapeText(query);
  const hay = (s: string): string => (opts.matchCase ? s : s.toLowerCase());
  const n = hay(needle);
  const out: FindMatch[] = [];
  const slides = detectDeck(doc).slides;
  for (const [si, s] of slides.entries()) {
    const root = doc.byId(s.id)!;
    for (const e of doc.elements) {
      if (e.start < root.start || e.end > root.end) continue;
      for (const [from, to] of textRanges(doc, e)) {
        const seg = hay(doc.text.slice(from, to));
        for (let i = seg.indexOf(n); i >= 0; i = seg.indexOf(n, i + n.length)) {
          const a = from + i;
          const b = a + n.length;
          if (opts.wholeWord && (isWordChar(doc.text[a - 1]) || isWordChar(doc.text[b]))) continue;
          out.push({ slide: si, id: e.id, start: a, end: b, text: doc.text.slice(a, b), before: doc.text.slice(Math.max(from, a - 20), a), after: doc.text.slice(b, Math.min(to, b + 20)) });
          if (out.length >= MAX) return out;
        }
      }
    }
  }
  return out;
}

/** Replace the given matches (all of `findText`'s result, or one). The replacement is plain text: it is escaped, never markup. */
export function replaceCommand(matches: FindMatch[], replacement: string): Command {
  const text = escapeText(replacement);
  return {
    label: matches.length === 1 ? 'Replace' : `Replace ${matches.length} occurrences`,
    build(doc): Patch[] {
      return matches.filter((m) => doc.text.slice(m.start, m.end) === m.text).map((m) => ({ start: m.start, end: m.end, text }));
    },
  };
}
