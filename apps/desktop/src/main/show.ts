/** Slide Show and PDF export windows. Both load the deck's plain page (no editor ids, no bridge) in a sandboxed window of the document's own origin. */
import { BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { detectDeck, parseSource } from '@deckhand/core';
import { DOC_SCHEME, type Doc } from './docs.js';

/** The CSS selector of the slides when the deck has no framework of its own (class-based decks): arrow keys cannot be counted on there, because a key may reveal a build step instead of moving to the next slide. */
function slideSelector(doc: Doc): string | null {
  try {
    const det = detectDeck(parseSource(doc.text, { encoding: 'utf-8', bom: false, eol: 'none' }));
    return (det.adapter === 'generic' || det.adapter === 'custom' || det.adapter === 'marp') && det.selector && det.slides.length > 1 ? det.selector : null;
  } catch { return null; }
}
// runs in the plain page (same logic as the editor's showSlide): show slide `idx` through the deck's own state class or display, and reveal build steps
const JUMP = `(function (sel, idx) {
  var els = Array.prototype.slice.call(document.querySelectorAll(sel)); var t = els[idx];
  if (!t || els.length < 2) return false;
  var STATE = /^(active|current|present|visible|is-active|is-current|show|shown)$/;
  var holders = els.filter(function (e) { return Array.prototype.some.call(e.classList, function (c) { return STATE.test(c); }); });
  var token = holders.length === 1 ? Array.prototype.find.call(holders[0].classList, function (c) { return STATE.test(c); }) : '';
  if (token) els.forEach(function (e) { e.classList.toggle(token, e === t); });
  if (token) { var seen = []; els.forEach(function (e) { for (var a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { var peers = a.parentElement ? Array.prototype.filter.call(a.parentElement.children, function (x) { return x.tagName === a.tagName; }) : []; if (peers.length >= 2 && peers.some(function (x) { return x.classList.contains(token); }) && seen.indexOf(a) < 0) seen.push(a); } }); seen.forEach(function (g) { g.classList.toggle(token, g.contains(t)); }); }
  else if (els.filter(function (e) { return e !== t && getComputedStyle(e).display === 'none'; }).length >= els.length - 2) els.forEach(function (e) { e.style.display = e === t ? '' : 'none'; });
  else { document.documentElement.style.paddingBottom = '100vh'; t.scrollIntoView({ block: 'start', inline: 'start' }); }
  if (!token) { var cs = getComputedStyle(t); if (cs.display === 'none') t.style.display = 'block'; if (cs.opacity === '0') t.style.opacity = '1'; if (cs.visibility === 'hidden') t.style.visibility = 'visible'; }
  var st = document.createElement('style'); st.textContent = '[data-deckhand-reveal]{opacity:1!important;visibility:visible!important;transform:none!important}'; document.head.appendChild(st);
  Array.prototype.forEach.call(t.querySelectorAll('[data-step],[data-fragment-index],.fragment,.step,.build'), function (e) { var c = getComputedStyle(e); if (c.opacity === '0' || c.visibility === 'hidden') e.setAttribute('data-deckhand-reveal', ''); });
  var r = t.getBoundingClientRect(), host = t.parentElement;
  if (host && host !== document.body && getComputedStyle(t).display !== 'none' && !(r.width > 0 && r.height > 0 && r.right > 1 && r.left < innerWidth - 1 && r.bottom > 1 && r.top < innerHeight - 1)) {
    host.style.transform = 'none'; host.style.translate = ''; r = t.getBoundingClientRect();
    host.style.translate = (innerWidth / 2 - (r.left + r.width / 2)) + 'px ' + (innerHeight / 2 - (r.top + r.height / 2)) + 'px';
  }
  return true;
})`;
const ACTIVE = `(function (sel) {
  var els = Array.prototype.slice.call(document.querySelectorAll(sel));
  var STATE = /^(active|current|present|visible|is-active|is-current|show|shown)$/;
  var h = els.map(function (e, i) { return Array.prototype.some.call(e.classList, function (c) { return STATE.test(c); }) ? i : -1; }).filter(function (i) { return i >= 0; });
  return h.length === 1 ? h[0] : -1;
})`;
/** Capture windows are not on screen, so CSS transitions run slowly there and a capture can catch two slides half-faded. Capture the settled state instead. */
const settle = (wc: WebContents): Promise<unknown> => wc.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}').catch(() => undefined);
const jumpTo = (wc: WebContents, sel: string, idx: number): Promise<boolean> => wc.executeJavaScript(`${JUMP}(${JSON.stringify(sel)}, ${idx})`, true).then((r) => r === true, () => false);
const activeIndex = (wc: WebContents, sel: string): Promise<number> => wc.executeJavaScript(`${ACTIVE}(${JSON.stringify(sel)})`, true).then((r) => (typeof r === 'number' ? r : -1), () => -1);

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
      const sel = slideSelector(doc);
      for (let i = 0; i < (sel ? 80 : fromSlide) && !win.isDestroyed(); i++) {
        // with build steps one key may only reveal a step, so look at which slide is showing instead of counting keys
        if (sel && (await activeIndex(win.webContents, sel)) >= fromSlide) break;
        await key(win.webContents, 'Right'); await delay(150);
      }
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
    await settle(win.webContents);
    const pdf = await PDFDocument.create();
    const n = Math.max(1, Math.min(slideCount, 500));
    const sel = slideSelector(doc);
    for (let i = 0; i < n; i++) {
      await delay(500);
      const img = await win.webContents.capturePage();
      const { width, height } = img.getSize();
      const page = pdf.addPage([width, height]);
      page.drawImage(await pdf.embedPng(img.toPNG()), { x: 0, y: 0, width, height });
      if (i < n - 1) { if (!(sel && await jumpTo(win.webContents, sel, i + 1))) await key(win.webContents, 'Right'); }
    }
    await fs.writeFile(r.filePath, await pdf.save());
    return r.filePath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** PNG export: the current slide as one file, or every slide into a folder (name-01.png …), captured at 1920×1080 like the PDF. */
