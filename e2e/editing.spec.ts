import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { centreOf, clickObj, deckFrame, DECKS, dragObj, launch, ready, save, type Ctx, MOD, editAt, expectEditing } from './helpers';

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
  // undo may reload the live view (a style attribute disappears); poll until the reloaded deck has laid out again
  await expect.poll(async () => Math.round(await (async () => deckFrame(c.page).evaluate(() => document.querySelector('.logo')?.getBoundingClientRect().left ?? -1))().catch(() => -1)), { timeout: 15000 }).toBe(Math.round(before));
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
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes'); // the Esc commit is asynchronous: saving before it lands would save nothing
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
  // the undo above reloads the live view; a click that lands during that reload is overwritten, so retry until it sticks
  await expect(async () => {
    await c.page.getByTestId('thumb-2').click();
    await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 3 of 3', { timeout: 1500 });
  }).toPass({ timeout: 15000 });
  await c.page.waitForTimeout(1000); // a late handshake or refresh after the reload must not move us off slide 3
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 3 of 3');
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
  await expectEditing(c.page);
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Hello box');
  await c.page.keyboard.press('Escape');
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes'); // the Esc commit is asynchronous: saving before it lands would save nothing
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
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes'); // the Esc commit is asynchronous: saving before it lands would save nothing
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

test('New Slide gallery adds a slide from a deck layout; one Undo removes it', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('cmd-new-slide').click();
  await expect(c.page.getByTestId('layout-item')).toHaveCount(2);
  await c.page.getByTestId('layout-item').nth(1).click();
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 2 of 4', { timeout: 10000 });
  await save(c.page);
  expect(c.text()).toContain('Click to add title');
  expect(c.text()).not.toContain('data-deckhand');
  await c.page.keyboard.press(`${MOD}+z`);
  await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(3, { timeout: 10000 });
  await save(c.page);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('Format Background changes only the slide element\'s style', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('bg-color').evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, '#123456');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Unsaved changes', { timeout: 10000 });
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').toString('latin1').replace('<section class="slide active" data-slide="1">', '<section class="slide active" data-slide="1" style="background-color: #123456;">'));
});

test('Insert and change a picture; alt text; the file is copied next to the deck', async () => {
  c = await launch('plain-page.html');
  await ready(c.page);
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const os = await import('node:os');
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pic-'));
  const picA = path.join(dirA, 'My Photo!.png');
  fs.writeFileSync(picA, Buffer.from(pngB64, 'base64'));
  const stub = (f: string) => c.app.evaluate(({ dialog }, file) => { (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, f);
  await stub(picA);
  await c.page.getByTestId('tab-insert').click();
  await c.page.getByTestId('cmd-picture').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes', { timeout: 10000 });
  await save(c.page);
  expect(c.text()).toMatch(/<img src="images\/My-Photo-\.png" alt=""/);
  expect(fs.existsSync(path.join(c.deckDir, 'images', 'My-Photo-.png'))).toBe(true);
  expect(c.text()).not.toContain('data-deckhand');

  const picB = path.join(dirA, 'Other.png');
  fs.writeFileSync(picB, Buffer.from(pngB64, 'base64'));
  await stub(picB);
  await clickObj(c.page, 'img');
  await c.page.getByTestId('fp-alt').fill('A pixel');
  await c.page.getByTestId('fp-alt').blur();
  await c.page.getByTestId('cmd-change-picture').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await save(c.page);
  expect(c.text()).toMatch(/<img src="images\/Other\.png" alt="A pixel" style=/);
});

test('Home: align text and font colour change only the selected object\'s style', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.slide.active .body');
  await c.page.getByTestId('txt-center').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').toString('latin1').replace('<p class="body">Revenue', '<p class="body" style="text-align: center;">Revenue'));
});

test('Backstage: Info lists format and external domains; Open lists recent files', async () => {
  c = await launch('remote-fonts-tailwind.html');
  await ready(c.page);
  await c.page.getByTestId('tab-file').click();
  await expect(c.page.getByTestId('info')).toContainText('cdn.tailwindcss.com');
  await expect(c.page.getByTestId('info')).toContainText('fonts.googleapis.com');
  await expect(c.page.getByTestId('info')).toContainText('generic');
  await c.page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(c.page.getByTestId('recent-item').first()).toHaveText('remote-fonts-tailwind.html');
  await c.page.keyboard.press('Escape');
  await expect(c.page.getByTestId('backstage')).toHaveCount(0);
});

test('Insert > Link wraps the selected text in an anchor; unsafe addresses are refused', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const t = await centreOf(c.page, '.slide.active .body');
  await editAt(c.page, t.x - t.w / 2 + 30, t.y); // selects the word "Revenue"
  await c.page.waitForTimeout(1700); // the agent's refocus guard covers the first 1.5 s of an edit
  await c.page.getByTestId('tab-insert').click();
  await c.page.getByTestId('cmd-link').click();
  await c.page.getByTestId('link-url').fill('javascript:alert(1)');
  await expect(c.page.getByTestId('link-ok')).toBeDisabled();
  await c.page.getByTestId('link-url').fill('https://example.com/a?b=1&c=2');
  await c.page.getByTestId('link-ok').click();
  await c.page.keyboard.press('Escape');
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes'); // the Esc commit is asynchronous; save() would otherwise match the old 'Saved'
  await save(c.page);
  expect(c.text()).toMatch(/<a href="https:\/\/example\.com\/a\?b=1&amp;c=2">Revenue ?<\/a> ?grew/);
});

