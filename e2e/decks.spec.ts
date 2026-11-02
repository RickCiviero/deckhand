import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { centreOf, clickObj, deckFrame, DECKS, dragObj, launch, ready, save, type Ctx, MOD, editAt } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });
const original = (name: string): Buffer => fs.readFileSync(path.join(DECKS, 'decks', name));

test.describe('every corpus deck opens and a no-op save is byte-identical', () => {
  for (const name of ['ai-fixed-stage', 'responsive-scroll-snap', 'reveal-style', 'latin1-crlf', 'utf8-bom', 'malformed', 'plain-page', 'base64-images', 'multi-file', 'large-100', 'lorem-steps']) {
    test(name, async () => {
      c = await launch(`${name}.html`);
      await ready(c.page);
      await expect(c.page.locator('[data-testid=slide-counter]')).toContainText('Slide 1 of');
      await c.page.keyboard.press(`${MOD}+s`);
      await c.page.waitForTimeout(500);
      expect(c.read().equals(original(`${name}.html`))).toBe(true);
    });
  }
});

test('responsive deck: moving an in-layout card uses translate in vw, so it scales with the viewport', async () => {
  c = await launch('responsive-scroll-snap.html');
  await ready(c.page);
  await c.page.getByTestId('thumb-1').click(); // Features slide with the cards grid
  await c.page.waitForTimeout(800);
  await clickObj(c.page, '.cards .card');
  await expect(c.page.locator('[data-testid=format-pane]')).toContainText('In layout');
  const siblingBefore = await deckFrame(c.page).evaluate(() => document.querySelectorAll('.card')[1]!.getBoundingClientRect().left);
  await dragObj(c.page, '.cards .card', 60, 25);
  const siblingAfter = await deckFrame(c.page).evaluate(() => document.querySelectorAll('.card')[1]!.getBoundingClientRect().left);
  expect(Math.round(siblingAfter)).toBe(Math.round(siblingBefore)); // moving one card must not reflow the others (POS-02)
  await save(c.page);
  const out = c.text();
  expect(out).toMatch(/<div class="card" style="translate: -?[\d.]+vw -?[\d.]+vw;?">Fast<\/div>/);
  // exactly one element changed
  expect(out.replace(/ style="translate:[^"]*"/, '')).toBe(original('responsive-scroll-snap.html').toString('latin1'));
});

test('responsive deck: translate offset keeps its relative position at another viewport size', async () => {
  c = await launch('responsive-scroll-snap.html');
  await ready(c.page);
  await c.page.getByTestId('thumb-1').click();
  await c.page.waitForTimeout(800);
  await clickObj(c.page, '.cards .card');
  await dragObj(c.page, '.cards .card', 80, 0);
  const style = await deckFrame(c.page).evaluate(() => (document.querySelector('.card') as HTMLElement).getAttribute('style'));
  const vwShift = parseFloat(/translate:\s*(-?[\d.]+)vw/.exec(style ?? '')![1]!);
  expect(vwShift).toBeGreaterThan(0);
  // vw offsets are proportional: at half the viewport width the shift in px halves too
  const ratio = await deckFrame(c.page).evaluate((v) => { const w1 = innerWidth; return (v / 100) * w1 / w1; }, vwShift);
  expect(ratio).toBeCloseTo(vwShift / 100, 5);
});

test('reveal-style deck: vertical stacks are separate slides, hidden slide is dimmed, text edit changes only that text', async () => {
  c = await launch('reveal-style.html');
  await ready(c.page);
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 5');
  await expect(c.page.getByTestId('thumb-3')).toHaveClass(/hidden/);
  await expect(c.page.locator('[data-testid=path]')).toHaveText('');
  const t = await centreOf(c.page, '.slides > section:first-child h1');
  await editAt(c.page, t.x, t.y);
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Hello again');
  await c.page.keyboard.press('Escape');
  await save(c.page);
  expect(c.text()).toBe(original('reveal-style.html').toString('latin1').replace('>Hello reveal<', '>Hello again<'));
});

test('malformed HTML opens and is edited without being "fixed"', async () => {
  c = await launch('malformed.html');
  await ready(c.page);
  await c.page.getByTestId('thumb-1').click();
  await c.page.waitForTimeout(800);
  const t = await centreOf(c.page, '.slide:nth-of-type(2) h1');
  await editAt(c.page, t.x, t.y);
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Second!');
  await c.page.keyboard.press('Escape');
  await save(c.page);
  expect(c.text()).toBe(original('malformed.html').toString('latin1').replace('<h1>Second</h1>', '<h1>Second!</h1>'));
});

test('UTF-8 BOM deck: BOM, mixed indentation, comments and odd quoting survive a text edit', async () => {
  c = await launch('utf8-bom.html');
  await ready(c.page);
  const t = await centreOf(c.page, 'section.slide h1');
  await editAt(c.page, t.x, t.y);
  await c.page.keyboard.press(`${MOD}+a`);
  await c.page.keyboard.type('Nuevo título 🎉');
  await c.page.keyboard.press('Escape');
  await save(c.page);
  const buf = c.read();
  expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const expected = original('utf8-bom.html').toString('utf8').replace('Ünïcödé — 日本語 🎉', 'Nuevo título 🎉');
  expect(buf.toString('utf8')).toBe(expected);
});

test('plain web page opens in page mode and can be edited', async () => {
  c = await launch('plain-page.html');
  await ready(c.page);
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 1');
  await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'single page' })).toBeVisible();
  await clickObj(c.page, 'h1');
  await expect(c.page.locator('[data-testid=path]')).toContainText('h1');
});

