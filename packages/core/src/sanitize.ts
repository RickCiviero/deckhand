/** Allow-list sanitizer for pasted HTML (TXT-11, SEC-09). Output is rebuilt from scratch, never passed through. */
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { escapeAttr, escapeText } from './source.js';
import { isSafeCssProp, isSafeCssValue } from './style.js';

type Node = DefaultTreeAdapterMap['node'];

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'p', 'a', 'span', 'li', 'ul', 'ol']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'svg', 'math', 'head', 'title', 'meta', 'link']);
/** Inline formatting an edited text element may contain (anything else means it holds objects, not just text). */
const EDIT_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'a', 'span', 'mark', 'small', 'code', 'kbd', 'abbr', 'q', 'cite', 'time', 'wbr', 'del', 'ins', 'var', 'samp', 'dfn']);
const KEEP_ATTRS = new Set(['class', 'id', 'lang', 'dir', 'title', 'role']);
const SAFE_URL = /^(https?:|mailto:|#)/i;

function cleanUrl(raw: string): string | null {
  // strip control chars / whitespace that browsers ignore inside schemes ("java\tscript:")
  const v = raw.replace(/[\u0000- \u007f-\u009f]/g, '');
  return SAFE_URL.test(v) ? raw.trim() : null;
}

const SPAN_PROPS = new Set(['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration', 'background-color', 'letter-spacing']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em' };

/** Keep only allow-listed, value-checked declarations from a span's style. */
function cleanSpanStyle(raw: string): string {
  const keep: string[] = [];
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const p = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (SPAN_PROPS.has(p) && isSafeCssProp(p) && isSafeCssValue(v) && !/url\s*\(/i.test(v)) keep.push(`${p}: ${v}`);
  }
  return keep.join('; ');
}

interface Opts { keepSpanStyle: boolean; rename: boolean; keepAttrs: boolean }

/** Attributes kept when committing an edit: structural/semantic ones only; no handlers, no url() styles, only safe links. */
function editAttrs(list: { name: string; value: string }[], tag: string): string {
  let out = '';
  for (const a of list) {
    const n = a.name.toLowerCase();
    let v: string | null = null;
    if (KEEP_ATTRS.has(n) || /^aria-[a-z-]+$/.test(n) || /^data-(?!deckhand)[a-z0-9-]+$/.test(n)) v = a.value;
    else if (n === 'href' && tag === 'a') v = cleanUrl(a.value);
    else if (n === 'target' && tag === 'a' && /^_(blank|self)$/.test(a.value)) v = a.value;
    else if (n === 'rel' && tag === 'a' && /^[\w\s-]+$/.test(a.value)) v = a.value;
    else if (n === 'style') {
      const keep: string[] = [];
      for (const part of a.value.split(';')) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        const p = part.slice(0, i).trim().toLowerCase();
        const val = part.slice(i + 1).trim();
        if (isSafeCssProp(p) && isSafeCssValue(val) && !/url\s*\(/i.test(val)) keep.push(`${p}: ${val}`);
      }
      v = keep.length ? keep.join('; ') : null;
    }
    if (v !== null) out += ` ${n}="${escapeAttr(v, '"')}"`;
  }
  return out;
}

function walk(node: Node, out: string[], o: Opts): void {
  if (node.nodeName === '#text') {
    out.push(escapeText((node as DefaultTreeAdapterMap['textNode']).value));
    return;
  }
  if (!('tagName' in node)) {
    if ('childNodes' in node) for (const c of node.childNodes) walk(c, out, o);
    return;
  }
  const rawTag = node.tagName;
  const tag = o.rename ? (RENAME[rawTag] ?? rawTag) : rawTag;
  if (DROP_WITH_CONTENT.has(rawTag)) return;
  const kids = (): void => {
    for (const c of node.childNodes) walk(c, out, o);
  };
  if (!(o.keepAttrs ? EDIT_TAGS : ALLOWED_TAGS).has(rawTag)) return kids(); // unwrap unknown elements, keep their text
  if (tag === 'br') {
    out.push('<br>');
    return;
  }
  let attrs = '';
  if (tag === 'a') {
    const href = node.attrs.find((a) => a.name === 'href');
    const clean = href ? cleanUrl(href.value) : null;
    if (clean) attrs = ` href="${escapeAttr(clean, '"')}"`;
  }
  if (o.keepAttrs) {
    attrs = editAttrs(node.attrs, tag);
    if (tag === 'span' && attrs === '') return kids();
  } else if (tag === 'span') {
    const st = o.keepSpanStyle ? cleanSpanStyle(node.attrs.find((a) => a.name === 'style')?.value ?? '') : '';
    if (!st) return kids(); // attribute-less spans are noise (TXT-06)
    attrs = ` style="${escapeAttr(st, '"')}"`;
  }
  out.push(`<${tag}${attrs}>`);
  kids();
  out.push(`</${tag}>`);
}

export function sanitizePastedHtml(html: string, o: Partial<Opts> = {}): string {
  if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
  const frag = parseFragment(html);
  const out: string[] = [];
  const opts: Opts = { keepSpanStyle: false, rename: false, keepAttrs: false, ...o };
  for (const c of frag.childNodes) walk(c, out, opts);
  return out.join('');
}

/** Clean markup produced by the editor's own text session: semantic tags, safe span styles (TXT-06). */
export function normalizeEditedHtml(html: string): string {
  return sanitizePastedHtml(html, { keepAttrs: true, keepSpanStyle: true });
}

/** True when an element's content is text plus simple inline formatting only (TXT-01): safe to edit inline. */
export function isSimpleInlineHtml(html: string): boolean {
  const ok = (n: Node): boolean => {
    if ('tagName' in n && !EDIT_TAGS.has(n.tagName)) return false;
    return !('childNodes' in n) || n.childNodes.every(ok);
  };
  return parseFragment(html).childNodes.every(ok);
}

/** Keep the source's named/numeric entities (`&mdash;`, `&nbsp;`, `&copy;`) for characters the editor re-serialized as literals. */
export function restoreEntities(sourceInner: string, edited: string): string {
  const map = new Map<string, string>();
  for (const m of sourceInner.matchAll(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi)) {
    const ent = m[0];
    if (/^&(amp|lt|gt|quot|apos);$/i.test(ent)) continue;
    const frag = parseFragment(ent).childNodes[0];
    const ch = frag && frag.nodeName === '#text' ? (frag as DefaultTreeAdapterMap['textNode']).value : '';
    if (ch.length > 0 && ch.length <= 2 && ch !== ent && !sourceInner.includes(ch)) map.set(ch, ent);
  }
  if (map.size === 0) return edited;
  return edited
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) return part;
      let out = part;
      for (const [ch, ent] of map) out = out.split(ch).join(ent);
      return out;
    })
    .join('');
}

