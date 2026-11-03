/** Export a self-contained HTML file: everything the deck links locally is written into it (single-file export). */
import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inlineAssets, isInside, mimeOf } from '@deckhand/core';
import type { Doc } from './docs.js';

const ONE = 25 * 1024 * 1024;
const ALL = 128 * 1024 * 1024;

export async function exportSingleFile(parent: BrowserWindow, doc: Doc, text: string): Promise<{ file: string; inlined: number; missing: string[] } | null> {
  const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(doc.dir, path.basename(doc.file).replace(/\.html?$/i, '') + '-single.html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (r.canceled || !r.filePath) return null;
  // read everything first (the inliner is synchronous): every file under the deck's folder that the page mentions
  const cache = new Map<string, { mime: string; bytes: Uint8Array } | null>();
  let total = 0;
  const wanted = new Set<string>();
  const probe = (rel: string): null => { wanted.add(rel); return null; };
  inlineAssets(text, probe);
  for (let pass = 0; pass < 6 && wanted.size; pass++) {
    const batch = [...wanted].filter((p) => !cache.has(p));
    if (!batch.length) break;
    for (const rel of batch) {
      const full = path.resolve(doc.realDir, rel);
      let asset: { mime: string; bytes: Uint8Array } | null = null;
      try {
        const real = await fs.realpath(full);
        const st = await fs.stat(real);
        if (st.isFile() && st.size <= ONE && total + st.size <= ALL && isInside(doc.realDir, real, path.sep, process.platform === 'win32' || process.platform === 'darwin')) {
          asset = { mime: mimeOf(rel), bytes: new Uint8Array(await fs.readFile(real)) };
          total += st.size;
        }
      } catch { /* missing */ }
      cache.set(rel, asset);
    }
    // stylesheets can name more files: look again with what is known
    wanted.clear();
    inlineAssets(text, (p) => { if (!cache.has(p)) wanted.add(p); return cache.get(p) ?? null; });
  }
  const res = inlineAssets(text, (p) => cache.get(p) ?? null);
  // the file is written as UTF-8: a deck that declared another character set must say so
  await fs.writeFile(r.filePath, res.text.replace(/(<meta\s+charset\s*=\s*["']?)(?!utf-8)[\w-]+/i, '$1utf-8'), 'utf8');
  return { file: r.filePath, inlined: res.inlined, missing: [...new Set(res.missing)] };
}
