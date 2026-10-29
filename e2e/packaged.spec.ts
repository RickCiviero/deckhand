import { expect, test } from '@playwright/test';
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DECKS, ROOT, clickObj, dragObj, launch, ready, save } from './helpers';

const exe = path.join(ROOT, 'apps/desktop/release/win-unpacked/Deckhand.exe');
// Playwright attaches through Node's inspector, which the production build disables with a fuse; this variant only relaxes that one fuse.
const testExe = path.join(ROOT, 'apps/desktop/release-test/win-unpacked/Deckhand.exe');
test.skip(!fs.existsSync(exe), 'packaged build not present (run `npm run dist` first)');

test('packaged app: fuses are set as configured', async () => {
  const wire = await getCurrentFuseWire(exe);
  expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableCookieEncryption]).toBe(FuseState.ENABLE);
  expect(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(FuseState.ENABLE);
  expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE);
});

test('packaged app: ELECTRON_RUN_AS_NODE cannot turn the binary into a Node interpreter', () => {
  let out = '';
  try { out = execFileSync(exe, ['-e', 'console.log("NODE-RAN")'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 8000, encoding: 'utf8' }); } catch { /* app may refuse / exit */ }
  expect(out).not.toContain('NODE-RAN');
});

test('packaged app: open, drag, save produces a minimal diff', async () => {
  test.skip(!fs.existsSync(testExe), 'test variant not built');
  const c = await launch('ai-fixed-stage.html', testExe);
  try {
    await ready(c.page);
    await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 3');
    await clickObj(c.page, '.logo');
    await dragObj(c.page, '.logo', -90, 50);
    await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Unsaved changes');
    await save(c.page);
    const out = c.text();
    const orig = fs.readFileSync(path.join(DECKS, 'decks', 'ai-fixed-stage.html'), 'latin1');
    const m = /<div class="logo" style="([^"]*)"><\/div>/.exec(out);
    expect(m).not.toBeNull();
    expect(out.replace(` style="${m![1]}"`, '')).toBe(orig);
    // DevTools shortcuts are disabled in packaged builds
    await c.page.keyboard.press('F12');
    await c.page.waitForTimeout(500);
    expect(c.app.windows()).toHaveLength(1);
  } finally { await c.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); }
});
