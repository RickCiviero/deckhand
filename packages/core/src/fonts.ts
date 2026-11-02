/** Theme Fonts (THM-03): find the font families a deck declares and replace one everywhere, as exact patches on the declarations. */
import { patchCommand, type Command } from './commands.js';
import type { Patch } from './patch.js';
import type { SourceDoc } from './source.js';

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', 'revert']);
// a font-family declaration, or a custom property whose name mentions "font", up to the next ; or }
const DECL = /((?:^|[;{\s"'])(?:font-family|--[\w-]*font[\w-]*)\s*:\s*)([^;}]+)/gi;

/** Text regions that can hold declarations: <style> contents and style attributes. */
function regions(doc: SourceDoc): { start: number; end: number; quote: string }[] {
  const out: { start: number; end: number; quote: string }[] = [];
  for (const e of doc.elements) {
    if (e.tag === 'style' && e.endTagStart !== null) out.push({ start: e.startTagEnd, end: e.endTagStart, quote: '"' });
    const st = e.attrs.find((a) => a.name === 'style');
    if (st) {
      const d = doc.text[st.end - 1];
      const delimited = d === '"' || d === "'";
      // a family name needs quotes when it has a space; inside an attribute they must differ from the attribute's own
      out.push({ start: st.start, end: delimited ? st.end - 1 : st.end, quote: d === '"' ? "'" : '"' });
    }
  }
  return out;
}

const unquote = (f: string): string => f.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const split = (value: string): string[] => value.split(',').map(unquote).filter(Boolean);

/** Families named in the deck, most used first; generic keywords and var() references are left out. */
export function findFonts(doc: SourceDoc): { family: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of regions(doc)) {
    for (const m of doc.text.slice(r.start, r.end).matchAll(DECL)) {
      for (const f of split(m[2]!)) {
        if (GENERIC.has(f.toLowerCase()) || /^var\(/i.test(f) || /[()]/.test(f)) continue;
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
  }
  return [...counts].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

export const isSafeFontName = (f: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/.test(f);

/** Replace one family by another in every declaration. Other families in the same list and everything else stay byte-identical. */
export function replaceFontCommand(from: string, to: string): Command {
  if (!isSafeFontName(to)) throw new Error('That font name has characters that are not allowed.');
  const lower = from.toLowerCase();
  return patchCommand('Replace font', (doc) => {
    const patches: Patch[] = [];
    for (const r of regions(doc)) {
      const seg = doc.text.slice(r.start, r.end);
      for (const m of seg.matchAll(DECL)) {
        const valueStart = r.start + m.index! + m[1]!.length;
        const value = m[2]!;
        const quoted = to.includes(' ') ? `${r.quote}${to}${r.quote}` : to;
        const next = value.split(',').map((part) => (unquote(part).toLowerCase() === lower ? part.replace(part.trim(), quoted) : part)).join(',');
        if (next !== value) patches.push({ start: valueStart, end: valueStart + value.length, text: next });
      }
    }
    return patches;
  });
}