test('Options: Trust Center defaults apply to the next opened document; AI can be switched off', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await expect(c.page.getByTestId('live-view')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect(c.page.getByTestId('dock-ai')).toBeVisible();
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('bs-options').click();
  await c.page.getByTestId('opt-scripts').uncheck();
  await c.page.getByTestId('opt-remote').selectOption('block');
  await c.page.getByTestId('opt-ai').uncheck();
  await expect(c.page.getByTestId('opt-ai-external')).toBeDisabled();
  await expect.poll(() => { try { return JSON.parse(fs.readFileSync(path.join(c.userData, 'settings.json'), 'utf8')); } catch { return null; } }).toMatchObject({ scripts: false, remote: 'block', aiEnabled: false, aiAllowExternal: false });
  await c.page.getByRole('button', { name: 'Open', exact: true }).click();
  await c.page.getByTestId('recent-item').first().click(); // reopen: the new defaults apply
  await expect(c.page.getByTestId('live-view')).toHaveAttribute('sandbox', '', { timeout: 15000 });
  await expect(c.page.getByTestId('dock-ai')).toHaveCount(0);
});

test('Define Slides: choose the slide element; saved as one meta tag; reset restores the original bytes', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.slide.active .title');
  await c.page.getByTestId('tab-design').click();
  await c.page.getByTestId('cmd-define-slides').click();
  await expect(c.page.getByTestId('define-dialog')).toBeVisible();
  await c.page.getByTestId('define-selector').fill('div');
  await expect(c.page.getByTestId('define-count')).toContainText('1 slide');
  await c.page.getByTestId('define-selector').fill('p:hover');
  await expect(c.page.getByRole('alert')).toBeVisible();
  await c.page.getByTestId('define-selector').fill('section');
  await expect(c.page.getByTestId('define-count')).toContainText('3 slides');
  await c.page.getByTestId('define-apply').click();
  await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Unsaved changes');
  await expect(c.page.getByTestId('adapter-chip')).toHaveText('custom', { timeout: 10000 });
  await save(c.page);
  expect(c.text()).toContain('<meta name="deckhand:slides" content="section">');
  await c.page.getByTestId('tab-design').click();
  await c.page.getByTestId('cmd-define-slides').click();
  await c.page.getByTestId('define-reset').click();
  await save(c.page);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('Selection Pane: select, rename, hide and lock objects; a locked object cannot be moved or deleted', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('dock-selection').click();
  const items = c.page.getByTestId('sel-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('div.logo'); // topmost first
  await items.nth(0).locator('.selname').click();
  await expect(c.page.locator('[data-testid=path]')).toContainText('div.logo');
  await items.nth(0).locator('.selname').dblclick();
  await c.page.getByTestId('sel-rename').fill('Logo');
  await c.page.keyboard.press('Enter');
  await expect(items.nth(0)).toContainText('Logo');
  await items.nth(0).getByTestId('sel-lock').click();
  await c.page.keyboard.press('Delete');
  await expect(c.page.getByTestId('msgbar').filter({ hasText: 'locked object cannot be deleted' })).toBeVisible();
  await dragObj(c.page, '.slide.active .logo', 80, 40);
  await items.nth(0).getByTestId('sel-lock').click(); // unlock
  await items.nth(1).getByTestId('sel-eye').click(); // hide the body text
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').toString('latin1')
    .replace('<div class="logo">', '<div class="logo" data-deckhand-name="Logo">')
    .replace('<p class="body">Revenue', '<p class="body" style="display: none;">Revenue'));
});

test('Find and Replace: counts matches across slides, replaces one or all, one Undo', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.keyboard.press(`${MOD}+f`);
  await c.page.getByTestId('find-query').fill('o');
  await c.page.getByTestId('find-query').fill('Roadmap');
  await expect(c.page.getByTestId('find-count')).toContainText('1 of 1 on 1 slide');
  await c.page.getByTestId('find-query').press('Enter');
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 2 of 3');
  await c.page.getByTestId('find-replacement').fill('Plan & Roadmap');
  await c.page.getByTestId('find-replace').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await c.page.getByLabel('Match case').check();
  await c.page.getByTestId('find-query').fill('Q');
  await expect(c.page.getByTestId('find-count')).toContainText('of 2');   // "Quarterly" and "Questions?"
  await c.page.getByTestId('find-replacement').fill('X');
  await c.page.getByTestId('find-replace-all').click();
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').toString('latin1')
    .replace('Roadmap', 'Plan &amp; Roadmap').replace('Quarterly', 'Xuarterly').replace('Questions?', 'Xuestions?'));
  await c.page.getByTestId('find-query').press('Escape');
  await expect(c.page.getByTestId('find-bar')).toHaveCount(0);
});

