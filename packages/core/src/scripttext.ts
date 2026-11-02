/** Text that a deck's script puts on the slide (chat lines, terminal output, typed prompts…) lives in the script's string literals: map what is seen back to the source and edit it there. */
import type { Command } from './commands.js';
import type { Patch } from './patch.js';
import type { SourceDoc } from './source.js';

export interface ScriptHit { start: number; end: number; escaped: boolean; quote: string }

const MAX_HITS = 8;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Quote character of the string literal that is open at `at`, or null (not inside a simple one-line literal, or inside a `//` comment). */
function openQuote(src: string, at: number): string | null {
  let i = src.lastIndexOf('\n', at - 1) + 1;
  let q: string | null = null;
  for (; i < at; i++) {
    const c = src[i]!;
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '/' && src[i + 1] === '/') return null;
  }
  return q;
}

/** Occurrences of the text inside inline `<script>` bodies, as written or HTML-escaped. */
export function findScriptText(doc: SourceDoc, text: string): ScriptHit[] {
  const t = text.trim();
  if (t.length < 2 || t.length > 2000 || /[\r\n]/.test(t)) return [];
  const forms: [string, boolean][] = [[t, false]];
  if (esc(t) !== t) forms.push([esc(t), true]);
  const out: ScriptHit[] = [];
  for (const e of doc.elements) {
    if (e.tag !== 'script' || e.endTagStart === null) continue;
    const body = doc.text.slice(e.startTagEnd, e.endTagStart);
    for (const [form, escaped] of forms) {
      for (let at = body.indexOf(form); at !== -1 && out.length <= MAX_HITS; at = body.indexOf(form, at + form.length)) {
        const start = e.startTagEnd + at;
        out.push({ start, end: start + form.length, escaped, quote: openQuote(doc.text, start) ?? '' });
      }
    }
  }
  return out;
}

/** Why this edit cannot be written into the script, or null when it can. */
export function scriptTextProblem(doc: SourceDoc, oldText: string, newText: string): string | null {
  const hits = findScriptText(doc, oldText);
  if (hits.length === 0) return 'This text is not written in the script as one piece (it is typed, joined or computed), so it cannot be edited here.';
  if (hits.length > MAX_HITS) return 'This text appears too many times in the script.';
  if (hits.some((h) => !h.quote)) return 'This text is not inside a simple one-line string in the script, so it cannot be edited here.';
  if (/[\r\n]/.test(newText) || newText.trim().length === 0) return 'Use one line of text.';
  if (/<\/script/i.test(newText)) return 'This text cannot contain a closing script tag.';
  if (hits.some((h) => !h.escaped) && /[<>&]/.test(newText)) return 'Avoid < > & in this text: the script may treat it as markup.';
  return null;
}

/** Replace every occurrence (at most 8) of text seen in a script-built slide with new text, escaped for the literal it sits in. */
export function replaceScriptTextCommand(oldText: string, newText: string): Command {
  return {
    label: 'Edit script text',
    build(doc): Patch[] {
      if (scriptTextProblem(doc, oldText, newText) !== null) return [];
      const next = newText.trim();
      return findScriptText(doc, oldText).map((h) => {
        let v = h.escaped ? esc(next) : next;
        v = v.replace(/\\/g, '\\\\').split(h.quote).join(`\\${h.quote}`);
        if (h.quote === '`') v = v.replace(/\$\{/g, '\\${');
        return { start: h.start, end: h.end, text: v };
      });
    },
  };
}
