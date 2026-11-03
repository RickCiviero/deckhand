/**
 * Benchmark: the same checks on every deck of the benchmark corpus (test-decks/decks/bench, see scripts/gen-benchmark.mjs).
 * Decks are described by manifest.json; a check that a deck cannot satisfy is a bug in Deckhand or in the deck, never skipped.
 * Run repeatedly to find flakes: npm run bench  (BENCH_ONLY=<file part> narrows it to one deck).
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DECKS, MOD, centreOf, clickObj, deckFrame, dragObj, editAt, launch, ready, save, type Ctx } from './helpers';

interface Entry {
  file: string; slides: number; slideSelector: string; exclusive: boolean; navKey: string | null; navProbe?: string; navPresses?: number; navWait?: number;
  editText: string; editSlide?: number; moveSel: string; moveSlide: number; find: string; steps?: boolean; stepsSlide?: number; thumbs?: number;
  frames?: { slide: number; trigger: string; literal: string; replacement: string }; tags: string[];
}
const manifest: Entry[] = JSON.parse(fs.readFileSync(path.join(DECKS, 'decks/bench/manifest.json'), 'utf8'));
const only = process.env['BENCH_ONLY'];
const decks = manifest.filter((d) => !only || d.file.includes(only));

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

const read8 = (): string => fs.readFileSync(c.file, 'utf8');
const strip = (s: string): string => s.replace(/ style="[^"]*"/g, '');
/** The part of the two texts that differs: common prefix and suffix removed. */
function diffWindow(a: string, b: string): { a: string; b: string } {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { a: a.slice(p, a.length - s), b: b.slice(p, b.length - s) };
}

/** A slide counts as shown when it is laid out, painted and inside the viewport. */
const shownJs = `(sel, i) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.right > 1 && r.left < innerWidth - 1 && r.bottom > 1 && r.top < innerHeight - 1; };
  const all = [...document.querySelectorAll(sel)];
  return { target: all[i] ? vis(all[i]) : false, others: all.filter((e, k) => k !== i && vis(e)).length };
}`;

async function gotoSlide(d: Entry, i: number): Promise<void> {
  await expect(async () => {
    await c.page.getByTestId(`thumb-${i}`).click();
    await expect(c.page.getByTestId('slide-counter')).toHaveText(`Slide ${i + 1} of ${d.slides}`, { timeout: 1500 });
  }).toPass({ timeout: 15000 });
  await expect.poll(async () => {
    try { return (await deckFrame(c.page).evaluate(`(${shownJs})(${JSON.stringify(d.slideSelector)}, ${i})`) as { target: boolean }).target; } catch { return false; }
  }, { timeout: 10000, message: `slide ${i + 1} of ${d.file} is not shown in the live view` }).toBe(true);
}

