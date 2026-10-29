import { expect, test } from '@playwright/test';
import { centreOf, deckFrame, editAt, launch, MOD, ready, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

/** Diagnostic: which keystrokes after entering text edit mode reach the edited element, and when? (CI only; prints, never fails on values) */
test('focus diagnostic', async () => {
  c = await launch('latin1-crlf.html');
  await ready(c.page);
  const t = await centreOf(c.page, 'section.slide h1');
  await editAt(c.page, t.x, t.y);
  const probe = `(() => {
    const log = (window.__dlog = []); const t0 = performance.now();
    const add = (m) => log.push(Math.round(performance.now() - t0) + 'ms ' + m + ' focus=' + document.hasFocus() + ' act=' + (document.activeElement && document.activeElement.tagName));
    for (const n of ['keydown', 'beforeinput', 'input', 'focus', 'blur', 'selectionchange']) document.addEventListener(n, (e) => add(n + ':' + (e.key || e.data || '')), true);
    window.addEventListener('focus', () => add('win-focus')); window.addEventListener('blur', () => add('win-blur'));
  })()`;
  await deckFrame(c.page).evaluate(probe);
  await c.page.evaluate(`(() => { const log = (window.__plog = []); const t0 = performance.now(); for (const n of ['keydown', 'focusin', 'focusout']) document.addEventListener(n, (e) => log.push(Math.round(performance.now() - t0) + 'ms ' + n + ':' + (e.key || '') + ' tgt=' + (e.target && e.target.tagName)), true); window.addEventListener('blur', () => log.push('win-blur')); window.addEventListener('focus', () => log.push('win-focus')); })()`);
  await c.page.keyboard.press(`${MOD}+a`);
  for (const ch of 'Creme') { await c.page.keyboard.press(ch); await c.page.waitForTimeout(80); }
  await c.page.waitForTimeout(1500);
  for (const ch of 'XY') { await c.page.keyboard.press(ch); await c.page.waitForTimeout(80); }
  const fl = await deckFrame(c.page).evaluate('window.__dlog') as string[];
  const pl = await c.page.evaluate('window.__plog') as string[];
  console.log(`[diag ${process.platform}] FRAME\n${fl.join('\n')}`);
  console.log(`[diag ${process.platform}] PARENT\n${pl.join('\n')}`);
  console.log(`[diag ${process.platform}] title=${await deckFrame(c.page).evaluate(() => document.querySelector('section.slide h1')!.textContent)}`);
  expect(true).toBe(true);
});
