import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launch, ready, save, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

test('Document Recovery: recovered version opens as unsaved changes; saving clears it', async () => {
  c = await launch(null);
  const file = path.join(c.deckDir, 'plain-page.html');
  const key = createHash('sha256').update(file).digest('hex').slice(0, 16);
  const dir = path.join(c.userData, 'recovery');
  fs.mkdirSync(dir, { recursive: true });
  const recovered = fs.readFileSync(file, 'latin1').replace('Just a page', 'Recovered title');
  fs.writeFileSync(path.join(dir, `${key}.html`), recovered, 'latin1');
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ file, time: Date.now() }));
  await c.page.reload();
  await expect(c.page.getByTestId('recovery')).toContainText('plain-page.html');
  await c.page.getByTestId('recover').click();
  await ready(c.page);
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  expect(fs.readFileSync(file, 'latin1')).toContain('Just a page'); // disk untouched until the user saves
  await save(c.page);
  expect(fs.readFileSync(file, 'latin1')).toBe(recovered);
  expect(fs.existsSync(path.join(dir, `${key}.html`))).toBe(false);
});
