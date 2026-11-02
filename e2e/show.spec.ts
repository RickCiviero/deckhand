import http from 'node:http';
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { launch, ready, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

test('Slide Show opens the plain deck (no editor artifacts), starts at the current slide, Esc exits', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('thumb-1').click();
  await c.page.keyboard.press('Shift+F5');
  // the hidden thumbnail window also counts as a window, so wait for the one that shows the deck
  await expect.poll(() => c.app.windows().filter((w) => w !== c.page && w.url().startsWith('deckhand-doc://')).length, { timeout: 15000 }).toBe(1);
  const show = c.app.windows().find((w) => w !== c.page && w.url().startsWith('deckhand-doc://'))!;
  await show.waitForLoadState('load');
  expect(show.url()).toMatch(/^deckhand-doc:\/\//);
  expect(await show.evaluate(() => document.querySelectorAll('[data-deckhand-id]').length)).toBe(0);
  expect(await show.evaluate(() => document.documentElement.outerHTML.includes('data-deckhand'))).toBe(false);
  await expect.poll(() => show.evaluate(() => (document.querySelector('.slide.active') as HTMLElement | null)?.dataset['slide']), { timeout: 10000 }).toBe('2');
  // CDP key events bypass the browser-side input hook, so send a real input event from the main process
  await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.isFullScreen() || x.getTitle() === 'Slide Show')!; w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); });
  await expect.poll(() => c.app.windows().filter((w) => w !== c.page && !w.isClosed() && w.url().startsWith('deckhand-doc://')).length, { timeout: 10000 }).toBe(0);
});

test('PDF export writes one page per slide', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const out = path.join(os.tmpdir(), `dh-${Date.now()}.pdf`);
  await c.app.evaluate(({ dialog }, f) => { (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: f }); }, out);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('cmd-pdf').click();
  await expect.poll(() => fs.existsSync(out) && fs.statSync(out).size > 1000, { timeout: 60000 }).toBe(true);
  const pdf = await PDFDocument.load(fs.readFileSync(out));
  expect(pdf.getPageCount()).toBe(3);
  fs.rmSync(out, { force: true });
});

test('Thumbnails render per slide and refresh after an edit', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  for (let i = 0; i < 3; i++) await expect(c.page.getByTestId(`timg-${i}`)).toBeVisible({ timeout: 30000 });
  const before = await c.page.getByTestId('timg-0').getAttribute('src');
  const { clickObj, dragObj } = await import('./helpers');
  await clickObj(c.page, '.slide.active .logo');
  await dragObj(c.page, '.slide.active .logo', -300, 200);
  await expect.poll(() => c.page.getByTestId('timg-0').getAttribute('src'), { timeout: 20000 }).not.toBe(before);
});

test('Preview in Browser serves the current state and the deck folder on 127.0.0.1 only', async () => {
  c = await launch('multi-file.html');
  await ready(c.page);
  await c.page.getByTestId('tab-show').click();
  await c.page.getByTestId('cmd-preview').click();
  const msg = await c.page.getByTestId('msgbar').filter({ hasText: 'Preview running at' }).textContent();
  const url = /(http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/[^\s]+)/.exec(msg ?? '')![1]!;
  const ok = await fetch(url);
  expect(ok.status).toBe(200);
  expect(ok.headers.get('content-type')).toContain('text/html');
  expect(await ok.text()).not.toContain('data-deckhand');
  const base = url.slice(0, url.indexOf('/', url.indexOf('/', 8) + 1) + 1);
  expect((await fetch(base + 'assets/theme.css')).status).toBe(200);
  expect((await fetch(base + '..%2f..%2fpackage.json')).status).toBeGreaterThanOrEqual(400);
  expect((await fetch(url.replace(/\/[0-9a-f]{32}\//, '/' + '0'.repeat(32) + '/'))).status).toBe(404); // wrong token
  const u = new URL(url); // fetch cannot override Host, so use a raw request
  const status = await new Promise<number>((ok) => { http.get({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { Host: 'evil.example:' + u.port } }, (r) => { r.resume(); ok(r.statusCode ?? 0); }); });
  expect(status).toBe(403); // DNS-rebinding guard
});
