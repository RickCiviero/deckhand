// Regenerates the screenshots used by README.md from the built app. Usage: npm run build && node scripts/readme-shots.mjs
// The AI shot talks to a scripted local "model", never to a real provider.
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'images');
fs.mkdirSync(outDir, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-shots-'));
const deck = path.join(tmp, 'quarterly-review.html');
fs.copyFileSync(path.join(root, 'docs', 'demo', 'quarterly-review.html'), deck);

// scripted OpenAI-compatible model: read slide 1, shorten the headline, report
const srv = createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    const last = body.messages.at(-1);
    const lastAssistant = [...body.messages].reverse().find((m) => m.role === 'assistant');
    if (/single word OK/.test(body.messages[0].content ?? '')) send({ content: 'OK' });
    else if (last.role === 'user') send({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_slide', arguments: '{"slide":1}' } }] });
    else if (lastAssistant?.tool_calls?.[0]?.function.name === 'get_slide') {
      const ref = /<h1[^>]*data-ref="(o\d+)"/.exec(JSON.parse(last.content).html)[1];
      send({ tool_calls: [{ index: 0, id: 'c2', function: { name: 'set_text', arguments: JSON.stringify({ ref, html: 'Revenue grew 18%' }) } }] });
    } else send({ content: 'I shortened the headline on slide 1 to "Revenue grew 18%". Nothing else changed.' });
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const modelUrl = `http://127.0.0.1:${srv.address().port}/v1`;

const app = await electron.launch({ args: [path.join(root, 'apps/desktop'), `--user-data-dir=${path.join(tmp, 'ud')}`, deck] });
const page = await app.firstWindow();
await page.waitForSelector('[data-testid=live-view]');
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1600, 940); w.center(); });
await page.waitForTimeout(3000);
const frame = () => page.frames().find((f) => f.url().startsWith('deckhand-doc://'));

async function clickInDeck(selector) {
  for (let i = 0; i < 5; i++) {
    const r = await frame().evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, vw: innerWidth }; }, selector);
    const ov = await page.locator('[data-testid=overlay]').boundingBox();
    const z = ov.width / r.vw;
    await page.mouse.click(ov.x + r.x * z, ov.y + r.y * z);
    try { await page.locator('[data-testid=path] button').first().waitFor({ timeout: 2500 }); break; } catch { /* retry */ }
  }
  await page.waitForTimeout(500);
}
const shot = async (name) => { await page.mouse.move(700, 925); await page.waitForTimeout(900); // park the pointer on the status bar: no hover outline, no tooltip
  await page.screenshot({ path: path.join(outDir, name) }); console.log('saved', name); };

// 1. editing: an object selected, Format pane open, thumbnails on the left
await clickInDeck('.slide.active .pill');
await shot('editor.png');

// 2. Selection pane + a hidden object
await page.getByTestId('dock-selection').click();
await shot('selection-pane.png');
await page.getByTestId('dock-format').click();

// 3. code view next to the slide
await page.getByTestId('tab-view').click();
await page.getByTestId('view-split').click();
await page.waitForTimeout(800);
await shot('code-split.png');
await page.getByTestId('view-normal').click();
await page.evaluate(() => document.querySelector('[data-testid=tab-home]').click()); // the tab strip is still re-laying out after the view change, so a pointer click is not 'stable'
await page.keyboard.press('Escape');

// 4. AI Assistant
await page.getByTestId('dock-ai').click();
await page.getByLabel('Provider').selectOption({ label: 'Ollama (this computer)' });
await page.getByLabel('Address').fill(modelUrl);
await page.getByTestId('ai-model').fill('demo-model');
await page.getByTestId('ai-save').click();
await page.getByTestId('ai-input').waitFor({ timeout: 15000 });
await page.getByTestId('ai-input').fill('Make the headline on slide 1 shorter');
await page.getByTestId('ai-send').click();
await page.getByTestId('ai-card').waitFor({ timeout: 20000 });
await shot('ai-assistant.png');

await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
srv.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder; the OS temp cleaner takes it */ }
