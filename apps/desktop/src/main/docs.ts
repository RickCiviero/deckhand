/** Document registry, file I/O and the `deckhand-doc://` protocol (SEC-02/03/04/05). */
import { app, net, protocol, type WebContents } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNoArtifacts, isInside, parseSource, renderLiveHtml, sanitizeRequestPath } from '@deckhand/core';
import agentTemplate from '../../../../packages/agent/dist/agent.js?raw';

export const DOC_SCHEME = 'deckhand-doc';
export const MAX_FILE = 64 * 1024 * 1024;

export interface Doc {
  id: string;
  host: string; // random, lowercase hex: the document's own origin
  file: string; // absolute path of the deck (renderer can never choose another write target)
  dir: string;
  realDir: string;
  owner: WebContents;
  text: string; // current source text (for live view)
  liveHtml: string;
  plainHtml: string;
  /** Single-use key on the iframe URL: only that one navigation receives the agent-injected page. */
  liveKey: string;
  remote: 'allow' | 'block';
  lastHash: string;
  watcher?: FSWatcher;
}

export const docs = new Map<string, Doc>();
const byHost = new Map<string, Doc>();

const hash = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const CI = process.platform === 'win32' || process.platform === 'darwin';

export function validateDeckPath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096 || p.includes('\0')) throw new Error('Invalid path');
  if (!path.isAbsolute(p)) throw new Error('Path must be absolute');
  if (/^\\\\/.test(p) && !/^\\\\\?\\[a-z]:/i.test(p)) throw new Error('Network (UNC) paths are not supported'); // avoids NTLM credential leaks
  if (!/\.html?$/i.test(p)) throw new Error('Only .html/.htm files can be opened');
  return path.resolve(p);
}

export async function loadFromDisk(file: string): Promise<{ bytes: Uint8Array; realFile: string }> {
  const real = await fs.realpath(file);
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > MAX_FILE) throw new Error('File is too large (limit 64 MB)');
  return { bytes: new Uint8Array(await fs.readFile(real)), realFile: real };
}

export function buildLive(doc: Doc, text: string): { token: string; key: string } {
  const { token, html } = (() => {
    const t = randomBytes(16).toString('hex');
    const agent = agentTemplate.replace('__DECKHAND_TOKEN_PLACEHOLDER__', JSON.stringify(t));
    // `text` is already decoded: never run it through the byte decoder again (that double-decodes windows-1252 decks)
    return { token: t, html: renderLiveHtml(parseSource(text, { encoding: 'utf-8', bom: false, eol: 'none' }), agent) };
  })();
  doc.text = text;
  doc.plainHtml = text;
  doc.liveHtml = html;
  doc.liveKey = randomBytes(12).toString('hex');
  return { token, key: doc.liveKey };
}

export async function createDoc(owner: WebContents, file: string, bytes: Uint8Array): Promise<Doc> {
  const dir = path.dirname(file);
  const id = randomBytes(8).toString('hex');
  const doc: Doc = {
    id, host: randomBytes(12).toString('hex'), file, dir, realDir: await fs.realpath(dir), owner,
    text: '', liveHtml: '', plainHtml: '', liveKey: '', remote: 'allow', lastHash: hash(bytes),
  };
  docs.set(id, doc);
  byHost.set(doc.host, doc);
  return doc;
}

export function closeDoc(doc: Doc): void {
  doc.watcher?.close();
  docs.delete(doc.id);
  byHost.delete(doc.host);
}

/** Atomic save: temp file in the same folder, flush, rename; falls back to in-place write after a backup (RT-07). */
export async function saveDoc(doc: Doc, bytes: Uint8Array): Promise<void> {
  if (bytes.length > MAX_FILE) throw new Error('File too large');
  assertNoArtifacts(Buffer.from(bytes).toString('latin1'));
  const mode = await fs.stat(doc.file).then((s) => s.mode & 0o777).catch(() => 0o644);
  const tmp = path.join(doc.dir, `.${path.basename(doc.file)}.${randomBytes(4).toString('hex')}.tmp`);
  doc.lastHash = hash(bytes); // set first so our own write is not reported as an external change
  try {
    const fh = await fs.open(tmp, 'w', mode);
    try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); }
    await fs.rename(tmp, doc.file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // network / synced folders where rename fails: backup then write in place
    const backup = path.join(app.getPath('userData'), 'backups', `${hash(doc.file).slice(0, 12)}-${Date.now()}.html`);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(doc.file, backup).catch(() => undefined);
    await fs.writeFile(doc.file, bytes);
    void e;
  }
}

