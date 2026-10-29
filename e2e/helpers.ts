import { _electron as electron, expect, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..');
export const DECKS = path.join(ROOT, 'test-decks');

export interface Ctx { app: ElectronApplication; page: Page; dir: string; deckDir: string; file: string; userData: string; read: () => Buffer; text: () => string }

/** Copies the corpus into a temp folder (tests modify files) and opens one deck in a fresh app instance. */
export async function launch(deck: string | null): Promise<Ctx> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-e2e-'));
  fs.cpSync(DECKS, dir, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ud-'));
  const deckDir = path.join(dir, 'decks');
  const file = deck ? path.join(deckDir, deck) : '';
  const args = [path.join(ROOT, 'apps/desktop'), `--user-data-dir=${userData}`];
  if (deck) args.push(file);
  const app = await electron.launch({ args });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=app]');
  if (deck) await page.waitForSelector('[data-testid=live-view]');
  return { app, page, dir, deckDir, file, userData, read: () => fs.readFileSync(file), text: () => fs.readFileSync(file, 'latin1') };
}

export const deckFrame = (page: Page): Frame => {
  const f = page.frames().find((x) => x.url().startsWith('deckhand-doc://'));
  if (!f) throw new Error('live view frame not found');
  return f;
};

/** Wait until the agent handshake finished (overlay can hit-test). */
export async function ready(page: Page): Promise<void> {
  await expect(async () => {
    const f = deckFrame(page);
    // the agent removes its own script tag after setup; presence of the editor id attribute means live html is in place
    expect(await f.evaluate(() => document.querySelectorAll('[data-deckhand-id]').length)).toBeGreaterThan(0);
  }).toPass({ timeout: 15000 });
  await page.waitForTimeout(600);
}

/** Centre of an element of the deck, in page coordinates (accounts for canvas zoom). */
export async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number; z: number }> {
  const f = deckFrame(page);
  const r = await f.evaluate((sel) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth }; }, selector);
  const ov = (await page.locator('[data-testid=overlay]').boundingBox())!;
  const z = ov.width / r.vw;
  return { x: ov.x + (r.x + r.w / 2) * z, y: ov.y + (r.y + r.h / 2) * z, w: r.w * z, h: r.h * z, z };
}

export async function clickObj(page: Page, selector: string): Promise<void> {
  // retry: the very first click can arrive before the agent finished its handshake and hit-testing is not yet available
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = await centreOf(page, selector);
    await page.mouse.click(c.x, c.y);
    try {
      await expect(page.locator('[data-testid=path] button').first()).toBeVisible({ timeout: 1500 });
      break;
    } catch { /* try again */ }
  }
  await page.waitForTimeout(400);
}

export async function dragObj(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const c = await centreOf(page, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const steps = 8;
  for (let i = 1; i <= steps; i++) { await page.mouse.move(c.x + (dx * i) / steps, c.y + (dy * i) / steps); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

export async function save(page: Page): Promise<void> {
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-testid=savestate]')).toHaveText('Saved', { timeout: 10000 });
}

export const norm = (s: string): string => s.replace(/\r\n/g, '\n');
