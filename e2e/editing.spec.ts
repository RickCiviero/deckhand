import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { centreOf, clickObj, deckFrame, DECKS, dragObj, launch, ready, save, type Ctx, MOD, editAt } from './helpers';

let c: Ctx;
// app.close() would block on the "Save changes?" dialog for dirty documents, so force-exit
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

const original = (name: string): Buffer => fs.readFileSync(path.join(DECKS, 'decks', name));

test('opens a deck, detects slides, no-op save keeps the file byte-identical', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 3');
  await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(3);
  await expect(c.page.locator('[data-testid=thumb-0]')).toContainText('Quarterly Review');
  // saving without edits must not change a byte (RT-01) — even if the user presses Ctrl+S
  await c.page.keyboard.press(`${MOD}+s`);
  await c.page.waitForTimeout(500);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('click selects the deepest object; Free badge for absolutely positioned logo', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await expect(c.page.locator('[data-testid=path]')).toContainText('div.logo');
  await expect(c.page.locator('[data-testid=format-pane]')).toContainText('Free');
});

test('drag moves a Free object: only that element\'s style attribute changes', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await dragObj(c.page, '.logo', -120, 80);
  await save(c.page);
  const out = c.text();
  const orig = original('ai-fixed-stage.html').toString('latin1');
  const m = /<div class="logo" style="([^"]*)"><\/div>/.exec(out);
  expect(m, out.slice(out.indexOf('class="logo"') - 20, out.indexOf('class="logo"') + 120)).not.toBeNull();
  // .logo is anchored with `right:` in the deck's CSS, so the move must be written as right/top (POS-01)
  expect(m![1]).toMatch(/^right: \d+(\.\d)?px; top: \d+(\.\d)?px;$/);
  // everything else is byte-identical
  expect(out.replace(` style="${m![1]}"`, '')).toBe(orig);
  expect(out).not.toMatch(/data-deckhand|contenteditable/);
});

test('arrow keys nudge by 1px / 10px and consecutive nudges are one undo step', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  const before = await deckFrame(c.page).evaluate(() => document.querySelector('.logo')!.getBoundingClientRect().left);
  await c.page.keyboard.press('ArrowLeft');
  await c.page.keyboard.press('ArrowLeft');
  await c.page.keyboard.press('Shift+ArrowLeft');
  await c.page.waitForTimeout(500);
  const after = await deckFrame(c.page).evaluate(() => document.querySelector('.logo')!.getBoundingClientRect().left);
  expect(Math.round(before - after)).toBe(12);
  await c.page.keyboard.press(`${MOD}+z`);
  await c.page.waitForTimeout(500);
  const undone = await deckFrame(c.page).evaluate(() => document.querySelector('.logo')!.getBoundingClientRect().left);
  expect(Math.round(undone)).toBe(Math.round(before));
  await save(c.page).catch(() => undefined);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('undo / redo restores the exact original bytes', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await dragObj(c.page, '.logo', 60, 60);
  await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Unsaved changes');
  await c.page.keyboard.press(`${MOD}+z`);
  await c.page.waitForTimeout(400);
  await c.page.keyboard.press(`${MOD}+s`);
  await c.page.waitForTimeout(600);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
  await c.page.keyboard.press(`${MOD}+y`);
  await c.page.waitForTimeout(400);
  await save(c.page);
  expect(c.text()).toContain('class="logo" style="');
});

test('resize with a handle writes width/height', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  const r = await centreOf(c.page, '.logo');
  const hx = r.x + r.w / 2; const hy = r.y + r.h / 2; // se handle is at the bottom-right corner
  await c.page.mouse.move(hx, hy);
  await c.page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  const se = c.page.locator('[data-handle=se]');
  const b = (await se.boundingBox())!;
  await c.page.mouse.move(b.x + 5, b.y + 5);
  await c.page.mouse.down();
  for (let i = 1; i <= 6; i++) { await c.page.mouse.move(b.x + 5 + i * 8, b.y + 5 + i * 8); await c.page.waitForTimeout(20); }
  await c.page.mouse.up();
  await c.page.waitForTimeout(500);
  await save(c.page);
  expect(c.text()).toMatch(/<div class="logo" style="[^"]*width: \d+/);
  expect(c.text()).toMatch(/height: \d+/);
});

test('Format pane: fill colour and numeric X', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await c.page.locator('[data-testid=fp-fill]').fill('#00aa44');
  await c.page.waitForTimeout(300);
  await c.page.locator('[data-testid=fp-x]').fill('100');
  await c.page.locator('[data-testid=fp-x]').press('Enter');
  await c.page.waitForTimeout(500);
  await save(c.page);
  const t = c.text();
  expect(t).toContain('background-color: #00aa44');
  expect(t).toMatch(/right: 1660px/); // X=100 on a right-anchored 160px-wide element (1920 - 100 - 160)
});