export async function exportPng(parent: BrowserWindow, doc: Doc, slideCount: number, only: number | null): Promise<string | null> {
  const base = path.basename(doc.file).replace(/\.html?$/i, '');
  let target: string;
  if (only !== null) {
    const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(doc.dir, `${base}-${String(only + 1).padStart(2, '0')}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  } else {
    const r = await dialog.showOpenDialog(parent, { defaultPath: doc.dir, properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder for the pictures' });
    if (r.canceled || !r.filePaths[0]) return null;
    target = r.filePaths[0];
  }
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { ...WEB, offscreen: false, backgroundThrottling: false } });
  try {
    await win.loadURL(deckUrl(doc));
    await delay(1200);
    await settle(win.webContents);
    const n = Math.max(1, Math.min(slideCount, 500));
    const sel = slideSelector(doc);
    let at = 0;
    for (let i = 0; i < n; i++) {
      const want = only ?? i;
      if (sel && await jumpTo(win.webContents, sel, want)) { at = want; await delay(400); } else { for (; at < want; at++) { await key(win.webContents, 'Right'); await delay(150); } await delay(400); }
      const png = (await win.webContents.capturePage()).toPNG();
      if (only !== null) { await fs.writeFile(target, png); return target; }
      await fs.writeFile(path.join(target, `${base}-${String(i + 1).padStart(2, '0')}.png`), png);
    }
    return target;
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
      await settle(win.webContents);
      const sel = slideSelector(doc);
      let at = 0;
      for (const idx of [...new Set(indices)].sort((a, b) => a - b)) {
        if (sel && await jumpTo(win.webContents, sel, idx)) { at = idx; await delay(300); }
        else {
          for (; at < idx; at++) { await key(win.webContents, 'Right'); await delay(120); }
          await delay(250);
        }
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
