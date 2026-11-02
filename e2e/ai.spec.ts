import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { DECKS, launch, ready, save, type Ctx } from './helpers';

let c: Ctx;
let srv: Server | null = null;
test.afterEach(async () => {
  await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  srv?.close();
});

const original = (name: string): string => fs.readFileSync(path.join(DECKS, 'decks', name), 'latin1');

/** Minimal OpenAI-compatible server that plays one scripted conversation: read slide 1, retitle it, finish. */
async function mockModel(requests: unknown[], delayMs = 0): Promise<string> {
  srv = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => setTimeout(() => {
      const body = JSON.parse(b || '{}') as { messages: { role: string; content?: string; tool_calls?: { function: { name: string } }[] }[] };
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: object): boolean => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      const last = body.messages.at(-1)!;
      if (/single word OK/.test(body.messages[0]!.content ?? '')) send({ content: 'OK' });
      else if (last.role === 'user') send({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_slide', arguments: '{"slide":1}' } }] });
      else if (body.messages.findLast((m) => m.role === 'assistant')?.tool_calls?.[0]?.function.name === 'get_slide') {
        const html = (JSON.parse(last.content!) as { html: string }).html;
        const ref = /<h1[^>]*data-ref="(o\d+)"/.exec(html)![1];
        send({ tool_calls: [{ index: 0, id: 'c2', function: { name: 'set_text', arguments: JSON.stringify({ ref, html: 'Edited by AI' }) } }] });
      } else send({ content: 'Retitled slide 1.' });
      res.end('data: [DONE]\n\n');
    }, delayMs));
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(srv!.address() as { port: number }).port}/v1`;
}

test('AI Assistant: connect, ask for a change, one Undo reverts it, the model sees only the AI view', async () => {
  const requests: unknown[] = [];
  const url = await mockModel(requests);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('dock-ai').click();
  await expect(c.page.getByTestId('ai-form')).toBeVisible();
  await c.page.getByLabel('Provider').selectOption({ label: 'Ollama (this computer)' });
  await c.page.getByLabel('Address').fill(url);
  await c.page.getByTestId('ai-model').fill('mock-model');
  await c.page.getByTestId('ai-save').click();
  await expect(c.page.getByTestId('ai-input')).toBeVisible({ timeout: 15000 });

  await c.page.getByTestId('ai-input').fill('Retitle slide 1');
  await c.page.getByTestId('ai-send').click();
  await expect(c.page.getByTestId('ai-card')).toBeVisible({ timeout: 20000 });
  await expect(c.page.getByTestId('ai-card')).toContainText('Slide 1');
  await expect(c.page.locator('[data-testid=thumb-0]')).toContainText('Edited by AI');
  await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Unsaved changes');
  await expect(c.page.getByTestId('qat-undo')).toBeEnabled();

  // the model saw the AI view (refs), never editor ids or the file path
  const first = JSON.stringify(requests.find((r) => (r as { messages: { content?: string }[] }).messages.some((m) => m.content?.includes('data-ref'))));
  expect(first).toContain('data-ref');
  expect(first).not.toContain('data-deckhand-id');

  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').replace('Quarterly Review', 'Edited by AI'));

  await c.page.getByTestId('ai-undo').click();
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html'));
});

test('AI Assistant in Ask mode cannot change the deck', async () => {
  const requests: unknown[] = [];
  const url = await mockModel(requests);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('dock-ai').click();
  await c.page.getByLabel('Provider').selectOption({ label: 'Ollama (this computer)' });
  await c.page.getByLabel('Address').fill(url);
  await c.page.getByTestId('ai-model').fill('mock-model');
  await c.page.getByTestId('ai-save').click();
  await expect(c.page.getByTestId('ai-input')).toBeVisible({ timeout: 15000 });
  await c.page.getByTestId('ai-mode').selectOption('ask');
  await c.page.getByTestId('ai-input').fill('Retitle slide 1');
  await c.page.getByTestId('ai-send').click();
  await expect(c.page.locator('.aimsg.step').filter({ hasText: /set_text.*Unknown tool/ })).toBeVisible({ timeout: 20000 });
  await expect(c.page.locator('[data-testid=savestate]')).toHaveText('Saved');
  expect(c.text()).toBe(original('ai-fixed-stage.html'));
});

test('connection addresses must be https (or this computer)', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('dock-ai').click();
  await c.page.getByLabel('Address').fill('http://example.com/v1');
  await c.page.getByTestId('ai-model').fill('m');
  await c.page.getByTestId('ai-save').click();
  await expect(c.page.getByRole('alert')).toContainText('https://');
});

async function connect(url: string): Promise<void> {
  await c.page.getByTestId('dock-ai').click();
  await c.page.getByLabel('Provider').selectOption({ label: 'Ollama (this computer)' });
  await c.page.getByLabel('Address').fill(url);
  await c.page.getByTestId('ai-model').fill('mock-model');
  await c.page.getByTestId('ai-save').click();
  await expect(c.page.getByTestId('ai-input')).toBeVisible({ timeout: 15000 });
}

test('AI Assistant: undo one slide of a turn restores only that slide', async () => {
  const url = await mockModel([]);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await connect(url);
  await c.page.getByTestId('ai-input').fill('Retitle slide 1');
  await c.page.getByTestId('ai-send').click();
  await expect(c.page.getByTestId('ai-card')).toBeVisible({ timeout: 20000 });
  await c.page.getByTestId('ai-undo-slide').click();
  await expect(c.page.getByTestId('thumb-0')).toContainText('Quarterly Review', { timeout: 10000 });
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html'));
});

test('AI Assistant: with "Ask before applying" nothing changes until Apply; Discard drops it', async () => {
  const url = await mockModel([]);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('tab-file').click();
  await c.page.getByTestId('bs-options').click();
  await c.page.getByTestId('opt-ai-ask').check();
  await c.page.getByTestId('bs-back').click();
  await connect(url);

  await c.page.getByTestId('ai-input').fill('Retitle slide 1');
  await c.page.getByTestId('ai-send').click();
  await expect(c.page.getByTestId('ai-apply')).toBeVisible({ timeout: 20000 });
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');
  await expect(c.page.getByTestId('thumb-0')).toContainText('Quarterly Review');
  await c.page.getByTestId('ai-discard').click();
  await expect(c.page.getByTestId('ai-card')).toHaveCount(0);
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');

  await c.page.getByTestId('ai-input').fill('Retitle slide 1 again');
  await c.page.getByTestId('ai-send').click();
  await c.page.getByTestId('ai-apply').click();
  await expect(c.page.getByTestId('thumb-0')).toContainText('Edited by AI', { timeout: 10000 });
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html').replace('Quarterly Review', 'Edited by AI'));
  await c.page.getByTestId('ai-undo').click(); // one undo step, labelled after the request
  await save(c.page);
  expect(c.text()).toBe(original('ai-fixed-stage.html'));
});

test('AI Assistant: manual editing is paused while it works, Stop ends the turn', async () => {
  const url = await mockModel([], 3000);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await connect(url);
  await c.page.getByTestId('ai-input').fill('Retitle slide 1');
  await c.page.getByTestId('ai-send').click();
  await expect(c.page.getByTestId('ai-bar')).toBeVisible();
  const { clickObj } = await import('./helpers');
  await clickObj(c.page, '.slide.active .logo'); // selecting still works
  await c.page.keyboard.press('Delete');
  await expect(c.page.getByTestId('msgbar').filter({ hasText: 'AI Assistant is editing' })).toBeVisible();
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');
  await c.page.getByTestId('ai-stop').click();
  await expect(c.page.getByTestId('ai-bar')).toHaveCount(0, { timeout: 10000 });
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');
});
