import { _electron as electron, expect, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..');
export const DECKS = path.join(ROOT, 'test-decks');

export interface Ctx { app: ElectronApplication; page: Page; dir: string; deckDir: string; file: string; userData: string; read: () => Buffer; text: () => string }

/** Copies the corpus into a temp folder (tests modify files) and opens one deck in a fresh app instance. */
export async function launch(deck: string | null, exeArg?: string): Promise<Ctx> {
  const exe = exeArg ?? process.env['DECKHAND_EXE']; // DECKHAND_EXE=<packaged test build> reruns any suite against the installer's payload
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-e2e-'));
  fs.cpSync(DECKS, dir, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ud-'));
  const deckDir = path.join(dir, 'decks');
  const file = deck ? path.join(deckDir, deck) : '';
  const args = exe ? [`--user-data-dir=${userData}`] : [path.join(ROOT, 'apps/desktop'), `--user-data-dir=${userData}`];
  if (process.platform === 'linux' && process.env['CI']) args.push('--no-sandbox'); // CI containers lack the SUID chrome-sandbox helper
  if (deck) args.push(file);
  const env = { ...process.env, DECKHAND_NO_BROWSER: '1' } as Record<string, string>; // Preview in Browser must not start a real browser during tests
  const app = await electron.launch(exe ? { executablePath: exe, args, env } : { args, env });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=app]');
  // CI desktops (xvfb without a window manager, a mac runner with no active app) never focus the window; an unfocused page gets keys late or not at all
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w?.show(); w?.focus(); w?.webContents.focus(); }).catch(() => undefined);
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
  // the agent handshake (private port) finishes after the page loads; interacting earlier loses clicks, and a failed handshake triggers a reload
  await expect(page.locator('[data-testid=canvas][data-agent-ready="1"]')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
}

/** Centre of an element of the deck, in page coordinates (accounts for canvas zoom). */
export async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number; z: number }> {
  // the live view is rebuilt after structural edits (rename, hide…), so the frame can be briefly missing or navigating
  let r!: { x: number; y: number; w: number; h: number; vw: number };
  await expect(async () => {
    r = await deckFrame(page).evaluate((sel) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth }; }, selector);
  }).toPass({ timeout: 15000 });
  const ov = (await page.locator('[data-testid=overlay]').boundingBox())!;
  const z = ov.width / r.vw;
  return { x: ov.x + (r.x + r.w / 2) * z, y: ov.y + (r.y + r.h / 2) * z, w: r.w * z, h: r.h * z, z };
}

export async function clickObj(page: Page, selector: string): Promise<void> {
  // retry: the very first click can arrive before the agent finished its handshake, and a late live-view rebuild can drop the selection just after it
  const path = page.locator('[data-testid=path] button').first();
  for (let attempt = 0; attempt < 6; attempt++) {
    const c = await centreOf(page, selector);
    await page.mouse.click(c.x, c.y);
    try {
      await expect(path).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(500);
      if (await path.isVisible()) return; // the selection survived the settle time
    } catch { /* try again */ }
  }
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
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.locator('[data-testid=savestate]')).toHaveText('Saved', { timeout: 10000 });
}

/** The platform's shortcut modifier (Playwright sends the literal key: Control+A is not select-all on macOS). */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Double-click to enter text editing; retries because the first click can land before the agent's hit-testing is up. */
export async function editAt(page: Page, x: number, y: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.mouse.dblclick(x, y);
    try { await expectEditing(page, 3000); return; } catch { await page.waitForTimeout(500); }
  }
  await expectEditing(page, 5000);
}

/** Waits for the text-edit outline, then a short settle: on Linux the browser process routes keys to the frame a beat after the page reports focus. */
export async function expectEditing(page: Page, timeout = 8000): Promise<void> {
  await expect(page.locator('.outline.edit')).toBeVisible({ timeout });
  await page.waitForTimeout(400);
}

export const norm =(s: string): string => s.replace(/\r\n/g, '\n');
