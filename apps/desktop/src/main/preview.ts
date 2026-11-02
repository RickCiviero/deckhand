/** Preview in Browser (SHOW-03): the current in-memory deck served on 127.0.0.1 to the default browser.
 *  Random port + unguessable path token; only the deck page and files inside the deck's own folder are served; stops when the document closes, after 30 idle minutes, or at quit. */
import { net, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isInside, sanitizeRequestPath } from '@deckhand/core';
import type { Doc } from './docs.js';

const IDLE_MS = 30 * 60 * 1000;
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const servers = new Map<string, { server: http.Server; url: string; timer: NodeJS.Timeout }>();

export function stopPreview(docId: string): void {
  const s = servers.get(docId);
  if (!s) return;
  clearTimeout(s.timer);
  s.server.close();
  s.server.closeAllConnections();
  servers.delete(docId);
}
export const stopAllPreviews = (): void => { for (const id of [...servers.keys()]) stopPreview(id); };

const open = async (url: string): Promise<void> => { if (!process.env['DECKHAND_NO_BROWSER']) await shell.openExternal(url); }; // tests read the address instead of launching a browser

export async function previewInBrowser(doc: Doc): Promise<string> {
  const existing = servers.get(doc.id);
  if (existing) { await open(existing.url); return existing.url; }
  const token = randomBytes(16).toString('hex');
  const deckName = path.basename(doc.file);
  const reply = (res: http.ServerResponse, code: number, body: string | Buffer, type = 'text/plain; charset=utf-8'): void => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(body);
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const s = servers.get(doc.id);
        if (s) { clearTimeout(s.timer); s.timer = setTimeout(() => stopPreview(doc.id), IDLE_MS); }
        const port = (server.address() as { port: number }).port;
        // a page on another origin could aim a DNS-rebinding request at this port; only our own host name passes
        if (req.headers.host !== `127.0.0.1:${port}`) return reply(res, 403, 'Forbidden');
        if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
        const prefix = `/${token}/`;
        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        if (!pathname.startsWith(prefix)) return reply(res, 404, 'Not found');
        const rel = sanitizeRequestPath(pathname.slice(prefix.length - 1));
        if (rel === null) return reply(res, 403, 'Blocked path');
        if (rel === '' || rel === deckName) return reply(res, 200, doc.plainHtml, 'text/html; charset=utf-8');
        let real: string;
        try { real = await fs.realpath(path.resolve(doc.dir, ...rel.split('/'))); } catch { return reply(res, 404, 'Not found'); }
        if (!isInside(doc.realDir, real, path.sep, CASE_INSENSITIVE)) return reply(res, 403, 'Outside the presentation folder');
        if (!(await fs.stat(real)).isFile()) return reply(res, 404, 'Not found');
        const r = await net.fetch(pathToFileURL(real).toString(), { bypassCustomProtocolHandlers: true });
        reply(res, 200, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') ?? 'application/octet-stream');
      } catch { reply(res, 500, 'Error'); }
    })();
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/${token}/${encodeURIComponent(deckName)}`;
  servers.set(doc.id, { server, url, timer: setTimeout(() => stopPreview(doc.id), IDLE_MS) });
  await open(url);
  return url;
}
