/** Slide Show and PDF export windows. Both load the deck's plain page (no editor ids, no bridge) in a sandboxed window of the document's own origin. */
import { BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DOC_SCHEME, type Doc } from './docs.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const WEB = { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false } as const;
const deckUrl = (doc: Doc): string => `${DOC_SCHEME}://${doc.host}/${encodeURIComponent(path.basename(doc.file))}`;

async function key(wc: WebContents, keyCode: string): Promise<void> {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  // scroll-snap decks navigate by scrolling; harmless for decks that handle keys
  if (keyCode === 'Right') await wc.executeJavaScript('window.scrollBy(0, window.innerHeight)', true).catch(() => undefined);
}

/** SEC-04: external links open in the default browser only after confirmation. */
function confirmLinks(win: BrowserWindow): void {
  const ask = async (url: string): Promise<void> => {
    let u: URL;
    try { u = new URL(url); } catch { return; }
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return;
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Open', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Open this link in your browser?', detail: u.toString().slice(0, 300) });
    if (r.response === 0) await shell.openExternal(u.toString());
  };
  win.webContents.setWindowOpenHandler(({ url }) => { void ask(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); void ask(url); });
}

/** Slide Show: fullscreen, Esc exits. Starting mid-deck sends the deck the same arrow keys a presenter would press. */
export function startShow(doc: Doc, fromSlide: number): void {
  const win = new BrowserWindow({ fullscreen: true, autoHideMenuBar: true, backgroundColor: '#000', title: 'Slide Show', webPreferences: { ...WEB } });
  win.setMenuBarVisibility(false);
  confirmLinks(win);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); win.close(); }
  });
  void win.loadURL(deckUrl(doc));
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      await delay(600);
      for (let i = 0; i < fromSlide && !win.isDestroyed(); i++) { await key(win.webContents, 'Right'); await delay(150); }
    })();
  });
}

/** PDF export (image-based, pdf-lib): every slide is captured from a hidden 1920×1080 window. */
export async function exportPdf(parent: BrowserWindow, doc: Doc, slideCount: number): Promise<string | null> {
  const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(doc.dir, path.basename(doc.file).replace(/\.html?$/i, '') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { ...WEB, offscreen: false, backgroundThrottling: false } });
  try {
    await win.loadURL(deckUrl(doc));
    await delay(1200);
    const pdf = await PDFDocument.create();
    const n = Math.max(1, Math.min(slideCount, 500));
    for (let i = 0; i < n; i++) {
      await delay(500);
      const img = await win.webContents.capturePage();
      const { width, height } = img.getSize();
      const page = pdf.addPage([width, height]);
      page.drawImage(await pdf.embedPng(img.toPNG()), { x: 0, y: 0, width, height });
      if (i < n - 1) await key(win.webContents, 'Right');
    }
    await fs.writeFile(r.filePath, await pdf.save());
    return r.filePath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Thumbnails (RND-09): hidden window, one JPEG data URL per requested slide index. Calls are serialised per process so renders never overlap. */
let chain: Promise<unknown> = Promise.resolve();
export function renderThumbs(doc: Doc, indices: number[], width: number): Promise<Record<number, string>> {
  const run = async (): Promise<Record<number, string>> => {
    const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { ...WEB, backgroundThrottling: false } });
    const out: Record<number, string> = {};
    try {
      await win.loadURL(deckUrl(doc));
      await delay(800);
      let at = 0;
      for (const idx of [...new Set(indices)].sort((a, b) => a - b)) {
        for (; at < idx; at++) { await key(win.webContents, 'Right'); await delay(120); }
        await delay(250);
        const img = (await win.webContents.capturePage()).resize({ width });
        out[idx] = `data:image/jpeg;base64,${img.toJPEG(70).toString('base64')}`;
      }
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
    return out;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
