/** AI host (§10.11): connections, credentials and every AI network call live here; keys never reach the renderer (AIC-08, AIS-07). */
import { app, ipcMain, net, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { anthropicProvider, openAiProvider, type Provider } from '@deckhand/ai';

const kindSchema = z.enum(['anthropic', 'openai', 'compatible']);
const connSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
  name: z.string().min(1).max(80),
  kind: kindSchema,
  baseUrl: z.string().max(300),
  model: z.string().min(1).max(120),
  key: z.string().max(500).optional(),
});
interface Stored { id: string; name: string; kind: z.infer<typeof kindSchema>; baseUrl: string; model: string; key: string | null }

const file = (): string => path.join(app.getPath('userData'), 'ai-connections.json');
async function load(): Promise<Stored[]> {
  try { return JSON.parse(await fs.readFile(file(), 'utf8')) as Stored[]; } catch { return []; }
}
const store = (list: Stored[]): Promise<void> => fs.writeFile(file(), JSON.stringify(list, null, 2), { mode: 0o600 });
const publicView = (list: Stored[]) => list.map((c) => ({ id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, model: c.model, hasKey: c.key !== null }));

/** Keys only ever travel over TLS; cleartext is allowed for this computer's own servers (Ollama, LM Studio). */
export function checkBaseUrl(raw: string): string {
  const u = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('The address must start with https:// (http:// is only allowed for this computer).');
  if (u.username || u.password) throw new Error('Do not put credentials in the address.');
  return u.toString().replace(/\/+$/, '');
}

function provider(c: Stored, signal?: AbortSignal): Provider {
  void signal;
  const apiKey = c.key ? safeStorage.decryptString(Buffer.from(c.key, 'base64')) : undefined;
  const cfg = { baseUrl: c.baseUrl, apiKey, model: c.model, fetch: ((url: string, init: RequestInit) => net.fetch(url, init)) as typeof fetch }; // net.fetch honours the system proxy (PLT-10)
  return c.kind === 'anthropic' ? anthropicProvider(cfg) : openAiProvider(cfg);
}

const msgSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({ role: z.literal('assistant'), content: z.string(), toolCalls: z.array(z.object({ id: z.string().max(200), name: z.string().max(80), args: z.unknown() })).optional() }),
  z.object({ role: z.literal('tool'), id: z.string().max(200), name: z.string().max(80), content: z.string() }),
]);
const reqSchema = z.object({
  connId: z.string(),
  system: z.string().max(100_000),
  messages: z.array(msgSchema).max(500),
  tools: z.array(z.object({ name: z.string().max(80), description: z.string().max(2000), parameters: z.record(z.string(), z.unknown()) })).max(60),
});

export function registerAi(check: (e: IpcMainInvokeEvent) => void): void {
  const streams = new Map<string, AbortController>();

  ipcMain.handle('ai:list', async (e) => { check(e); return { list: publicView(await load()), secure: safeStorage.isEncryptionAvailable() }; });

  ipcMain.handle('ai:save', async (e, a: unknown) => {
    check(e);
    const c = connSchema.parse(a);
    const baseUrl = checkBaseUrl(c.baseUrl);
    const list = await load();
    const old = list.find((x) => x.id === c.id);
    let key = old?.key ?? null;
    if (c.key !== undefined) {
      if (c.key === '') key = null;
      else if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer can't store keys securely, so Deckhand won't save one.");
      else key = safeStorage.encryptString(c.key).toString('base64');
    }
    const next: Stored = { id: old?.id ?? randomUUID(), name: c.name, kind: c.kind, baseUrl, model: c.model, key };
    await store(old ? list.map((x) => (x.id === old.id ? next : x)) : [...list, next]);
    return publicView(await load());
  });

  ipcMain.handle('ai:remove', async (e, id: unknown) => {
    check(e);
    const i = z.string().parse(id);
    await store((await load()).filter((x) => x.id !== i));
    return publicView(await load());
  });

  ipcMain.handle('ai:stream', async (e, a: unknown) => {
    check(e);
    const req = reqSchema.parse(a);
    if (JSON.stringify(req).length > 8_000_000) throw new Error('The request is too large.');
    const conn = (await load()).find((c) => c.id === req.connId);
    if (!conn) throw new Error('Unknown connection.');
    const streamId = randomUUID();
    const ac = new AbortController();
    streams.set(streamId, ac);
    const wc = e.sender;
    const send = (m: object): void => { if (!wc.isDestroyed()) wc.send('ai-chunk', { streamId, ...m }); };
    void (async () => {
      try {
        for await (const chunk of provider(conn).stream({ system: req.system, messages: req.messages as never, tools: req.tools as never, signal: ac.signal })) send({ chunk });
        send({ end: true });
      } catch (err) {
        send(ac.signal.aborted ? { end: true } : { error: (err as Error).message });
      } finally { streams.delete(streamId); }
    })();
    return streamId;
  });

  ipcMain.handle('ai:cancel', (e, id: unknown) => { check(e); streams.get(z.string().parse(id))?.abort(); return true; });

  ipcMain.handle('ai:test', async (e, id: unknown) => {
    check(e);
    const conn = (await load()).find((c) => c.id === z.string().parse(id));
    if (!conn) throw new Error('Unknown connection.');
    try {
      for await (const c of provider(conn).stream({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], tools: [] })) if (c.type === 'done') break;
      return { ok: true };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  });
}
