/** Source model: the file text parsed with exact offsets. The single source of truth (ARCH-01). */
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { applyPatches, type Patch } from './patch.js';
import { decodeFile, encodeFile, type DecodedFile } from './encoding.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

export interface AttrInfo {
  name: string;
  value: string;
  /** Offsets of the whole `name="value"` text. */
  start: number;
  end: number;
}

export interface ElementInfo {
  id: number;
  tag: string;
  parent: number | null;
  children: number[];
  /** Start of `<tag`, end of the matching close tag (or of the start tag for void/unclosed elements). */
  start: number;
  end: number;
  startTagEnd: number;
  endTagStart: number | null;
  attrs: AttrInfo[];
}

export interface SourceDoc {
  readonly text: string;
  readonly meta: Pick<DecodedFile, 'encoding' | 'bom' | 'eol'>;
  readonly elements: readonly ElementInfo[];
  /** Id → element (ids are document-order ordinals, so they are stable while edits do not add/remove elements). */
  byId(id: number): ElementInfo | undefined;
}

export function openBytes(bytes: Uint8Array): SourceDoc {
  const d = decodeFile(bytes);
  return parseSource(d.text, d);
}

export function saveBytes(doc: SourceDoc): Uint8Array {
  return encodeFile(doc.text, doc.meta);
}

export function parseSource(text: string, meta: Pick<DecodedFile, 'encoding' | 'bom' | 'eol'>): SourceDoc {
  const root = parse(text, { sourceCodeLocationInfo: true });
  const elements: ElementInfo[] = [];

  const visit = (node: Node, parent: number | null): void => {
    const children = 'childNodes' in node ? node.childNodes : [];
    let parentForChildren = parent;
    // <template> content lives in a separate fragment
    const kids: Node[] = [...children];
    if ('content' in node && node.content) kids.push(...node.content.childNodes);
    if ('tagName' in node && node.sourceCodeLocation) {
      const el = node as Element;
      const loc = el.sourceCodeLocation!;
      const attrs: AttrInfo[] = [];
      for (const a of el.attrs) {
        const al = loc.attrs?.[a.name];
        if (al) attrs.push({ name: a.name, value: a.value, start: al.startOffset, end: al.endOffset });
      }
      const info: ElementInfo = {
        id: elements.length,
        tag: el.tagName,
        parent,
        children: [],
        start: loc.startOffset,
        end: loc.endOffset,
        startTagEnd: loc.startTag?.endOffset ?? loc.endOffset,
        endTagStart: loc.endTag?.startOffset ?? null,
        attrs,
      };
      elements.push(info);
      if (parent !== null) elements[parent]!.children.push(info.id);
      parentForChildren = info.id;
    }
    for (const k of kids) visit(k, parentForChildren);
  };
  visit(root, null);
  return {
    text,
    meta,
    elements,
    byId: (id) => elements[id],
  };
}

/** Apply patches and re-parse. Element ids remain valid when patches only touch attributes/text. */
export function applyToDoc(doc: SourceDoc, patches: readonly Patch[]): SourceDoc {
  return parseSource(applyPatches(doc.text, patches), doc.meta);
}

export function getAttr(el: ElementInfo, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name.toLowerCase())?.value;
}

export function textOf(doc: SourceDoc, el: ElementInfo): string {
  return doc.text.slice(el.startTagEnd, el.endTagStart ?? el.startTagEnd);
}

/** Escape text for insertion between tags. */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string, quote: '"' | "'"): string {
  const q = quote === '"' ? '&quot;' : '&#39;';
  return s.replace(/&/g, '&amp;').replace(quote === '"' ? /"/g : /'/g, q).replace(/</g, '&lt;');
}

/** Patch that replaces (or adds) an attribute's value, keeping its quote style. */
export function setAttrPatch(doc: SourceDoc, el: ElementInfo, name: string, value: string): Patch {
  const lname = name.toLowerCase();
  const existing = el.attrs.find((a) => a.name === lname);
  if (existing) {
    const raw = doc.text.slice(existing.start, existing.end);
    const q = /=\s*(["'])/.exec(raw)?.[1] as '"' | "'" | undefined;
    const quote = q ?? '"';
    const eq = raw.indexOf('=');
    const head = eq >= 0 ? raw.slice(0, eq + 1) : `${raw}=`;
    const afterEq = eq >= 0 ? raw.slice(eq + 1) : '';
    const ws = /^\s*/.exec(afterEq)![0];
    return { start: existing.start, end: existing.end, text: `${head}${ws}${quote}${escapeAttr(value, quote)}${quote}` };
  }
  // insert before the closing `>` or `/>` of the start tag
  let pos = el.startTagEnd - 1;
  if (doc.text[pos - 1] === '/') pos -= 1;
  return { start: pos, end: pos, text: ` ${lname}="${escapeAttr(value, '"')}"` };
}

export function removeAttrPatch(doc: SourceDoc, el: ElementInfo, name: string): Patch | null {
  const a = el.attrs.find((x) => x.name === name.toLowerCase());
  if (!a) return null;
  // also swallow one leading space so no double blanks remain
  let start = a.start;
  if (doc.text[start - 1] === ' ') start -= 1;
  return { start, end: a.end, text: '' };
}

export function setTextPatch(doc: SourceDoc, el: ElementInfo, html: string): Patch {
  if (el.endTagStart === null) throw new Error('Element has no content range');
  return { start: el.startTagEnd, end: el.endTagStart, text: html };
}

/** HTML5 parse errors with their offsets (CODE-03). The parser never rejects a file, so "invalid" means more errors than before. */
export function parseErrors(text: string): { code: string; offset: number }[] {
  const out: { code: string; offset: number }[] = [];
  parse(text, { onParseError: (e) => { if (out.length < 200) out.push({ code: e.code, offset: e.startOffset }); } });
  return out;
}
