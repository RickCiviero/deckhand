import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, net, Menu, type WebContents, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { isInside, sanitizeRequestPath } from '@deckhand/core';
import { registerAi } from './ai.js';
import { exportPdf, startShow } from './show.js';
import {
  DOC_SCHEME, MAX_FILE, buildLive, clearRecovery, closeDoc, createDoc, discardRecovery, docs, listRecovery, loadFromDisk, markHash,
  readRecovery, registerDocProtocol, saveDoc, setBlockedHandler, validateDeckPath, watchDoc, writeRecovery, type Doc,
} from './docs.js';

const APP_SCHEME = 'deckhand-app';
const DEV_URL = process.env['ELECTRON_RENDERER_URL'];
const isDev = !!DEV_URL && !app.isPackaged;

protocol.registerSchemesAsPrivileged([
  { scheme: DOC_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---- strict CSP for the editor UI (SEC-07) -------------------------------------------------------------------------
const UI_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  `frame-src ${DOC_SCHEME}:`, "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
const DEV_CSP = UI_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", `connect-src 'self' ws://localhost:* http://localhost:*`);

// ---- window bookkeeping ----------------------------------------------------------------------------------------------
interface Win { win: BrowserWindow; doc: Doc | null; dirty: boolean; closing: boolean }
const wins = new Map<number, Win>(); // key: webContents.id

function appOriginOk(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === `${APP_SCHEME}:` && u.host === 'ui') return true;
    return isDev && DEV_URL !== undefined && u.origin === new URL(DEV_URL).origin;
  } catch { return false; }
}

/** SEC-01/08: IPC only from the top frame of one of our editor windows, never from a deck frame. */
function senderWin(e: IpcMainInvokeEvent): Win {
  const w = wins.get(e.sender.id);
  const f = e.senderFrame;
  if (!w || !f || f !== e.sender.mainFrame || !appOriginOk(f.url)) throw new Error('Untrusted IPC sender');
  return w;
}
function ownedDoc(e: IpcMainInvokeEvent, docId: string): Doc {
  const w = senderWin(e);
  const d = docs.get(docId);
  if (!d || w.doc !== d) throw new Error('Unknown document');
  return d;
}

const bytesSchema = z.instanceof(Uint8Array).refine((b) => b.length <= MAX_FILE, 'too large');
const idSchema = z.string().regex(/^[0-9a-f]{16}$/);

function createWindow(): Win {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#1f1f1f', title: 'Deckhand',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true, spellcheck: false,
    },
  });
  const w: Win = { win, doc: null, dirty: false, closing: false };
  const id = win.webContents.id;
  wins.set(id, w);
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!w.dirty || w.closing) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: `Do you want to save changes to '${w.doc ? path.basename(w.doc.file) : 'this presentation'}'?`,
    });
    if (r === 0) win.webContents.send('cmd', 'save-then-close');
    else if (r === 1) { w.closing = true; win.close(); }
  });
  win.on('closed', () => {
    if (w.doc) closeDoc(w.doc);
    wins.delete(id);
  });
  if (isDev && DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL(`${APP_SCHEME}://ui/index.html`);
  return w;
}

async function openInWindow(file: string, slide?: number): Promise<void> {
  // already open → focus
  for (const w of wins.values()) if (w.doc && w.doc.file.toLowerCase() === file.toLowerCase()) { w.win.focus(); return; }
  const w = [...wins.values()].find((x) => !x.doc && !x.win.isDestroyed()) ?? createWindow();
  const send = async (): Promise<void> => { try { w.win.webContents.send('open-request', { file, slide }); } catch { /* window gone */ } };
  if (w.win.webContents.isLoading()) w.win.webContents.once('did-finish-load', () => void send()); else await send();
}

function hardenSession(): void {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  s.setPermissionCheckHandler(() => false);
  s.setDevicePermissionHandler(() => false);
  s.on('will-download', (e) => e.preventDefault());
  s.webRequest.onHeadersReceived((details, cb) => {
    const h = details.responseHeaders ?? {};
    if (details.resourceType === 'mainFrame' && appOriginOk(details.url)) h['Content-Security-Policy'] = [isDev ? DEV_CSP : UI_CSP];
    cb({ responseHeaders: h });
  });
  s.webRequest.onBeforeRequest((details, cb) => {
    // Identify the requesting frame directly: decks are served with Referrer-Policy: no-referrer, so the referrer is not reliable.
    const frameUrl = details.frame?.url || details.referrer || '';
    const fromDeck = frameUrl.startsWith(`${DOC_SCHEME}://`) || details.url.startsWith(`${DOC_SCHEME}://`);
    if (!fromDeck) return cb({});
    const u = details.url;
    if (u.startsWith('file:') || u.startsWith('ftp:')) return cb({ cancel: true });
    if (/^https?:|^wss?:/i.test(u)) {
      const host = /^deckhand-doc:\/\/([0-9a-f]+)/.exec(frameUrl)?.[1];
      const doc = [...docs.values()].find((d) => d.host === host);
      if (doc && doc.remote === 'block') return cb({ cancel: true });
    }
    cb({});
  });
}

