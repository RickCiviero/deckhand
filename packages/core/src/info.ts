/** File > Info facts derived from the source (SEC-05: every external domain the deck uses). */
import type { SourceDoc } from './source.js';

const URL_RE = /(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\[[0-9a-f:]+\]|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?=[/"'\s)?#>]|$)/gi;

/** Hosts of http(s)/protocol-relative URLs in `src`, `href`, `srcset`, `poster`, `data-*` URLs and CSS `url()` / `@import`, sorted. Plain links to other sites (`<a href>`) are included: they are still external. */
export function externalDomains(doc: SourceDoc): string[] {
  const hosts = new Set<string>();
  const add = (v: string): void => {
    for (const m of v.matchAll(URL_RE)) if (/^(https?:)?\/\//i.test(m[0])) hosts.add(m[1]!.toLowerCase());
  };
  for (const el of doc.elements) {
    for (const a of el.attrs) if (/^(src|href|srcset|poster|data-src|data-background-image|style|action|content)$/i.test(a.name)) add(a.value);
    if (el.tag === 'style' && el.endTagStart !== null) add(doc.text.slice(el.startTagEnd, el.endTagStart));
  }
  hosts.delete('www.w3.org'); // namespace declarations, not requests
  return [...hosts].sort();
}
