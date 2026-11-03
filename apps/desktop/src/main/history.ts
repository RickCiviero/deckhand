/** Version History: every save keeps the file as it was before, in the app's own folder (never next to the deck). Newest 30 versions per file, 200 MB in all. */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const KEEP = 30;
const MAX_TOTAL = 200 * 1024 * 1024;

const dirOf = (file: string): string => {
  const key = createHash('sha256').update(process.platform === 'win32' || process.platform === 'darwin' ? file.toLowerCase() : file).digest('hex').slice(0, 20);
  return path.join(app.getPath('userData'), 'history', key);
};

export interface Version { id: string; time: number; size: number }

export async function listVersions(file: string): Promise<Version[]> {
  const dir = dirOf(file);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: Version[] = [];
  for (const n of names) {
    const m = /^(\d{10,16})\.html$/.exec(n);
    if (!m) continue;
    const st = await fs.stat(path.join(dir, n)).catch(() => null);
    if (st) out.push({ id: m[1]!, time: Number(m[1]), size: st.size });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** Keep `previous` (the file's content before this save), unless it is what the newest version already holds. */
export async function keepVersion(file: string, previous: Uint8Array, next: Uint8Array): Promise<void> {
  if (Buffer.compare(Buffer.from(previous), Buffer.from(next)) === 0) return;
  const dir = dirOf(file);
  await fs.mkdir(dir, { recursive: true });
  const have = await listVersions(file);
  const newest = have[0];
  if (newest) {
    const last = await fs.readFile(path.join(dir, `${newest.id}.html`)).catch(() => null);
    if (last && Buffer.compare(last, Buffer.from(previous)) === 0) return;
  }
  let id = Date.now();
  if (newest && id <= newest.time) id = newest.time + 1;
  await fs.writeFile(path.join(dir, `${id}.html`), previous);
  const all = await listVersions(file);
  let total = 0;
  for (const [i, v] of all.entries()) {
    total += v.size;
    if (i >= KEEP || total > MAX_TOTAL) await fs.rm(path.join(dir, `${v.id}.html`), { force: true });
  }
}

export async function readVersion(file: string, id: string): Promise<Uint8Array> {
  if (!/^\d{10,16}$/.test(id)) throw new Error('Unknown version');
  return new Uint8Array(await fs.readFile(path.join(dirOf(file), `${id}.html`)));
}