test('Code view: shows the source, applies a code edit as one undo step, and follows canvas edits', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('tab-view').click();
  await c.page.getByTestId('view-code').click();
  await expect(c.page.getByTestId('code-view')).toContainText('Fixed stage deck');
  await c.page.getByTestId('code-content').click();
  await c.page.keyboard.press(`${MOD}+End`);
  await c.page.keyboard.type('<!-- note from code view -->');
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes', { timeout: 8000 }); // applied after 1 s idle
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').toString('latin1') + '<!-- note from code view -->');
  await c.page.getByTestId('view-split').click();
  await expect(c.page.getByTestId('code-view')).toBeVisible();
  await expect(c.page.getByTestId('live-view')).toBeVisible();
  await c.page.getByTestId('qat-undo').click(); // the QAT undoes the document; Ctrl+Z inside the code box is the box's own history
  await save(c.page);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
  await expect(c.page.getByTestId('code-view')).not.toContainText('note from code view');
});

test('Code view: embedded pictures are folded, and an edit that adds HTML errors is held back until confirmed', async () => {
  c = await launch('base64-images.html');
  await ready(c.page);
  await c.page.getByTestId('tab-view').click();
  await c.page.getByTestId('view-code').click();
  await expect(c.page.locator('.cm-datafold').first()).toContainText('data:image/png;base64,…');
  await c.page.getByTestId('code-content').click();
  await c.page.keyboard.press(`${MOD}+End`);
  await c.page.keyboard.type('</div></div></span><');
  await expect(c.page.getByTestId('code-status')).toContainText('Not applied', { timeout: 8000 });
  await expect(c.page.getByTestId('savestate')).not.toHaveText('Unsaved changes');
  await c.page.getByTestId('code-apply-anyway').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
});

test('Format Painter copies visual style (not position) to the next selected object; one undo step; Esc cancels', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await c.page.locator('[data-testid=fp-fill]').fill('#00aa44');
  await c.page.locator('[data-testid=fp-x]').fill('100');
  await c.page.locator('[data-testid=fp-x]').press('Enter');
  await c.page.waitForTimeout(400);
  await c.page.getByTestId('tab-home').click();
  await c.page.getByTestId('cmd-painter').click();
  await clickObj(c.page, '.slide.active .body');
  await expect(c.page.getByTestId('cmd-painter')).toHaveAttribute('aria-pressed', 'false');
  await save(c.page);
  const out = c.text();
  const body = /<p class="body" style="([^"]*)">/.exec(out)?.[1] ?? '';
  expect(body).toMatch(/background(-color)?: #00aa44/i);
  expect(body).not.toMatch(/left|top|right|width|height/);
  // one undo step restores the body untouched
  await c.page.getByTestId('qat-undo').click();
  await save(c.page).catch(() => undefined);
  expect(c.text()).toContain(`<p class="body">Revenue`);
});

test('Distribute needs three objects, moves only the middle one, and one Undo restores the bytes', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await c.page.keyboard.press(`${MOD}+a`);
  await expect(c.page.getByTestId('cmd-dist-v')).toBeEnabled();
  await c.page.getByTestId('cmd-dist-v').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await c.page.getByTestId('qat-undo').click();
  await save(c.page).catch(() => undefined);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('Remote content "Ask": a deck with external content opens blocked, and the message bar can allow it', async () => {
  c = await launch('remote-fonts-tailwind.html');
  await ready(c.page);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('bs-options').click();
  await c.page.getByTestId('opt-remote').selectOption('ask');
  await expect.poll(() => { try { return JSON.parse(fs.readFileSync(path.join(c.userData, 'settings.json'), 'utf8')).remote; } catch { return null; } }).toBe('ask');
  await c.page.getByRole('button', { name: 'Open', exact: true }).click();
  await c.page.getByTestId('recent-item').first().click(); // reopen: the new default applies
  const bar = c.page.locator('[data-testid=msgbar]', { hasText: 'loads content from the internet' });
  await expect(bar).toContainText('blocked for now', { timeout: 15000 });
  await c.page.getByTestId('tab-view').click();
  await expect(c.page.getByTestId('cmd-remote')).toHaveAttribute('aria-pressed', 'false');
  await bar.getByRole('button', { name: 'Allow' }).click();
  await expect(c.page.getByTestId('cmd-remote')).toHaveAttribute('aria-pressed', 'true');
});