for (const d of decks) {
  test.describe(d.file, () => {
    test('works by itself in a plain window (ground truth for the deck)', async () => {
      c = await launch(null);
      const errors: string[] = [];
      const winP = c.app.waitForEvent('window');
      await c.app.evaluate(({ BrowserWindow }, f) => { const w = new BrowserWindow({ width: 1280, height: 720, webPreferences: { sandbox: true } }); void w.loadFile(f); }, path.join(c.deckDir, d.file));
      const win = await winP;
      win.on('pageerror', (e) => errors.push(e.message));
      await win.waitForLoadState('load');
      await win.waitForTimeout(400);
      expect(await win.evaluate((sel) => document.querySelectorAll(sel).length, d.slideSelector)).toBe(d.slides);
      if (d.navKey && d.navProbe) {
        const seen = new Set<string>([String(await win.evaluate(d.navProbe))]);
        for (let i = 0; i < (d.navPresses ?? 3); i++) {
          await win.keyboard.press(d.navKey);
          await win.waitForTimeout(d.navWait ?? 150);
          seen.add(String(await win.evaluate(d.navProbe)));
        }
        expect(seen.size, `${d.navKey} must change what the deck shows: ${[...seen].join(' | ')}`).toBeGreaterThan(1);
      }
      expect(errors, 'the deck itself must run without errors').toEqual([]);
    });

    test('opens, shows every slide, keeps the file untouched, finds text, shows the source, plays the show', async () => {
      c = await launch(d.file);
      await ready(c.page);
      await expect(c.page.getByTestId('slide-counter')).toHaveText(`Slide 1 of ${d.slides}`, { timeout: 15000 });
      await expect(c.page.getByTestId('msgbar').filter({ hasText: 'Not sure' })).toHaveCount(0);
      const original = fs.readFileSync(c.file);
      await c.page.keyboard.press(`${MOD}+s`);
      await c.page.waitForTimeout(400);
      expect(fs.readFileSync(c.file).equals(original), 'a no-op save must be byte-identical').toBe(true);

      // every slide can be shown (long decks: a spread of them plus the last)
      const order = d.slides <= 12 ? Array.from({ length: d.slides }, (_, i) => i) : [...Array.from({ length: Math.floor(d.slides / 7) + 1 }, (_, i) => i * 7), d.slides - 1];
      for (const i of order) {
        await gotoSlide(d, i);
        const r = await deckFrame(c.page).evaluate(`(${shownJs})(${JSON.stringify(d.slideSelector)}, ${i})`) as { others: number };
        if (d.exclusive) expect(r.others, `only slide ${i + 1} may be visible`).toBe(0);
      }

      // thumbnails
      const n = d.thumbs ?? Math.min(d.slides, 8);
      for (let i = 0; i < n; i++) await expect(c.page.getByTestId(`timg-${i}`)).toBeVisible({ timeout: 45000 });
      // each thumbnail shows its own slide: identical pictures mean the capture did not reach the slide
      const srcs = await Promise.all(Array.from({ length: n }, (_, i) => c.page.getByTestId(`timg-${i}`).getAttribute('src')));
      expect(new Set(srcs).size, `thumbnails of ${d.file} must all differ`).toBe(n);

      // build steps
      if (d.steps) {
        const si = d.stepsSlide ?? 0;
        await gotoSlide(d, si);
        await c.page.getByTestId('dock-selection').click();
        await expect(c.page.getByTestId('stepbar')).toBeVisible();
        const later = await deckFrame(c.page).evaluate((args) => {
          const sl = document.querySelectorAll(args.sel)[args.i]!;
          return [...sl.querySelectorAll('[data-step],[data-fragment-index]')].filter((e) => Number(e.getAttribute('data-step') ?? e.getAttribute('data-fragment-index')) > 1).length;
        }, { sel: d.slideSelector, i: si });
        await c.page.getByTestId('step-1').click();
        await expect.poll(() => deckFrame(c.page).evaluate(() => document.querySelectorAll('[data-deckhand-future]').length)).toBe(later);
        await c.page.getByTestId('step-all').click();
        await expect.poll(() => deckFrame(c.page).evaluate(() => document.querySelectorAll('[data-deckhand-future]').length)).toBe(0);
      }

      // find
      await c.page.keyboard.press(`${MOD}+f`);
      await c.page.getByTestId('find-query').fill(d.find);
      await expect(c.page.getByTestId('find-count')).toContainText(/\d+ of \d+/);
      await c.page.keyboard.press('Escape');

      // source view shows the real file
      await c.page.getByTestId('tab-view').click();
      await c.page.getByTestId('view-split').click();
      await expect.poll(async () => ((await c.page.locator('.cm-content').textContent()) ?? '').length, { message: 'the source view shows the file' }).toBeGreaterThan(80);
      await c.page.getByTestId('view-normal').click();

      // slide show: plain deck without editor artifacts
      await gotoSlide(d, Math.min(1, d.slides - 1));
      await c.page.keyboard.press('Shift+F5');
      await expect.poll(() => c.app.windows().filter((w) => w !== c.page && w.url().startsWith('deckhand-doc://')).length, { timeout: 20000 }).toBeGreaterThan(0);
      const show = c.app.windows().find((w) => w !== c.page && w.url().startsWith('deckhand-doc://'))!;
      await show.waitForLoadState('load');
      expect(await show.evaluate(() => document.documentElement.outerHTML.includes('data-deckhand'))).toBe(false);
      await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.isFullScreen() || x.getTitle() === 'Slide Show'); w?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); });
      await expect.poll(() => c.app.windows().filter((w) => w !== c.page && !w.isClosed() && w.url().startsWith('deckhand-doc://')).length, { timeout: 15000 }).toBe(0);
      expect(fs.readFileSync(c.file).equals(original), 'looking around must never touch the file').toBe(true);
    });

    test('edits: text, move, slides — minimal diffs and exact undo', async () => {
      c = await launch(d.file);
      await ready(c.page);
      await expect(c.page.getByTestId('slide-counter')).toHaveText(`Slide 1 of ${d.slides}`, { timeout: 15000 });
      const original = fs.readFileSync(c.file);
      const orig8 = original.toString('utf8');

      // 1. text edit on the editSlide
      await gotoSlide(d, d.editSlide ?? 0);
      const t = await centreOf(c.page, d.editText);
      await editAt(c.page, t.x, t.y);
      await c.page.keyboard.press(`${MOD}+a`);
      await c.page.keyboard.type('BENCH EDIT');
      await c.page.keyboard.press('Escape');
      await c.page.waitForTimeout(500);
      await save(c.page);
      const edited = read8();
      const w1 = diffWindow(orig8, edited);
      expect(edited, 'typed text reaches the file').toContain('BENCH EDIT');
      expect(w1.a.length, `text edit rewrote too much: "${w1.a.slice(0, 120)}"`).toBeLessThan(400);
      expect(w1.b.length).toBeLessThan(400);
      expect(edited).not.toMatch(/data-deckhand|contenteditable/);
      await c.page.keyboard.press(`${MOD}+z`);
      await c.page.waitForTimeout(800);
      await save(c.page);
      expect(fs.readFileSync(c.file).equals(original), 'undo of the text edit restores every byte').toBe(true);

      // 2. move an object: only style attributes may change
      await gotoSlide(d, d.moveSlide);
      await clickObj(c.page, d.moveSel);
      await dragObj(c.page, d.moveSel, 50, 30);
      await save(c.page);
      const moved = read8();
      expect(moved, 'the drag changed the file').not.toBe(orig8);
      expect(strip(moved), 'a move may only change style attributes').toBe(strip(orig8));
      expect(moved).not.toMatch(/data-deckhand|contenteditable/);
      await c.page.keyboard.press(`${MOD}+z`);
      await c.page.waitForTimeout(800);
      await save(c.page);
      expect(fs.readFileSync(c.file).equals(original), 'undo of the move restores every byte').toBe(true);

      // 3. duplicate and delete a slide, undo both
      await c.page.getByTestId('cmd-dup-slide').click();
      await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(d.slides + 1, { timeout: 10000 });
      await c.page.keyboard.press(`${MOD}+z`);
      await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(d.slides, { timeout: 10000 });
      await c.page.waitForTimeout(800);
      await c.page.getByTestId('cmd-del-slide').click();
      await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(d.slides - 1, { timeout: 10000 });
      await c.page.keyboard.press(`${MOD}+z`);
      await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(d.slides, { timeout: 10000 });
      await c.page.waitForTimeout(800);
      await save(c.page);
      expect(fs.readFileSync(c.file).equals(original), 'duplicate, delete and their undo restore every byte').toBe(true);
    });

    test('inserts text box, shape, table, icon on a slide: pure insertions, inside the slide, each undone exactly', async () => {
      c = await launch(d.file);
      await ready(c.page);
      const original = fs.readFileSync(c.file);
      const orig8 = original.toString('utf8');
      await gotoSlide(d, d.moveSlide);
      const inSlide = (): Promise<number> => deckFrame(c.page).evaluate((a) => document.querySelectorAll(a.sel)[a.i]!.querySelectorAll('*').length, { sel: d.slideSelector, i: d.moveSlide });
      const base = await inSlide();
      await c.page.getByTestId('tab-insert').click();
      const steps: [string, () => Promise<void>][] = [
        ['text box', async () => { await c.page.getByTestId('cmd-textbox').click(); }],
        ['shape', async () => { await c.page.getByTestId('cmd-shapes').click(); await c.page.getByTestId('shape-ellipse').click(); }],
        ['table', async () => { await c.page.getByTestId('cmd-table').click(); await c.page.getByTestId('table-2x2').click(); }],
        ['icon', async () => { await c.page.getByTestId('cmd-icons').click(); await c.page.getByTestId('icon-star').click(); }],
      ];
      for (const [name, run] of steps) {
        await run();
        await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
        await expect.poll(async () => { try { return await inSlide(); } catch { return base; } }, { timeout: 15000, message: name + ' appears in the slide' }).toBeGreaterThan(base);
        await save(c.page);
        // a static slide also gets `position: relative` so the new object can be placed in it: ignore style attributes for the insertion check
        const w = diffWindow(strip(orig8), strip(read8()));
        expect(w.a, name + ' is a pure insertion').toBe('');
        expect(w.b.length, name + ' insertion size').toBeLessThan(2500);
        expect(read8()).not.toMatch(/data-deckhand|contenteditable/);
        await c.page.getByTestId('qat-undo').click();
        await c.page.waitForTimeout(800);
        await save(c.page).catch(() => undefined);
        expect(fs.readFileSync(c.file).equals(original), name + ': undo restores every byte').toBe(true);
        await ready(c.page);
      }
    });

    test('arranges: rename, hide and lock from the Selection pane, format from the ribbon, each undone exactly', async () => {
      c = await launch(d.file);
      await ready(c.page);
      const original = fs.readFileSync(c.file);
      await gotoSlide(d, d.moveSlide);
      await clickObj(c.page, d.moveSel);
      await c.page.getByTestId('dock-selection').click();
      const row = c.page.getByTestId('sel-item').filter({ has: c.page.locator('.on, [aria-current=true]') }).first();
      await expect(c.page.locator('[data-testid=sel-item][aria-current=true]').first()).toBeVisible({ timeout: 8000 });
      const sel = c.page.locator('[data-testid=sel-item][aria-current=true]').first();
      void row;
      await sel.getByTestId('sel-lock').click();
      await sel.getByTestId('sel-eye').click();
      await save(c.page);
      const arranged = read8();
      expect(arranged).toMatch(/data-deckhand-locked/);
      expect(arranged).toMatch(/display: ?none/);
      await c.page.keyboard.press(`${MOD}+z`);
      await c.page.waitForTimeout(500);
      await c.page.keyboard.press(`${MOD}+z`);
      await c.page.waitForTimeout(800);
      await save(c.page).catch(() => undefined);
      expect(fs.readFileSync(c.file).equals(original), 'undo of hide and lock restores every byte').toBe(true);
      await ready(c.page);
      // ribbon formatting of the object
      await clickObj(c.page, d.moveSel);
      await c.page.getByTestId('dock-format').click();
      await c.page.getByTestId('txt-center').click();
      await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
      await save(c.page);
      const w = diffWindow(original.toString('utf8'), read8());
      expect(w.b.length, 'a text-alignment change is a small style edit').toBeLessThan(300);
      await c.page.keyboard.press(`${MOD}+z`);
      await c.page.waitForTimeout(800);
      await save(c.page).catch(() => undefined);
      expect(fs.readFileSync(c.file).equals(original), 'undo of the format restores every byte').toBe(true);
    });

    if (d.frames) {
      const fr = d.frames;
      test('expands the script-built animation and edits its text in the script', async () => {
        c = await launch(d.file);
        await ready(c.page);
        const original = fs.readFileSync(c.file);
        await gotoSlide(d, fr.slide);
        await c.page.getByTestId('dock-frames').click();
        await c.page.getByTestId('frames-start').click();
        await expect(c.page.getByTestId('frame-label')).toContainText(/Frame \d{2,} of \d{2,}/, { timeout: 20000 });
        await c.page.getByTestId('frame-prev').click();
        await expect(c.page.getByTestId('frame-label')).toContainText(/Frame \d{2,} of/, { timeout: 15000 });
        await c.page.getByTestId('frame-next').click();
        const line = c.page.locator('input[data-testid=frame-text]').and(c.page.locator(`input[value="${fr.literal}"]`));
        await expect(line).toHaveCount(1, { timeout: 15000 });
        await line.fill(fr.replacement);
        await line.blur();
        await expect.poll(async () => { try { return await deckFrame(c.page).evaluate((s) => document.body.innerText.includes(s), fr.replacement); } catch { return false; } }, { timeout: 15000 }).toBe(true);
        await save(c.page);
        expect(read8()).toContain(fr.replacement);
        expect(read8()).not.toMatch(/data-deckhand|contenteditable/);
        await c.page.keyboard.press(`${MOD}+z`);
        await c.page.waitForTimeout(800);
        await save(c.page);
        expect(fs.readFileSync(c.file).equals(original), 'undo restores every byte').toBe(true);
      });
    }

    if (d.slides <= 10) {
      test('exports a PDF with one page per slide', async () => {
        c = await launch(d.file);
        await ready(c.page);
        const out = path.join(os.tmpdir(), `dh-bench-${Date.now()}.pdf`);
        await c.app.evaluate(({ dialog }, f) => { (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: f }); }, out);
        await c.page.getByTestId('tab-file').click();
        await c.page.getByTestId('cmd-pdf').click();
        await expect.poll(() => fs.existsSync(out) && fs.statSync(out).size > 1000, { timeout: 90000 }).toBe(true);
        const pdf = await PDFDocument.load(fs.readFileSync(out));
        fs.rmSync(out, { force: true });
        expect(pdf.getPageCount()).toBe(d.slides);
      });
    }
  });
}
