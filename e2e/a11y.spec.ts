/** Accessibility pass: axe-core on the editor's own interface (the deck inside the live view is the author's content, not ours). */
import { expect, test, type Page } from '@playwright/test';

import { launch, ready, type Ctx } from './helpers';

const axeSource: string = (require('axe-core') as { source: string }).source;

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

interface Violation { id: string; help: string; impact: string | null; nodes: { target: string[]; failureSummary?: string }[] }

/** axe runs inside the page (a CDP evaluate, so the editor's strict CSP does not apply). */
async function audit(page: Page, where: string): Promise<void> {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: unknown[] }> } }).axe;
    const r = await axe.run({ exclude: [['iframe']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    return r.violations;
  }) as Violation[];
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' ' + (n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 200)).join(' | ')}`), `accessibility problems in ${where}`).toEqual([]);
}

test('welcome screen, tour and Help have no serious accessibility problems', async () => {
  c = await launch(null);
  await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 640)); // small screens (CI) make more regions scroll
  await expect(c.page.getByTestId('onboarding')).toBeVisible();
  await audit(c.page, 'welcome screen');
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('bs-help').click();
  await expect(c.page.getByTestId('help')).toBeVisible();
  await audit(c.page, 'Help');
  await c.page.getByTestId('bs-options').click();
  await audit(c.page, 'Options');
});

for (const theme of ['light', 'dark'] as const) test(`the editor with a deck, ${theme} theme: every tab and pane`, async () => {
  c = await launch('bench/dashboard.html');
  await c.app.evaluate(({ BrowserWindow, nativeTheme }, th) => { nativeTheme.themeSource = th; BrowserWindow.getAllWindows()[0]!.setSize(1100, 640); }, theme);
  await ready(c.page);
  await audit(c.page, 'Home');
  for (const t of ['insert', 'design', 'show', 'view']) { await c.page.getByTestId(`tab-${t}`).click(); await audit(c.page, `${t} tab`); }
  for (const d of ['selection', 'frames', 'format', 'ai']) { await c.page.getByTestId(`dock-${d}`).click(); await audit(c.page, `${d} pane`); }
  await c.page.getByTestId('tab-file').click();
  await audit(c.page, 'File > Info');
  await c.page.getByTestId('bs-history').click();
  await audit(c.page, 'File > Version History');
});
