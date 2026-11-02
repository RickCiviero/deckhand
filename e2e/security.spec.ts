import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { deckFrame, launch, ready, type Ctx } from './helpers';

let c: Ctx;
test.afterEach(async () => { await c?.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });

const hostOf = (page: Ctx['page']): string => new URL(deckFrame(page).url()).host;

test.describe('hostile deck is contained', () => {
  test('every attack in the hostile deck fails and the UI stays responsive while the deck hangs', async () => {
    c = await launch('hostile.html');
    const page = c.page;
    await ready(page);
    const f = deckFrame(page);
    // the deck records the outcome of each attempt; read them before it starts its infinite loop (6 s after load)
    await expect.poll(async () => f.evaluate(() => Object.keys((window as any).__results ?? {}).length), { timeout: 5000 }).toBeGreaterThanOrEqual(8);
    await page.waitForTimeout(800);
    const r = await f.evaluate(() => (window as any).__results);
    expect(r.open).toBe('blocked'); // window.open
    expect(r.top).toBe('blocked'); // top.location = …
    expect(r.parent).toBe('blocked'); // parent.document access
    expect(r.api).toBe('undefined,undefined,undefined,undefined'); // no bridge, electron, require or process in the deck
    expect(r.fetchFile).toBe('blocked'); // fetch('file:///…')
    expect(['blocked', 'no-leak']).toContain(r.fetchDotDot);
    expect(['blocked', 'no-leak']).toContain(r.fetchEnc);
    expect(r.clip).toBe('blocked'); // clipboard read
    expect(JSON.stringify(r)).not.toMatch(/LEAKED|READ |WROTE|OPENED|PWNED/);

    // no popup windows, main window not navigated, editor DOM untouched
    expect(c.app.windows()).toHaveLength(1);
    expect(page.url()).toMatch(/^deckhand-app:\/\/ui\//);
    expect(await page.locator('[data-testid=app]').count()).toBe(1);
    expect(await page.evaluate(() => document.body.innerText.includes('PWNED'))).toBe(false);

    // forged messages to the editor had no effect
    await expect(page.locator('[data-testid=docname]')).toHaveText('hostile.html');
    await expect(page.locator('[data-testid=savestate]')).toHaveText('Saved');
    expect(fs.existsSync('C:/evil')).toBe(false);

    // now the deck's busy loop kicks in: the editor UI (separate process) must stay responsive (SPIKE-1 / REL-01)
    await page.waitForTimeout(7000);
    const t0 = Date.now();
    await page.getByTestId('thumb-1').click();
    await expect(page.locator('[data-testid=slide-counter]')).toHaveText('Slide 2 of 2', { timeout: 3000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    // heartbeat watchdog offers a way out (REL-02)
    await expect(page.locator('[data-testid=msgbar]', { hasText: "aren't responding" })).toBeVisible({ timeout: 12000 });
    await page.getByRole('button', { name: 'Reload with scripts off' }).click();
    await expect(page.locator('[data-testid=msgbar]', { hasText: "aren't responding" })).toHaveCount(0);
    await page.waitForTimeout(1500);
    // scripts are off: the sandbox attribute is empty and nothing ran
    expect(await page.locator('[data-testid=live-view]').getAttribute('sandbox')).toBe('');
    expect(await deckFrame(page).evaluate(() => (window as any).__results)).toBeUndefined();
    expect(c.read().equals(fs.readFileSync(path.join(__dirname, '../test-decks/decks/hostile.html')))).toBe(true);
  });

  test('forged messages on window.postMessage / fake init cannot hijack the editor channel', async () => {
    c = await launch('plain-page.html');
    await ready(c.page);
    const f = deckFrame(c.page);
    const before = await c.page.evaluate(() => document.body.innerHTML.length);
    await f.evaluate(() => {
      parent.postMessage({ t: 'deckhand:init', token: 'x' }, '*');
      parent.postMessage({ t: 'rects', req: 1, rects: [{ id: 1, x: 'evil' }] }, '*');
      window.postMessage({ t: 'deckhand:init', token: 'x' }, '*');
    });
    await c.page.waitForTimeout(500);
    expect(await c.page.locator('[data-testid=savestate]').textContent()).toBe('Saved');
    expect(await c.page.evaluate(() => document.body.innerHTML.length)).toBeGreaterThan(before - 500);
    // the editor still works
    await c.page.getByTestId('thumb-0').click();
    await expect(c.page.locator('[data-testid=slide-counter]')).toHaveText('Slide 1 of 1');
  });

  test('deck cannot obtain permissions (geolocation, notifications, camera)', async () => {
    c = await launch('plain-page.html');
    await ready(c.page);
    const res = await deckFrame(c.page).evaluate(async () => {
      const out: Record<string, string> = {};
      out['geo'] = await new Promise((r) => { try { navigator.geolocation.getCurrentPosition(() => r('GRANTED'), () => r('denied'), { timeout: 3000 }); } catch { r('denied'); } });
      out['notif'] = typeof Notification === 'undefined' ? 'denied' : await Notification.requestPermission();
      out['cam'] = await (navigator.mediaDevices?.getUserMedia({ video: true }).then(() => 'GRANTED').catch(() => 'denied') ?? Promise.resolve('denied'));
      return out;
    });
    expect(res['geo']).toBe('denied');
    expect(res['notif']).not.toBe('granted');
    expect(res['cam']).toBe('denied');
  });
});

test.describe('document protocol: path containment (SEC-03)', () => {
  const evil = [
    '/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%252e%252e/secret.txt', '/..%5csecret.txt', '/assets/../../secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt', '/C:/Windows/win.ini', '/c%3a/Windows/win.ini', '//secret.txt', '/%00', '/assets/theme.css%00.png',
    '/assets/theme.css::$DATA', '/CON', '/assets/..\\..\\secret.txt', '/..;/secret.txt',
  ];
  test('traversal attempts never return outside content; legitimate files still load', async () => {
    c = await launch('multi-file.html');
    await ready(c.page);
    const host = hostOf(c.page);
    const results = await c.app.evaluate(async ({ net }, args) => {
      const out: Record<string, { status: number; leaked: boolean }> = {};
      for (const p of args.paths) {
        try {
          const r = await net.fetch(`deckhand-doc://${args.host}${p}`);
          const body = await r.text();
          out[p] = { status: r.status, leaked: body.includes('TOP-SECRET') };
        } catch { out[p] = { status: 0, leaked: false }; }
      }
      const ok = await net.fetch(`deckhand-doc://${args.host}/assets/theme.css`);
      out['OK'] = { status: ok.status, leaked: (await ok.text()).includes('.slide') };
      const unknown = await net.fetch('deckhand-doc://0000000000000000/assets/theme.css');
      out['UNKNOWN_HOST'] = { status: unknown.status, leaked: false };
      const post = await net.fetch(`deckhand-doc://${args.host}/assets/theme.css`, { method: 'POST', body: 'x' });
      out['POST'] = { status: post.status, leaked: false };
      return out;
    }, { host, paths: evil });
    for (const p of evil) {
      expect(results[p]!.leaked, `${p} leaked outside content`).toBe(false);
      expect(results[p]!.status, `${p} should not succeed`).not.toBe(200);
    }
    expect(results['OK']).toEqual({ status: 200, leaked: true });
    expect(results['UNKNOWN_HOST']!.status).toBe(404);
    expect(results['POST']!.status).toBe(405);
  });

  test('a symlink inside the deck folder that points outside is refused', async () => {
    c = await launch('multi-file.html');
    // a directory junction needs no privileges on Windows and is resolved by realpath like a symlink
    const link = path.join(c.deckDir, 'assets', 'escape');
    try { fs.symlinkSync(c.dir, link, 'junction'); } catch { test.skip(true, 'links not permitted on this machine'); }
    await ready(c.page);
    const host = hostOf(c.page);
    const r = await c.app.evaluate(async ({ net }, h) => {
      const x = await net.fetch(`deckhand-doc://${h}/assets/escape/secret.txt`);
      return { status: x.status, body: await x.text() };
    }, host);
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('TOP-SECRET');
    await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'outside its folder' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('responses carry nosniff and no-store', async () => {
    c = await launch('multi-file.html');
    await ready(c.page);
    const host = hostOf(c.page);
    const h = await c.app.evaluate(async ({ net }, hh) => {
      const x = await net.fetch(`deckhand-doc://${hh}/assets/theme.css`);
      return { nosniff: x.headers.get('x-content-type-options'), cache: x.headers.get('cache-control') };
    }, host);
    expect(h).toEqual({ nosniff: 'nosniff', cache: 'no-store' });
  });

  test('a deck that fetches its own HTML never receives the editor agent or ids', async () => {
    c = await launch('plain-page.html');
    await ready(c.page);
    const html = await deckFrame(c.page).evaluate(async () => (await fetch(location.pathname)).text());
    expect(html).not.toMatch(/data-deckhand|__DECKHAND/);
    expect(html).toContain('Just a page');
    // and the single-use key cannot be replayed to obtain the live page
    const replay = await deckFrame(c.page).evaluate(async () => (await fetch(location.href)).text());
    expect(replay).not.toMatch(/data-deckhand/);
  });
});

test.describe('editor UI hardening (SEC-01/07)', () => {
  test('renderer has no Node, a minimal bridge, a strict CSP and cannot navigate away', async () => {
    c = await launch('plain-page.html');
    await ready(c.page);
    const info = await c.page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__injected = 1';
      document.head.appendChild(s);
      return {
        require: typeof (window as any).require, process: typeof (window as any).process, buffer: typeof (window as any).Buffer,
        bridge: Object.keys((window as any).deckhand).sort(), injected: (window as any).__injected ?? null,
        ipc: typeof (window as any).ipcRenderer,
      };
    });
    expect(info.require).toBe('undefined');
    expect(info.process).toBe('undefined');
    expect(info.buffer).toBe('undefined');
    expect(info.ipc).toBe('undefined');
    expect(info.injected).toBeNull(); // inline script injected into the editor UI must not run (CSP)
    const csp = await c.app.evaluate(async ({ net }) => (await net.fetch('deckhand-app://ui/index.html')).headers.get('content-security-policy'));
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline.*script|script-src[^;]*unsafe-inline/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(info.bridge).toEqual(['ai', 'autoRecover', 'checkUpdate', 'closeConfirmed', 'exportPdf', 'on', 'openDialog', 'openExternal', 'openPath', 'pathForFile', 'pickImage', 'previewInBrowser', 'recent', 'readDisk', 'recoveryDiscard', 'recoveryList', 'recoveryRead', 'save', 'saveAs', 'setDirty', 'setPolicy', 'settings', 'setText', 'startShow', 'thumbs'].sort());

    await c.page.evaluate(() => { location.href = 'https://example.com/'; }).catch(() => undefined);
    await c.page.waitForTimeout(1000);
    expect(c.page.url()).toMatch(/^deckhand-app:\/\/ui\//);
    const popup = await c.page.evaluate(() => { const w = window.open('https://example.com'); return w === null; });
    expect(popup).toBe(true);
    expect(c.app.windows()).toHaveLength(1);
  });

  test('main-process IPC validates every argument', async () => {
    c = await launch('plain-page.html');
    await ready(c.page);
    const attempts = await c.page.evaluate(async () => {
      const api = (window as any).deckhand;
      const bad: Record<string, string> = {};
      const run = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); bad[name] = 'ACCEPTED'; } catch { bad[name] = 'rejected'; } };
      await run('open non-html', () => api.openPath('C:\\Windows\\win.ini'));
      await run('open relative', () => api.openPath('..\\..\\x.html'));
      await run('open UNC', () => api.openPath('\\\\attacker\\share\\x.html'));
      await run('open number', () => api.openPath(42));
      await run('open huge', () => api.openPath('C:\\' + 'a'.repeat(5000) + '.html'));
      await run('open nul byte', () => api.openPath('C:\\x\0.html'));
      await run('save unknown doc', () => api.save('0123456789abcdef', new Uint8Array(4)));
      await run('save bad id', () => api.save('../../etc', new Uint8Array(4)));
      await run('save non-bytes', () => api.save('0123456789abcdef', 'text'));
      await run('setText unknown doc', () => api.setText('0123456789abcdef', '<p>'));
      await run('policy bad value', () => api.setPolicy('0123456789abcdef', 'evil'));
      bad['recovery path traversal'] = (await api.recoveryRead('../../../secret')) === null ? 'rejected' : 'ACCEPTED';
      bad['external javascript url'] = (await api.openExternal('javascript:alert(1)')) === false ? 'rejected' : 'ACCEPTED';
      bad['external file url'] = (await api.openExternal('file:///C:/Windows/System32/calc.exe')) === false ? 'rejected' : 'ACCEPTED';
      return bad;
    });
    for (const [k, v] of Object.entries(attempts)) expect(v, k).toBe('rejected');
  });

  test('remote content policy: Block stops external requests from the deck, Allow permits them', async () => {
    let hits = 0;
    const server = http.createServer((req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }); res.end(Buffer.from('iVBORw0KGgo=', 'base64')); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      c = await launch('plain-page.html');
      fs.writeFileSync(c.file, `<!doctype html><html><head><meta charset="utf-8"><title>R</title></head><body><h1>x</h1><script>fetch('http://127.0.0.1:${port}/a').catch(function(){});</script></body></html>`);
      await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'changed by another program' })).toBeVisible({ timeout: 8000 });
      await c.page.getByRole('button', { name: 'Reload', exact: true }).click(); // loads the new file with policy Allow (default)
      await c.page.getByTestId('tab-view').click();
      await expect.poll(() => hits, { timeout: 8000 }).toBeGreaterThan(0);
      const allowed = hits;
      await c.page.getByTestId('cmd-remote').click(); // Block
      await c.page.waitForTimeout(500);
      hits = 0;
      await c.page.getByTestId('cmd-scripts').click();
      await c.page.getByTestId('cmd-scripts').click();
      await c.page.waitForTimeout(2500);
      expect(allowed).toBeGreaterThan(0);
      expect(hits).toBe(0);
    } finally { server.close(); }
  });

  test('closing a document with unsaved changes keeps the changes safe (AutoRecover is outside the deck folder)', async () => {
    c = await launch('ai-fixed-stage.html');
    await ready(c.page);
    const before = fs.readdirSync(c.deckDir).sort();
    await c.page.getByTestId('cmd-dup-slide').click();
    await expect(c.page.locator('[data-testid^=thumb-]')).toHaveCount(4, { timeout: 8000 });
    // the deck folder must contain no temp or recovery files from editing
    expect(fs.readdirSync(c.deckDir).sort()).toEqual(before);
  });
});

