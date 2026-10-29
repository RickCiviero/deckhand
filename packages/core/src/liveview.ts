/** Generates the HTML served to the live view: editor ids + agent injected, never written to disk (ARCH-03, RT-05). */
import type { SourceDoc } from './source.js';
import type { Patch } from './patch.js';
import { applyPatches } from './patch.js';

export const ID_ATTR = 'data-deckhand-id';
/** `agentSrc` already has its handshake token baked in; it is never exposed as an attribute. */
export function renderLiveHtml(doc: SourceDoc, agentSrc: string): string {
  const patches: Patch[] = [];
  for (const el of doc.elements) {
    if (['html', 'head', 'body'].includes(el.tag) && el.startTagEnd === el.end) continue;
    const nameEnd = el.start + 1 + el.tag.length;
    patches.push({ start: nameEnd, end: nameEnd, text: ` ${ID_ATTR}="${el.id}"` });
  }
  const head = doc.elements.find((e) => e.tag === 'head');
  const agent = `<script data-deckhand-agent>${agentSrc.replace(/<\/script/gi, '<\\/script')}</script>`;
  if (head && head.startTagEnd > head.start) {
    patches.push({ start: head.startTagEnd, end: head.startTagEnd, text: agent });
  } else {
    patches.push({ start: 0, end: 0, text: `<!doctype html><head>${agent}</head>` });
  }
  return applyPatches(doc.text, patches);
}

/** RT-05: throws if text about to be saved contains editor artifacts. */
export function assertNoArtifacts(text: string): void {
  if (/data-deckhand-(id|agent)\b/.test(text)) throw new Error('Editor artifact leaked into saved file (RT-05)');
  if (/\bcontenteditable\b[^>]*data-deckhand/i.test(text)) throw new Error('Editor artifact leaked into saved file (RT-05)');
}
