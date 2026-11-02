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
  await expect.poll(() => c.app.windows().length, { timeout: 15000 }).toBe(2);
  const show = c.app.windows().find((w) => w !== c.page)!;
  await show.waitForLoadState('load');
  expect(show.url()).toMatch(/^deckhand-doc:\/\//);
  expect(await show.evaluate(() => document.querySelectorAll('[data-deckhand-id]').length)).toBe(0);
  expect(await show.evaluate(() => document.documentElement.outerHTML.includes('data-deckhand'))).toBe(false);
  await expect.poll(() => show.evaluate(() => (document.querySelector('.slide.active') as HTMLElement | null)?.dataset['slide']), { timeout: 10000 }).toBe('2');
  // CDP key events bypass the browser-side input hook, so send a real input event from the main process
  await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.isFullScreen() || x.getTitle() === 'Slide Show')!; w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); });
  await expect.poll(() => c.app.windows().length, { timeout: 10000 }).toBe(1);
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
