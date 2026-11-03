import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MOD, clickObj, deckFrame, dragObj, launch, ready, save, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); delete process.env['DECKHAND_FORCE_PROTECTED']; });

const rows = (s: string): number => (s.match(/<tr[ >]/g) ?? []).length;

test('table: insert and delete rows and columns from the ribbon; undo restores every byte', async () => {
  c = await launch('bench/dashboard.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  await expect(async () => { await c.page.getByTestId('thumb-2').click(); await expect(c.page.getByTestId('slide-counter')).toHaveText('Slide 3 of 6', { timeout: 1500 }); }).toPass({ timeout: 15000 });
  const cell = '.bespoke-slide:nth-child(3) tbody tr:nth-child(1) td:nth-child(2)';
  await clickObj(c.page, cell);
  await c.page.getByTestId('tab-insert').click();
  await c.page.getByTestId('cmd-row-below').click();
  await c.page.getByTestId('cmd-col-right').click();
  await expect.poll(async () => { try { return await deckFrame(c.page).evaluate(() => document.querySelectorAll('.bespoke-slide:nth-child(3) tr').length); } catch { return 0; } }).toBe(6);
  await save(c.page);
  const edited = fs.readFileSync(c.file, 'utf8');
  expect(rows(edited)).toBe(rows(original.toString('utf8')) + 1);
  expect(edited).not.toMatch(/data-deckhand|contenteditable/);
  expect((edited.match(/<td>Text<\/td>/g) ?? []).length).toBeGreaterThanOrEqual(5);
  await c.page.getByTestId('qat-undo').click();
  await c.page.waitForTimeout(500);
  await c.page.getByTestId('qat-undo').click();
  await c.page.waitForTimeout(800);
  await save(c.page).catch(() => undefined);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
});

test('apply to similar: one heading restyled, every heading like it on every slide follows; one undo each', async () => {
  c = await launch('bench/dashboard.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  await expect(async () => { await c.page.getByTestId('thumb-1').click(); await expect(c.page.getByTestId('slide-counter')).toHaveText('Slide 2 of 6', { timeout: 1500 }); }).toPass({ timeout: 15000 });
  await clickObj(c.page, '.bespoke-slide:nth-child(2) h2');
  await c.page.getByTestId('font-color').fill('#cc0000');
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await c.page.getByTestId('cmd-similar').click();
  await save(c.page);
  const out = fs.readFileSync(c.file, 'utf8');
  expect((out.match(/<h2[^>]*color: #cc0000/g) ?? []).length).toBe(5);
  await c.page.getByTestId('qat-undo').click();
  await c.page.waitForTimeout(600);
  await c.page.getByTestId('qat-undo').click();
  await c.page.waitForTimeout(800);
  await save(c.page).catch(() => undefined);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
});

test('picture styles and crop: plain inline declarations, reversible', async () => {
  c = await launch('bench/canvas-stage.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  await expect(async () => { await c.page.getByTestId('thumb-5').click(); await expect(c.page.getByTestId('slide-counter')).toHaveText('Slide 6 of 8', { timeout: 1500 }); }).toPass({ timeout: 15000 });
  await clickObj(c.page, '.slide[data-n="6"] img');
  await c.page.getByTestId('dock-format').click();
  await c.page.getByTestId('pstyle-rounded').click();
  await c.page.getByTestId('crop-top').fill('10');
  await c.page.getByTestId('crop-top').blur();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await save(c.page);
  const out = fs.readFileSync(c.file, 'utf8');
  expect(out).toMatch(/<img[^>]*border-radius: ?16px/);
  expect(out).toMatch(/<img[^>]*clip-path: ?inset\(10% 0% 0% 0%\)/);
  expect(out).not.toMatch(/data-deckhand/);
  for (let i = 0; i < 2; i++) { await c.page.getByTestId('qat-undo').click(); await c.page.waitForTimeout(600); }
  await save(c.page).catch(() => undefined);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
});

test('Version History keeps the file as it was before each save and restores it (undoable)', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  await clickObj(c.page, '.slide.active .logo');
  await dragObj(c.page, '.slide.active .logo', -100, 60);
  await save(c.page);
  expect(fs.readFileSync(c.file).equals(original)).toBe(false);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('bs-history').click();
  await expect(c.page.getByTestId('history-restore')).toHaveCount(1);
  await c.page.getByTestId('history-restore').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await save(c.page);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
  // the version taken before that save is the edited one: two versions now
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('bs-history').click();
  await expect(c.page.getByTestId('history-restore')).toHaveCount(2);
});

test('export: PNG of the slide, PNG of all slides, and a single HTML file with the local files inside', async () => {
  c = await launch('multi-file.html');
  await ready(c.page);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-exp-'));
  const one = path.join(tmp, 'one.png');
  await c.app.evaluate(({ dialog }, f) => { (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: f }); }, one);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('cmd-png').click();
  await expect.poll(() => fs.existsSync(one) && fs.statSync(one).size > 500, { timeout: 60000 }).toBe(true);
  expect(fs.readFileSync(one).subarray(0, 4).toString('hex')).toBe('89504e47');

  const dir = path.join(tmp, 'all');
  fs.mkdirSync(dir);
  await c.app.evaluate(({ dialog }, f) => { (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, dir);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('cmd-png-all').click();
  await expect.poll(() => fs.readdirSync(dir).length, { timeout: 90000 }).toBe(2);

  const single = path.join(tmp, 'single.html');
  await c.app.evaluate(({ dialog }, f) => { (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: f }); }, single);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('cmd-single').click();
  await expect.poll(() => fs.existsSync(single), { timeout: 30000 }).toBe(true);
  const html = fs.readFileSync(single, 'utf8');
  expect(html).not.toContain('assets/theme.css');
  expect(html).not.toContain('assets/deck.js');
  expect(html).toContain('<style>');
  expect(html).toContain('src="../secret.txt"'); // outside the deck's folder: never read, left as a link
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Protected View: a file marked as from the internet opens with scripts off and no editing until Enable Editing', async () => {
  process.env['DECKHAND_FORCE_PROTECTED'] = '1';
  c = await launch('ai-fixed-stage.html');
  await c.page.waitForSelector('[data-testid=canvas]');
  const original = fs.readFileSync(c.file);
  const bar = c.page.getByTestId('msgbar').filter({ hasText: 'Protected View' });
  await expect(bar).toBeVisible();
  await c.page.getByTestId('cmd-dup-slide').click(); // any change is refused
  await expect(c.page.getByTestId('msgbar').filter({ hasText: 'Protected View. Choose Enable Editing' })).toBeVisible();
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');
  await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(3);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
  await bar.getByRole('button', { name: 'Enable Editing' }).click();
  await expect(bar).toHaveCount(0);
  await ready(c.page);
  await c.page.getByTestId('thumb-0').click();
  await clickObj(c.page, '.slide.active .logo');
  await dragObj(c.page, '.slide.active .logo', -100, 60);
  await save(c.page);
  expect(fs.readFileSync(c.file).equals(original)).toBe(false);
  void MOD;
});

test('first-run tour appears once; Help (F1) lists the ideas and keys; spelling is an option', async () => {
  c = await launch(null);
  await expect(c.page.getByTestId('onboarding')).toBeVisible();
  await c.page.getByTestId('tour-next').click();
  await c.page.getByTestId('tour-next').click();
  await c.page.getByTestId('tour-done').click();
  await expect(c.page.getByTestId('onboarding')).toHaveCount(0);
  const ud = c.userData;
  await c.app.evaluate(({ app }) => app.exit(0));
  c = await launch(null, undefined, ud);
  await expect(c.page.getByTestId('welcome')).toBeVisible();
  await c.page.waitForTimeout(800);
  await expect(c.page.getByTestId('onboarding')).toHaveCount(0);
  await c.page.keyboard.press('F1');
  await expect(c.page.getByTestId('help')).toContainText('Your file stays your file');
  await c.page.getByTestId('bs-options').click();
  const spell = c.page.getByTestId('opt-spell');
  await expect(spell).toBeChecked();
  await spell.uncheck();
  const on = await c.app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled());
  expect(on).toBe(false);
});

test('fonts: a font file is copied next to the deck and declared; a web font is linked; undo restores every byte', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  const font = path.join(os.tmpdir(), `dh-font-${Date.now()}.woff2`);
  fs.writeFileSync(font, Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]));
  await c.app.evaluate(({ dialog }, f) => { (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, font);
  await c.page.getByTestId('tab-design').click();
  await c.page.getByTestId('cmd-fonts').click();
  await c.page.getByTestId('fonts-embed').click();
  await c.page.getByTestId('fonts-web').fill('Open Sans');
  await c.page.getByTestId('fonts-link').click();
  await save(c.page);
  const out = fs.readFileSync(c.file, 'utf8');
  expect(out).toMatch(/<style>@font-face \{ font-family: "[^"]+"; src: url\("fonts\/[^"]+\.woff2"\) format\("woff2"\); font-display: swap; \}<\/style>/);
  expect(out).toContain('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&amp;display=swap');
  expect(fs.readdirSync(path.join(c.deckDir, 'fonts')).length).toBe(1);
  for (let i = 0; i < 2; i++) { await c.page.getByTestId('qat-undo').click(); await c.page.waitForTimeout(600); }
  await save(c.page).catch(() => undefined);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
  fs.rmSync(font, { force: true });
});

test('Group works with an object the deck anchors to the right edge: nothing moves, Undo restores every byte', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  const rect = (sel: string) => deckFrame(c.page).evaluate((s) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }, sel);
  const before = [await rect('.slide.active .body'), await rect('.slide.active .logo')];
  await c.page.getByTestId('dock-selection').click();
  const items = c.page.getByTestId('sel-item');
  await items.filter({ hasText: 'div.logo' }).locator('.selname').click();
  await items.filter({ hasText: 'Text: Revenue' }).locator('.selname').click({ modifiers: [MOD] });
  await expect(c.page.getByTestId('cmd-group')).toBeEnabled();
  await c.page.getByTestId('cmd-group').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await ready(c.page);
  expect(await rect('.slide.active .body')).toEqual(before[0]);
  expect(await rect('.slide.active .logo')).toEqual(before[1]);
  await save(c.page);
  expect(fs.readFileSync(c.file, 'utf8')).toMatch(/<div class="logo" style="[^"]*right: auto/);
  await c.page.getByTestId('qat-undo').click();
  await c.page.waitForTimeout(800);
  await save(c.page).catch(() => undefined);
  expect(fs.readFileSync(c.file).equals(original)).toBe(true);
});

test('page mode: a page without slides is as tall as the page, fits its width, and its last paragraph can be edited', async () => {
  c = await launch('long-page.html');
  await ready(c.page);
  const original = fs.readFileSync(c.file);
  await expect(c.page.getByTestId('adapter-chip')).toHaveText('page');
  const docHeight = await deckFrame(c.page).evaluate(() => document.documentElement.scrollHeight);
  expect(docHeight).toBeGreaterThan(2500);
  await expect.poll(async () => Number(await c.page.getByTestId('live-view').evaluate((el) => parseFloat((el as HTMLElement).style.height)))).toBeGreaterThan(2500);
  await c.page.waitForTimeout(800);
  await c.page.getByTestId('canvas').evaluate((el) => { el.scrollTop = el.scrollHeight; }); // the page is taller than the window: scroll to its end
  await c.page.waitForTimeout(400);
  await clickObj(c.page, '#last');
  await dragObj(c.page, '#last', 30, 10);
  await save(c.page);
  const out = fs.readFileSync(c.file, 'utf8');
  expect(out.replace(/ style="[^"]*"/g, '')).toBe(original.toString('utf8').replace(/ style="[^"]*"/g, ''));
  expect(out).not.toBe(original.toString('utf8'));
  void MOD;
});