/** SEC-04: deck content can never navigate, open windows or attach webviews. */
function hardenContents(wc: WebContents): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('will-navigate', (e) => { if (!appOriginOk(e.url)) e.preventDefault(); else if (!isDev) e.preventDefault(); });
  wc.on('will-frame-navigate', (e) => {
    // iframes may only (re)load their own document origin
    try {
      const u = new URL(e.url);
      if (u.protocol === `${DOC_SCHEME}:` && [...docs.values()].some((d) => d.host === u.hostname)) return;
    } catch { /* fallthrough */ }
    if (e.frame === wc.mainFrame && appOriginOk(e.url) && isDev) return;
    e.preventDefault();
  });
  wc.on('will-redirect', (e) => { if (!e.isMainFrame) e.preventDefault(); });
}

app.on('web-contents-created', (_e, wc) => hardenContents(wc));
app.on('web-contents-created', (_e, wc) => wc.on('before-input-event', (ev, input) => {
  // no DevTools in packaged builds
  if (app.isPackaged && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) ev.preventDefault();
}));

function registerAppProtocol(): void {
  const root = path.join(__dirname, '../renderer');
  const realRoot = require('node:fs').realpathSync(root) as string;
  const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
  protocol.handle(APP_SCHEME, async (req) => {
    const url = new URL(req.url);
    if (url.hostname !== 'ui') return new Response('Not found', { status: 404 });
    const rel = sanitizeRequestPath(url.pathname) || 'index.html';
    try {
      const real = await fs.realpath(path.join(root, ...rel.split('/')));
      if (!isInside(realRoot, real, path.sep, process.platform !== 'linux')) return new Response('Forbidden', { status: 403 });
      const r = await net.fetch(pathToFileURL(real).toString(), { bypassCustomProtocolHandlers: true });
      // webRequest.onHeadersReceived does not run for protocol.handle responses, so the CSP is attached here
      const headers = new Headers({ 'Content-Type': MIME[path.extname(real)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': UI_CSP, 'Cache-Control': 'no-store' });
      return new Response(r.body, { status: r.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
}

// ---- IPC ----------------------------------------------------------------------------------------------------------------
function registerIpc(): void {
  const openDoc = async (e: IpcMainInvokeEvent, file: string) => {
    const w = senderWin(e);
    const p = validateDeckPath(file);
    const { bytes, realFile } = await loadFromDisk(p);
    if (w.doc) closeDoc(w.doc);
    const doc = await createDoc(e.sender, realFile, bytes);
    w.doc = doc; w.dirty = false;
    w.win.setTitle(`${path.basename(realFile)} - Deckhand`);
    watchDoc(doc, () => { if (!e.sender.isDestroyed()) e.sender.send('doc-event', { type: 'external-change', docId: doc.id }); });
    return { docId: doc.id, name: path.basename(realFile), dir: path.dirname(realFile), bytes };
  };

  registerAi((e) => { senderWin(e); });
  ipcMain.handle('app:open-dialog', async (e) => {
    const w = senderWin(e);
    const r = await dialog.showOpenDialog(w.win, { properties: ['openFile'], filters: [{ name: 'HTML presentations', extensions: ['html', 'htm'] }] });
    return r.canceled || !r.filePaths[0] ? null : openDoc(e, r.filePaths[0]);
  });
  ipcMain.handle('app:open-path', (e, file: unknown) => openDoc(e, validateDeckPath(file)));
  ipcMain.handle('doc:set-text', (e, a: unknown) => {
    const { docId, text } = z.object({ docId: idSchema, text: z.string().max(MAX_FILE) }).parse(a);
    const doc = ownedDoc(e, docId);
    const { token, key } = buildLive(doc, text);
    return { src: `${DOC_SCHEME}://${doc.host}/${encodeURIComponent(path.basename(doc.file))}?k=${key}`, origin: `${DOC_SCHEME}://${doc.host}`, token };
  });
  ipcMain.handle('doc:save', async (e, a: unknown) => {
    const { docId, bytes } = z.object({ docId: idSchema, bytes: bytesSchema }).parse(a);
    const doc = ownedDoc(e, docId);
    await saveDoc(doc, bytes);
    await clearRecovery(doc);
    senderWin(e).dirty = false;
    return true;
  });
  ipcMain.handle('doc:save-as', async (e, a: unknown) => {
    const { docId, bytes } = z.object({ docId: idSchema, bytes: bytesSchema }).parse(a);
    const doc = ownedDoc(e, docId);
    const w = senderWin(e);
    const r = await dialog.showSaveDialog(w.win, { defaultPath: doc.file, filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
    if (r.canceled || !r.filePath) return null;
    const target = validateDeckPath(r.filePath);
    await fs.writeFile(target, bytes);
    markHash(doc, bytes);
    return { file: target };
  });
  ipcMain.handle('doc:dirty', (e, a: unknown) => { senderWin(e).dirty = z.boolean().parse(a); return true; });
  ipcMain.handle('doc:policy', (e, a: unknown) => {
    const { docId, remote } = z.object({ docId: idSchema, remote: z.enum(['allow', 'block']) }).parse(a);
    ownedDoc(e, docId).remote = remote;
    return true;
  });
  ipcMain.handle('doc:autorecover', async (e, a: unknown) => {
    const { docId, bytes } = z.object({ docId: idSchema, bytes: bytesSchema }).parse(a);
    await writeRecovery(ownedDoc(e, docId), bytes);
    return true;
  });
  ipcMain.handle('doc:close-confirmed', (e) => { const w = senderWin(e); w.closing = true; w.dirty = false; w.win.close(); return true; });
  ipcMain.handle('doc:read-disk', async (e, a: unknown) => {
    const { docId } = z.object({ docId: idSchema }).parse(a);
    const doc = ownedDoc(e, docId);
    return (await loadFromDisk(doc.file)).bytes;
  });
  ipcMain.handle('recovery:list', (e) => { senderWin(e); return listRecovery(); });
  ipcMain.handle('recovery:read', async (e, a: unknown) => { senderWin(e); return readRecovery(z.string().parse(a)); });
  ipcMain.handle('recovery:discard', async (e, a: unknown) => { senderWin(e); await discardRecovery(z.string().parse(a)); return true; });
  ipcMain.handle('show:start', (e, a: unknown) => {
    const { docId, slide } = z.object({ docId: idSchema, slide: z.number().int().min(0).max(5000) }).parse(a);
    startShow(ownedDoc(e, docId), slide);
    return true;
  });
  ipcMain.handle('doc:export-pdf', async (e, a: unknown) => {
    const { docId, slides } = z.object({ docId: idSchema, slides: z.number().int().min(1).max(5000) }).parse(a);
    return exportPdf(senderWin(e).win, ownedDoc(e, docId), slides);
  });
  ipcMain.handle('app:open-external', async (e, a: unknown) => {
    const w = senderWin(e);
    const url = z.string().max(2048).parse(a);
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return false;
    const r = await dialog.showMessageBox(w.win, { type: 'question', buttons: ['Open', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Open this link in your browser?', detail: u.toString().slice(0, 300) });
    if (r.response !== 0) return false;
    await shell.openExternal(u.toString());
    return true;
  });
}

// ---- lifecycle ---------------------------------------------------------------------------------------------------------
function parseArgv(argv: string[]): { file?: string; slide?: number } {
  const rest = argv.slice(app.isPackaged ? 1 : 2);
  let file: string | undefined;
  let slide: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--slide' && rest[i + 1]) { slide = Math.max(1, parseInt(rest[++i]!, 10) || 1); continue; }
    if (a.startsWith('-')) continue;
    if (/\.html?$/i.test(a)) { try { file = validateDeckPath(path.resolve(a)); } catch { /* ignore invalid */ } }
  }
  return { file, slide };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const { file, slide } = parseArgv(argv);
    if (file) void openInWindow(file, slide); else createWindow();
  });
  app.on('open-file', (e, file) => { e.preventDefault(); try { void openInWindow(validateDeckPath(file)); } catch { /* ignore */ } });
  app.whenReady().then(() => {
    hardenSession();
    registerDocProtocol();
    if (!isDev) registerAppProtocol();
    registerIpc();
    Menu.setApplicationMenu(null);
    setBlockedHandler((doc, ev) => { if (!doc.owner.isDestroyed()) doc.owner.send('doc-event', { type: 'blocked', ...ev }); });
    const { file, slide } = parseArgv(process.argv);
    if (file) void openInWindow(file, slide); else createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
