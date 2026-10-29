import { expect, test } from '@playwright/test';
import { deckFrame, expectEditing, launch, MOD, ready, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

/** Diagnostic: where do keystrokes go after "Insert text box" starts editing? (CI only; prints, never fails on values) */
test('focus diagnostic', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.evaluate(`(() => { const log = (window.__plog = []); const t0 = performance.now(); const act = () => document.activeElement && (document.activeElement.tagName + '.' + (document.activeElement.getAttribute('data-testid') || '')); for (const n of ['keydown', 'focusin', 'focusout']) document.addEventListener(n, (e) => log.push(Math.round(performance.now() - t0) + 'ms ' + n + ':' + (e.key || '') + ' tgt=' + (e.target && e.target.tagName) + ' act=' + act()), true); window.addEventListener('blur', () => log.push(Math.round(performance.now() - t0) + 'ms win-blur')); window.addEventListener('focus', () => log.push(Math.round(performance.now() - t0) + 'ms win-focus')); window.__t0 = t0; window.__act = act; })()`);
  await c.page.getByTestId('tab-insert').click();
  await c.page.getByTestId('cmd-textbox').click();
  await expectEditing(c.page);
  await c.page.evaluate(`window.__plog.push('--- edit visible act=' + window.__act())`);
  await c.page.keyboard.press(`${MOD}+a`);
  for (const ch of 'Hey') { await c.page.keyboard.press(ch); await c.page.waitForTimeout(80); }
  const pl = await c.page.evaluate('window.__plog') as string[];
  const fr = await deckFrame(c.page).evaluate(() => ({ focus: document.hasFocus(), active: document.activeElement?.tagName, ed: document.querySelector('[data-deckhand-editing]')?.textContent }));
  console.log(`[diag ${process.platform}] PARENT\n${pl.join('\n')}\n[diag ${process.platform}] frame=${JSON.stringify(fr)}`);
  expect(true).toBe(true);
});