export function watchDoc(doc: Doc, onExternal: () => void): void {
  let timer: NodeJS.Timeout | undefined;
  try {
    doc.watcher = watch(doc.file, { persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const b = await fs.readFile(doc.file);
          if (hash(b) !== doc.lastHash) onExternal();
        } catch { /* file removed or locked; ignore */ }
      }, 300);
    });
  } catch { /* unsupported FS */ }
}

export function markHash(doc: Doc, bytes: Uint8Array): void { doc.lastHash = hash(bytes); }

// ---- AutoRecover (AUTO-01/02): stored in app data, never next to the user's file ---------------------------------
const recoveryDir = (): string => path.join(app.getPath('userData'), 'recovery');
export async function writeRecovery(doc: Doc, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(recoveryDir(), { recursive: true });
  const key = hash(doc.file).slice(0, 16);
  await fs.writeFile(path.join(recoveryDir(), `${key}.html`), bytes);
  await fs.writeFile(path.join(recoveryDir(), `${key}.json`), JSON.stringify({ file: doc.file, time: Date.now() }));
}
export async function clearRecovery(doc: Doc): Promise<void> {
  const key = hash(doc.file).slice(0, 16);
  await Promise.all([`${key}.html`, `${key}.json`].map((f) => fs.rm(path.join(recoveryDir(), f), { force: true })));
}
export async function listRecovery(): Promise<{ key: string; file: string; time: number }[]> {
  try {
    const names = (await fs.readdir(recoveryDir())).filter((n) => /^[0-9a-f]{16}\.json$/.test(n));
    const out = [];
    for (const n of names) {
      try {
        const m = JSON.parse(await fs.readFile(path.join(recoveryDir(), n), 'utf8')) as { file: string; time: number };
        out.push({ key: n.slice(0, 16), file: String(m.file), time: Number(m.time) });
      } catch { /* skip corrupt */ }
    }
    return out;
  } catch { return []; }
}
export async function readRecovery(key: string): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{16}$/.test(key)) return null;
  try { return new Uint8Array(await fs.readFile(path.join(recoveryDir(), `${key}.html`))); } catch { return null; }
}
export async function discardRecovery(key: string): Promise<void> {
  if (!/^[0-9a-f]{16}$/.test(key)) return;
  await Promise.all([`${key}.html`, `${key}.json`].map((f) => fs.rm(path.join(recoveryDir(), f), { force: true })));
}

// ---- protocol -----------------------------------------------------------------------------------------------------
export interface BlockEvent { docId: string; kind: 'outside-folder'; url: string }
let onBlocked: (doc: Doc, ev: BlockEvent) => void = () => undefined;
export const setBlockedHandler = (fn: typeof onBlocked): void => { onBlocked = fn; };

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};
const deny = (status: number, why: string): Response => new Response(why, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain' } });

export function registerDocProtocol(): void {
  protocol.handle(DOC_SCHEME, async (req) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'Method not allowed');
      const url = new URL(req.url);
      const doc = byHost.get(url.hostname);
      if (!doc) return deny(404, 'Unknown document');
      const rel = sanitizeRequestPath(url.pathname);
      if (rel === null) return deny(403, 'Blocked path');

      const isDeck = rel === '' || rel === path.basename(doc.file);
      if (isDeck) {
        // Only the one navigation that presents the single-use key gets the agent; a deck fetching its own page sees plain source.
        const live = doc.liveKey !== '' && url.searchParams.get('k') === doc.liveKey;
        if (live) doc.liveKey = '';
        const body = live ? doc.liveHtml : doc.plainHtml;
        return new Response(body, { headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
      }

      const target = path.resolve(doc.dir, ...rel.split('/'));
      let real: string;
      try { real = await fs.realpath(target); } catch { return deny(404, 'Not found'); }
      if (!isInside(doc.realDir, real, path.sep, CI)) {
        onBlocked(doc, { docId: doc.id, kind: 'outside-folder', url: rel.slice(0, 200) });
        return deny(403, 'Outside the presentation folder');
      }
      const st = await fs.stat(real);
      if (!st.isFile()) return deny(404, 'Not found');
      const r = await net.fetch(pathToFileURL(real).toString(), { headers: req.headers, bypassCustomProtocolHandlers: true });
      const headers = new Headers(r.headers);
      for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
      headers.set('Access-Control-Allow-Origin', '*'); // fonts need CORS; the content is already inside the doc's own folder
      return new Response(r.body, { status: r.status, headers });
    } catch {
      return deny(500, 'Error');
    }
  });
}

export const docForHost = (host: string): Doc | undefined => byHost.get(host);