test('theme colour swatches come from CSS variables and edit them in place', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByRole('button', { name: 'Theme' }).click();
  await c.page.locator('[data-testid="theme---brand"]').fill('#112233');
  await c.page.waitForTimeout(500);
  await save(c.page);
  const orig = original('ai-fixed-stage.html').toString('latin1');
  expect(c.text()).toBe(orig.replace('--brand: #C43E1C', '--brand: #112233'));
});

test('text editing: double-click, replace text, Esc commits; only the text changes', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const t = await centreOf(c.page, '.slide.active .title');
  await editAt(c.page, t.x, t.y);
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Annual Review');
  await c.page.keyboard.press('Escape');
  await expect(c.page.locator('.outline.edit')).toHaveCount(0);
  await save(c.page);
  const orig = original('ai-fixed-stage.html').toString('latin1');
  expect(c.text()).toBe(orig.replace('>Quarterly Review<', '>Annual Review<'));
});

test('text editing keeps entities and untouched markup when only part of the text changes; bold via Ctrl+B', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const t = await centreOf(c.page, '.slide.active .body');
  await editAt(c.page, t.x - t.w / 2 + 30, t.y); // selects the word "Revenue"
  await c.page.keyboard.press(`${MOD}+b`);
  await c.page.keyboard.press('Escape');
  await save(c.page);
  // Windows word-selection includes the trailing space; the untouched &mdash; and &amp; entities must survive (RT-02)
  expect(c.text()).toMatch(/<strong>Revenue ?<\/strong> ?grew <strong>12%<\/strong> &mdash; best quarter &amp; a record\./);
  expect(c.text()).not.toContain('<b>');
});

test('text edit that is a no-op does not touch the file', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const t = await centreOf(c.page, '.slide.active .body');
  await editAt(c.page, t.x, t.y);
  await c.page.keyboard.press('Escape');
  await c.page.waitForTimeout(300);
  await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Saved');
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('slides: duplicate, reorder, delete — each exact and undoable', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('cmd-dup-slide').click();
  await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(4, { timeout: 8000 });
  await c.page.keyboard.press(`${MOD}+z`);
  await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(3, { timeout: 8000 });
  await c.page.getByTestId('thumb-2').click();
  await c.page.getByTestId('cmd-del-slide').click();
  await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(2, { timeout: 8000 });
  await save(c.page);
  expect(c.text()).not.toContain('Thank you');
  expect(c.text()).toContain('Roadmap');
  // drag slide 1 (Roadmap) before slide 0
  await c.page.getByTestId('thumb-1').dragTo(c.page.getByTestId('thumb-0'));
  await expect(c.page.getByTestId('thumb-0')).toContainText('Roadmap', { timeout: 8000 });
});

test('insert a text box: Free div inside the current slide', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('tab-insert').click();
  await c.page.getByTestId('cmd-textbox').click();
  await expect(c.page.locator('.outline.edit')).toBeVisible({ timeout: 8000 });
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Hello box');
  await c.page.keyboard.press('Escape');
  await save(c.page);
  expect(c.text()).toMatch(/<div style="position: absolute; left: \d+px; top: \d+px; width: 400px;">Hello box<\/div>/);
});

test('multi-file deck: outside-folder reference is blocked with a message bar', async () => {
  c = await launch('multi-file.html');
  await ready(c.page);
  await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'outside its folder' })).toBeVisible({ timeout: 8000 });
  // the image inside the folder's own assets still loads
  const ok = await deckFrame(c.page).evaluate(() => document.documentElement.getAttribute('data-js'));
  expect(ok).toBe('1');
});

test('windows-1252 + CRLF deck: edit keeps encoding and line endings', async () => {
  c = await launch('latin1-crlf.html');
  await ready(c.page);
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 2');
  const t = await centreOf(c.page, 'section.slide h1');
  await editAt(c.page, t.x, t.y);
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Crème brûlée 日本');
  await c.page.keyboard.press('Escape');
  await save(c.page);
  const buf = c.read();
  const s = buf.toString('latin1');
  expect(s).toContain('Cr\xe8me br\xfbl\xe9e &#x65e5;&#x672c;'); // é/è/û as single cp1252 bytes, CJK as numeric references
  expect(s.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r'))).toBe(true);
  expect(s).toContain('<meta charset="windows-1252">');
});

test('external change on disk shows a message bar', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  fs.appendFileSync(c.file, '\n<!-- changed elsewhere -->\n');
  await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'changed by another program' })).toBeVisible({ timeout: 10000 });
});
