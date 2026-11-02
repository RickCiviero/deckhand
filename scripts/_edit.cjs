const fs = require('fs');
const p = 'e2e/ai.spec.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing ' + a.slice(0, 50)); s = s.replace(a, b); };
rep("async function mockModel(requests: unknown[]): Promise<string> {", "async function mockModel(requests: unknown[], delayMs = 0): Promise<string> {");
rep("      requests.push(body);\n      res.writeHead(200, { 'content-type': 'text/event-stream' });", "      requests.push(body);\n      const respond = (): void => {\n      res.writeHead(200, { 'content-type': 'text/event-stream' });");
rep("      res.end('data: [DONE]\n\n');\n    });", "      res.end('data: [DONE]\n\n');\n      };\n      if (delayMs && body.messages.at(-1)?.role === 'user' && !/single word OK/.test(body.messages[0]!.content ?? '')) setTimeout(respond, delayMs); else respond();\n    });");
s += `
test('AI Assistant: manual editing is paused while it works, Stop ends the turn', async () => {
  const url = await mockModel([], 4000);
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await connect(url);
  await c.page.getByTestId('ai-input').fill('Retitle slide 1');
  await c.page.getByTestId('ai-send').click();
  await expect(c.page.getByTestId('ai-bar')).toBeVisible();
  const { clickObj } = await import('./helpers');
  await clickObj(c.page, '.slide.active .logo'); // selection still works
  await c.page.keyboard.press('Delete');
  await expect(c.page.getByTestId('msgbar').filter({ hasText: 'AI Assistant is editing' })).toBeVisible();
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');
  await c.page.getByTestId('ai-stop').click();
  await expect(c.page.getByTestId('ai-bar')).toHaveCount(0, { timeout: 10000 });
  await expect(c.page.getByTestId('savestate')).toHaveText('Saved');
});
`;
fs.writeFileSync(p, s);
