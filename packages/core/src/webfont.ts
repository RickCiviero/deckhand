/** Web fonts: an embedded font file (@font-face) or a link to Google Fonts, added to the document's <head>. */
import { patchCommand, type Command } from './commands.js';
import { isSafeFontName } from './fonts.js';
import type { Patch } from './patch.js';
import type { SourceDoc } from './source.js';

const FORMATS = new Set(['woff2', 'woff', 'truetype', 'opentype']);
const SAFE_SRC = /^[\w%.-]+(\/[\w%.-]+)*$/;

const headEnd = (doc: SourceDoc): number => {
  const head = doc.elements.find((e) => e.tag === 'head');
  if (head?.endTagStart != null) return head.endTagStart;
  return doc.elements.find((e) => e.tag === 'body')?.startTagEnd ?? 0;
};
const lineIndent = (doc: SourceDoc, at: number): string => /^[ \t]*$/.test(doc.text.slice(doc.text.lastIndexOf('\n', at - 1) + 1, at)) ? doc.text.slice(doc.text.lastIndexOf('\n', at - 1) + 1, at) : '';

/** `<style>@font-face…</style>` for a font file that sits inside the deck's folder. */
export function fontFaceCommand(family: string, src: string, format: string): Command {
  return patchCommand(`Embed font ${family}`, (doc): Patch[] => {
    if (!isSafeFontName(family) || !SAFE_SRC.test(src) || src.includes('..') || !FORMATS.has(format)) return [];
    const at = headEnd(doc);
    const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
    const ind = lineIndent(doc, at);
    return [{ start: at, end: at, text: `${ind}  <style>@font-face { font-family: "${family}"; src: url("${src}") format("${format}"); font-display: swap; }</style>${eol}${ind}` }];
  });
}

/** `<link>` to the Google Fonts stylesheet of a family (regular and bold). */
export function fontLinkCommand(family: string): Command {
  return patchCommand(`Link web font ${family}`, (doc): Patch[] => {
    if (!isSafeFontName(family) || /[._]/.test(family)) return [];
    const at = headEnd(doc);
    const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
    const ind = lineIndent(doc, at);
    return [{ start: at, end: at, text: `${ind}  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family.trim().replace(/ +/g, '+')}:wght@400;700&amp;display=swap">${eol}${ind}` }];
  });
}
