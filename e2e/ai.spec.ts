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
async function mockModel(requests: unknown[]): Promise<string> {
  srv = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
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
    });
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
