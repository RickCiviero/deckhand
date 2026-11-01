/** AI view of the HTML (AIX-03): object refs, asset placeholders, elided scripts. Generated, never saved (RT-05). */
import { applyPatches, type ElementInfo, type Patch, type SourceDoc } from '@deckhand/core';

export interface AssetInfo { id: string; type: string; bytes: number }

const refOf = (id: number): string => `o${id}`;
export const parseRef = (ref: string): number | null => (/^o(\d+)$/.exec(ref.trim()) ? Number(ref.trim().slice(1)) : null);

/** Source of `root` with `data-ref` on every element, data: URIs replaced by `asset:img-N`, script bodies elided. */
export function toAiView(doc: SourceDoc, root: ElementInfo, assets: Map<string, string>, info: AssetInfo[] = []): string {
  const patches: Patch[] = [];
  for (const el of doc.elements) {
    if (el.start < root.start || el.end > root.end) continue;
    let pos = el.startTagEnd - 1;
    if (doc.text[pos - 1] === '/') pos -= 1;
    if (el.startTagEnd > el.start) patches.push({ start: pos, end: pos, text: ` data-ref="${refOf(el.id)}"` });
    for (const a of el.attrs) {
      if (!/^\s*data:/i.test(a.value)) continue;
      const key = [...assets].find(([, v]) => v === a.value)?.[0] ?? `img-${assets.size + 1}`;
      assets.set(key, a.value);
      info.push({ id: `asset:${key}`, type: /^data:([^;,]*)/i.exec(a.value)?.[1] ?? 'unknown', bytes: a.value.length });
      patches.push({ start: a.start, end: a.end, text: `${a.name}="asset:${key}"` });
    }
    if (el.tag === 'script' && el.endTagStart !== null && el.endTagStart > el.startTagEnd) {
      patches.push({ start: el.startTagEnd, end: el.endTagStart, text: `/* script elided (${el.endTagStart - el.startTagEnd} chars) */` });
    }
  }
  return applyOn(doc.text.slice(root.start, root.end), patches, root.start);
}

function applyOn(slice: string, patches: Patch[], base: number): string {
  return applyPatches(slice, patches.map((p) => ({ ...p, start: p.start - base, end: p.end - base })));
}

/** Put real data: URIs back where the model wrote `asset:img-N` (so placeholders never reach the file). */
export function resolveAssets(html: string, assets: Map<string, string>): string {
  return html.replace(/asset:(img-\d+)/g, (m, k: string) => assets.get(k) ?? m);
}
