import { expect, test } from '@playwright/test';
import { centreOf, deckFrame, launch, ready, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

/** Diagnostic: where does keyboard focus live after entering text edit mode? (CI only; prints, never fails on values) */
test('focus diagnostic', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  const snap = async (label: string) => {
    const parent = await c.page.evaluate(() => ({ focus: document.hasFocus(), active: document.activeElement?.tagName }));
    const frame = await deckFrame(c.page).evaluate(() => ({
      focus: document.hasFocus(), active: `${document.activeElement?.tagName}.${document.activeElement?.className}`, sel: String(getSelection()),
      title: document.querySelector('.slide.active .title')!.textContent,
    }));
    console.log(`[diag ${process.platform}] ${label} parent=${JSON.stringify(parent)} frame=${JSON.stringify(frame)}`);
  };
  const t = await centreOf(c.page, '.slide.active .title');
  await c.page.mouse.dblclick(t.x, t.y);
  try {
    await expect(c.page.locator('.outline.edit')).toBeVisible({ timeout: 8000 });
  } catch (err) {
    const fr = await deckFrame(c.page).evaluate(() => ({
      ce: document.querySelector('.slide.active .title')?.getAttribute('contenteditable'), edAttr: document.querySelector('[data-deckhand-editing]') !== null,
      focus: document.hasFocus(), active: document.activeElement?.tagName,
    }));
    const ui = await c.page.evaluate(() => ({ text: document.body.innerText.slice(0, 400), outlines: [...document.querySelectorAll('.outline')].map((o) => o.className), active: document.activeElement?.tagName }));
    console.log(`[diag ${process.platform}] EDIT NEVER READY frame=${JSON.stringify(fr)} ui=${JSON.stringify(ui)}`);
    // is it a race? try again after the first attempt settled
    await c.page.mouse.dblclick(t.x, t.y);
    await c.page.waitForTimeout(3000);
    console.log(`[diag ${process.platform}] retry outline=${await c.page.locator('.outline.edit').count()}`);
    throw err;
  }
  await snap('after edit-ready');
  await c.page.keyboard.press('End');
  await c.page.keyboard.type('abc');
  await snap('typed abc immediately');
  await c.page.waitForTimeout(1500);
  await snap('after 1.5s');
  await c.page.keyboard.type('def');
  await snap('typed def after wait');
  await c.page.keyboard.press('Control+a');
  await c.page.keyboard.press('Meta+a');
  await snap('after select-all attempts');
  await c.page.keyboard.insertText('XYZ');
  await snap('after insertText');
});
