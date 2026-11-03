/** Single-file export: every local file the deck refers to (pictures, styles, scripts, fonts, media) is written into the HTML itself, so the file can be sent on its own. */
import { applyPatches, type Patch } from './patch.js';
import { getAttr, parseSource, setAttrPatch, type ElementInfo, type SourceDoc } from './source.js';

export interface Asset { mime: string; bytes: Uint8Array }
/** Returns the file for a path relative to the deck's folder, or null when it is missing or not allowed (outside the folder, too big). */
export type AssetReader = (relPath: string) => Asset | null;

export interface InlineResult { text: string; inlined: number; missing: string[] }

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
};
export const mimeOf = (name: string): string => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

const isLocal = (u: string): boolean => u.length > 0 && !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(u);
const clean = (u: string): string => { try { return decodeURIComponent(u.split(/[?#]/)[0]!); } catch { return u.split(/[?#]/)[0]!; } };
const b64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const dataUri = (a: Asset): string => `data:${a.mime};base64,${b64(a.bytes)}`;
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);
const join = (base: string, rel: string): string => {
  const parts = base.split('/').slice(0, -1);
  for (const p of rel.split('/')) { if (p === '..') parts.pop(); else if (p !== '.' && p !== '') parts.push(p); }
  return parts.join('/');
};

/** `url(...)` references inside CSS text, resolved against the folder of the file the CSS came from. */
function inlineCssUrls(css: string, base: string, read: AssetReader, res: InlineResult, depth: number): string {
  return css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (m, _q: string, u: string) => {
    if (!isLocal(u.trim())) return m;
    const path = join(base, clean(u.trim()));
    const a = read(path);
    if (!a) { res.missing.push(path); return m; }
    res.inlined++;
    return `url("${dataUri(a)}")`;
  }).replace(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*;/gi, (m, _q: string, u: string) => {
    if (!isLocal(u) || depth > 4) return m;
    const path = join(base, clean(u));
    const a = read(path);
    if (!a) { res.missing.push(path); return m; }
    res.inlined++;
    return inlineCssUrls(decode(a.bytes), path, read, res, depth + 1);
  });
}

const URL_ATTRS: Record<string, string[]> = { img: ['src'], source: ['src'], video: ['src', 'poster'], audio: ['src'], embed: ['src'], object: ['data'], image: ['href', 'xlink:href'], input: ['src'] };

export function inlineAssets(text: string, read: AssetReader, baseFile = 'index.html'): InlineResult {
  const doc: SourceDoc = parseSource(text, { encoding: 'utf-8', bom: false, eol: 'none' });
  const res: InlineResult = { text, inlined: 0, missing: [] };
  const patches: Patch[] = [];
  const fileOf = (u: string): { path: string; asset: Asset | null } | null => {
    if (!isLocal(u.trim())) return null;
    const path = join(baseFile, clean(u.trim()));
    const asset = read(path);
    if (!asset) res.missing.push(path);
    return { path, asset };
  };
  for (const e of doc.elements as ElementInfo[]) {
    if (e.tag === 'link' && /stylesheet/i.test(getAttr(e, 'rel') ?? '')) {
      const f = fileOf(getAttr(e, 'href') ?? '');
      if (f?.asset) { res.inlined++; patches.push({ start: e.start, end: e.end, text: `<style>\n${inlineCssUrls(decode(f.asset.bytes), f.path, read, res, 0).replace(/<\/style/gi, '<\\/style')}\n</style>` }); }
    } else if (e.tag === 'script' && getAttr(e, 'src') !== undefined && e.endTagStart !== null) {
      const f = fileOf(getAttr(e, 'src') ?? '');
      if (f?.asset) { res.inlined++; patches.push({ start: e.start, end: e.end, text: `<script${/type\s*=\s*["']module["']/i.test(doc.text.slice(e.start, e.startTagEnd)) ? ' type="module"' : ''}>\n${decode(f.asset.bytes).replace(/<\/script/gi, '<\\/script')}\n</script>` }); }
    } else if (e.tag === 'style' && e.endTagStart !== null) {
      const css = doc.text.slice(e.startTagEnd, e.endTagStart);
      const next = inlineCssUrls(css, baseFile, read, res, 0);
      if (next !== css) patches.push({ start: e.startTagEnd, end: e.endTagStart, text: next });
    } else {
      for (const name of URL_ATTRS[e.tag] ?? []) {
        const v = getAttr(e, name);
        const f = v === undefined ? null : fileOf(v);
        if (f?.asset) { res.inlined++; patches.push(setAttrPatch(doc, e, name, dataUri(f.asset))); }
      }
    }
    const st = getAttr(e, 'style');
    if (st && /url\(/i.test(st)) {
      const next = inlineCssUrls(st, baseFile, read, res, 0);
      if (next !== st) patches.push(setAttrPatch(doc, e, 'style', next));
    }
  }
  // patches of nested elements (a style attribute on an element replaced as a whole) must not overlap: keep the outermost
  const sorted = patches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Patch[] = [];
  for (const p of sorted) if (!kept.some((k) => p.start < k.end && p.end > k.start)) kept.push(p);
  res.text = applyPatches(text, kept);
  return res;
}