test('administrator policy file: fixed settings win, are shown as locked, and cannot be changed through the settings API', async () => {
  const policy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dh-policy-')), 'policy.json');
  fs.writeFileSync(policy, JSON.stringify({ aiEnabled: false, remote: 'block' }));
  process.env['DECKHAND_POLICY_FILE'] = policy;
  try {
    c = await launch('ai-fixed-stage.html');
    await ready(c.page);
    await expect(c.page.getByTestId('dock-ai')).toHaveCount(0); // AI is off by policy
    const set = await c.page.evaluate(() => (window as any).deckhand.settings.set({ aiEnabled: true, remote: 'allow', scripts: false }));
    expect(set).toMatchObject({ aiEnabled: false, remote: 'block', scripts: false });
    expect([...set.locked].sort()).toEqual(['aiEnabled', 'remote']);
    await c.page.getByTestId('tab-file').click();
    await c.page.getByTestId('bs-options').click();
    await expect(c.page.getByTestId('opt-ai')).toBeDisabled();
    await expect(c.page.getByTestId('opt-remote')).toBeDisabled();
    await expect(c.page.getByTestId('opt-scripts')).toBeEnabled();
    await expect(c.page.getByTestId('policy-note')).toBeVisible();
  } finally { delete process.env['DECKHAND_POLICY_FILE']; }
});

test('update check: tells the user about a newer release, opens nothing by itself, and stays quiet when switched off', async () => {
  let asked = 0;
  const server = http.createServer((req, res) => {
    asked++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ tag_name: 'v99.0.0', html_url: 'https://github.com/RickCiviero/deckhand/releases/tag/v99.0.0', draft: false, prerelease: true }, { tag_name: 'v0.0.1', html_url: 'https://github.com/x', draft: false, prerelease: false }]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env['DECKHAND_UPDATE_URL'] = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    c = await launch('ai-fixed-stage.html');
    await expect(c.page.locator('[data-testid=msgbar]', { hasText: 'Deckhand 99.0.0 is available' })).toBeVisible({ timeout: 15000 });
    expect(asked).toBe(1);
    await c.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    asked = 0;
    const userData = c.userData;
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ updates: 'off' }));
    c = await launch('ai-fixed-stage.html', undefined, userData);
    await ready(c.page);
    await c.page.waitForTimeout(6500); // longer than the start-up delay of the check
    expect(asked).toBe(0);
  } finally { delete process.env['DECKHAND_UPDATE_URL']; server.close(); }
});