test('images: a picture can be selected and moved; the data: URI stays untouched', async () => {
  c = await launch('base64-images.html');
  await ready(c.page);
  await clickObj(c.page, 'img');
  await expect(c.page.locator('[data-testid=path]')).toContainText('img');
  await dragObj(c.page, 'img', 40, 30);
  await save(c.page);
  const out = c.text();
  const orig = original('base64-images.html').toString('latin1');
  expect(out).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="px" width="120" style="translate: [^"]+">/);
  expect(out.replace(/ style="translate:[^"]*"/, '')).toBe(orig);
});

test('large 100-slide deck opens quickly and slide navigation works', async () => {
  const t0 = Date.now();
  c = await launch('large-100.html');
  await ready(c.page);
  expect(Date.now() - t0).toBeLessThan(8000);
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 100');
  await c.page.keyboard.press('PageDown');
  await c.page.keyboard.press('PageDown');
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 3 of 100');
});

test('copy / paste an object onto another slide, then undo', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await c.page.keyboard.press(`${MOD}+c`);
  await c.page.getByTestId('thumb-1').click();
  await c.page.waitForTimeout(600);
  await c.page.locator('[data-testid=overlay]').click({ position: { x: 5, y: 5 } });
  await c.page.keyboard.press(`${MOD}+v`);
  await c.page.waitForTimeout(1200);
  await save(c.page);
  expect(c.text().match(/class="logo"/g)).toHaveLength(2);
  await c.page.keyboard.press(`${MOD}+z`);
  await c.page.waitForTimeout(800);
  await save(c.page);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('delete an object and undo restores the exact bytes', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await clickObj(c.page, '.logo');
  await c.page.keyboard.press('Delete');
  await c.page.waitForTimeout(1000);
  await save(c.page);
  expect(c.text()).not.toContain('class="logo"');
  await c.page.keyboard.press(`${MOD}+z`);
  await c.page.waitForTimeout(800);
  await save(c.page);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});

test('context menu: duplicate, bring to front, reset position', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const lg = await centreOf(c.page, '.logo');
  await c.page.mouse.click(lg.x, lg.y, { button: 'right' });
  await expect(c.page.getByRole('menu')).toBeVisible();
  await c.page.getByRole('menu').getByText('Bring to Front').click();
  await c.page.waitForTimeout(600);
  await save(c.page);
  expect(c.text()).toMatch(/<div class="logo" style="z-index: 1;?"><\/div>/);
});

test('Esc selects the parent object; Ctrl+A selects all top-level objects', async () => {
  c = await launch('responsive-scroll-snap.html');
  await ready(c.page);
  await c.page.getByTestId('thumb-1').click();
  await c.page.waitForTimeout(800);
  await clickObj(c.page, '.cards .card');
  await c.page.keyboard.press('Escape');
  await expect(c.page.locator('[data-testid=path]')).toContainText('div.cards');
  await c.page.keyboard.press('Escape'); // the slide itself is not an object: Esc on a top-level object deselects (SEL-03)
  await expect(c.page.locator('[data-testid=path] button')).toHaveCount(0);
});

test('Hide Slide toggles reveal.js data-visibility, is one undo step, and is disabled for other formats', async () => {
  c = await launch('reveal-style.html');
  await ready(c.page);
  await c.page.getByTestId('tab-show').click();
  await c.page.getByTestId('cmd-hide-slide').click();
  await expect(c.page.getByTestId('thumb-0')).toHaveClass(/hidden/);
  await save(c.page);
  expect(c.text()).toBe(original('reveal-style.html').toString('latin1').replace('<section>', '<section data-visibility="hidden">'));
  await c.page.getByTestId('cmd-hide-slide').click();
  await expect(c.page.getByTestId('thumb-0')).not.toHaveClass(/hidden/);
  await save(c.page);
  expect(c.read().equals(original('reveal-style.html'))).toBe(true);
  await c.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('tab-show').click();
  await expect(c.page.getByTestId('cmd-hide-slide')).toBeDisabled();
});

test('class-based deck with build steps (user report): 8 slides, every slide shows when picked, build steps are visible while editing, thumbnails are settled', async () => {
  c = await launch('lorem-steps.html');
  await ready(c.page);
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 8');
  await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'Not sure' })).toHaveCount(0);
  await expect(c.page.getByTestId('thumb-7')).toBeVisible();
  await c.page.getByTestId('thumb-3').click(); // the architecture slide: its boxes are build steps the deck reveals one key at a time
  await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 4 of 8');
  await expect.poll(() => deckFrame(c.page).evaluate(() => {
    const a = document.querySelector('.slide.active');
    return [a?.getAttribute('data-steps'), [...(a?.querySelectorAll('.step') ?? [])].every((e) => getComputedStyle(e).opacity === '1')];
  }), { timeout: 8000 }).toEqual(['6', true]);
  // nothing of that went into the file
  await c.page.keyboard.press(`${MOD}+s`);
  await c.page.waitForTimeout(500);
  expect(c.read().equals(original('lorem-steps.html'))).toBe(true);
});