/** Characters the file's encoding cannot hold are written as numeric references so nothing is lost. */
export function toEncodingSafe(html: string, encoding: 'utf-8' | 'windows-1252'): string {
  if (encoding === 'utf-8') return html;
  let out = '';
  for (const ch of html) {
    const cp = ch.codePointAt(0)!;
    out += cp < 0x80 || (cp >= 0xa0 && cp <= 0xff) || isCp1252(cp) ? ch : `&#x${cp.toString(16)};`;
  }
  return out;
}
const CP1252_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
const isCp1252 = (cp: number): boolean => CP1252_EXTRA.has(cp);

export function htmlToPlainText(html: string): string {
  return sanitizePastedHtml(html)
    .replace(/<br>/g, '\n')
    .replace(/<\/(p|li)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Element tag names inside an HTML fragment, in document order. Used to detect content the browser/scripts restructured. */
export function inlineTagSequence(html: string): string[] {
  const out: string[] = [];
  const walkTags = (n: Node): void => {
    if ('tagName' in n) out.push(n.tagName);
    if ('childNodes' in n) for (const c of n.childNodes) walkTags(c);
  };
  for (const c of parseFragment(html).childNodes) walkTags(c);
  return out;
}

const BLOCK_DROP = new Set(['script', 'iframe', 'object', 'embed', 'template', 'noscript', 'head', 'title', 'meta', 'link', 'base', 'form', 'input', 'button', 'textarea', 'select', 'math', 'frame', 'frameset', 'applet', 'html', 'body', 'style']);
const VOID = new Set(['br', 'hr', 'img', 'wbr', 'col']);
const BLOCK_ATTRS = new Set(['class', 'id', 'lang', 'dir', 'title', 'role', 'alt', 'width', 'height', 'colspan', 'rowspan', 'viewbox', 'fill', 'stroke', 'd', 'cx', 'cy', 'r', 'x', 'y', 'points', 'transform', 'xmlns']);

export interface BlockOpts {
  /** Keep scripts' absence but allow http(s) resources in src/href (AIS-04). */
  allowExternal?: boolean;
}

/** Allow-list sanitizer for block markup written by the AI or inserted from outside (AIT-03): no scripts, handlers, javascript: URLs or new remote resources. */
export function sanitizeBlockHtml(html: string, o: BlockOpts = {}): string {
  if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
  const out: string[] = [];
  const url = (v: string, img: boolean): string | null => {
    const c = v.replace(/[\u0000- \u007f-\u009f]/g, '');
    if (/^(data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i.test(c) && img) return v.trim();
    if (/^(mailto:|#)/i.test(c)) return v.trim();
    if (/^https?:/i.test(c)) return o.allowExternal ? v.trim() : null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(c)) return null; // javascript:, data:text/html, file:, ...
    return v.trim(); // relative path
  };
  const walkB = (node: Node): void => {
    if (node.nodeName === '#text') return void out.push(escapeText((node as DefaultTreeAdapterMap['textNode']).value));
    if (node.nodeName === '#comment') return;
    if (!('tagName' in node)) return void ('childNodes' in node && node.childNodes.forEach(walkB));
    const tag = node.tagName.toLowerCase();
    if (BLOCK_DROP.has(tag)) return;
    let attrs = '';
    for (const a of node.attrs) {
      const n = a.name.toLowerCase();
      let v: string | null = null;
      if (BLOCK_ATTRS.has(n) || /^aria-[a-z-]+$/.test(n) || /^data-(?!deckhand|ref)[a-z0-9-]+$/.test(n)) v = a.value;
      else if (n === 'href' && (tag === 'a')) v = url(a.value, false);
      else if (n === 'src' && tag === 'img') v = url(a.value, true);
      else if (n === 'style') {
        const keep: string[] = [];
        for (const part of a.value.split(';')) {
          const i = part.indexOf(':');
          if (i < 0) continue;
          const p = part.slice(0, i).trim().toLowerCase();
          const val = part.slice(i + 1).trim();
          const remote = /url\s*\(\s*['"]?\s*(https?:|\/\/)/i.test(val);
          if (isSafeCssProp(p) && isSafeCssValue(val) && !(remote && !o.allowExternal)) keep.push(`${p}: ${val}`);
        }
        v = keep.length ? keep.join('; ') : null;
      }
      if (v !== null) attrs += ` ${n}="${escapeAttr(v, '"')}"`;
    }
    if (VOID.has(tag)) return void out.push(`<${tag}${attrs}>`);
    out.push(`<${tag}${attrs}>`);
    const kids = tag === 'template' ? [] : node.childNodes;
    kids.forEach(walkB);
    out.push(`</${tag}>`);
  };
  parseFragment(html).childNodes.forEach(walkB);
  return out.join('');
}
