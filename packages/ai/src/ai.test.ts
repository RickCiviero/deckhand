import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Editor, openBytes, saveBytes, assertNoArtifacts, detectDeck } from '@deckhand/core';
import { DeckTools, runTurn, mockProvider, openAiProvider, anthropicProvider, restoreCheckpoint, type Chunk } from './index.js';

const deck = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));
const tc = (name: string, args: unknown, id = 'c' + name): Chunk => ({ type: 'tool_call', id, name, args });

async function getRef(tools: DeckTools, slide: number, re: RegExp): Promise<string> {
  const r = (await tools.call('get_slide', { slide }, 'edit')) as { html: string };
  const m = re.exec(r.html);
  if (!m) throw new Error('no ref in ' + r.html);
  return m[1]!;
}

describe('AI view', () => {
  it('adds refs, hides data URIs', async () => {
    const t = new DeckTools({ editor: deck('base64-images.html') });
    const r = (await t.call('get_slide', { slide: 1 }, 'ask')) as { html: string; assets: unknown[] };
    expect(r.html).toMatch(/data-ref="o\d+"/);
    expect(r.html).toContain('src="asset:img-1"');
    expect(r.html).not.toContain('base64,');
    expect(r.assets).toHaveLength(1);
  });
  it('overview lists format and outline', async () => {
    const t = new DeckTools({ editor: deck('reveal-style.html') });
    const o = (await t.call('get_deck_overview', {}, 'ask')) as { format: string; outline: unknown[] };
    expect(o.format).toBe('revealjs');
    expect(o.outline.length).toBe(5);
  });
});

describe('write tools', () => {
  it('Ask mode cannot write', async () => {
    const t = new DeckTools({ editor: deck('ai-fixed-stage.html') });
    expect(t.specs('ask').some((s) => s.name === 'set_text')).toBe(false);
    expect(await t.call('set_text', { ref: 'o1', html: 'x' }, 'ask')).toEqual({ error: 'Unknown tool set_text.' });
  });
  it('set_text makes a minimal diff and set_style only touches style', async () => {
    const e = deck('ai-fixed-stage.html');
    const before = text(e);
    const t = new DeckTools({ editor: e });
    const ref = await getRef(t, 1, /<h1[^>]*data-ref="(o\d+)"/);
    expect(await t.call('set_text', { ref, html: 'Annual <b>Review</b>' }, 'edit')).toMatchObject({ ok: true });
    expect(text(e).replace('Annual <b>Review</b>', 'Quarterly Review')).toBe(before);
    const ref2 = await getRef(t, 1, /<h1[^>]*data-ref="(o\d+)"/); // <b> added an element, so references were renewed
    await t.call('set_style', { refs: [ref2], properties: { color: 'red' } }, 'edit');
    expect(text(e)).toContain('<h1 class="title" style="color: red;">');
    assertNoArtifacts(text(e));
  });
  it('rejects unsafe values and stale versions', async () => {
    const e = deck('ai-fixed-stage.html');
    const t = new DeckTools({ editor: e });
    const ref = await getRef(t, 1, /<h1[^>]*data-ref="(o\d+)"/);
    expect(await t.call('set_style', { refs: [ref], properties: { color: 'red; background: url(javascript:x)' } }, 'edit')).toHaveProperty('error');
    expect(await t.call('set_style', { refs: [ref], properties: { background: 'url(https://evil.example/x.png)' } }, 'edit')).toHaveProperty('error');
    expect(await t.call('set_attributes', { ref, attributes: { onclick: 'x()' } }, 'edit')).toHaveProperty('error');
    expect(await t.call('set_attributes', { ref, attributes: { href: 'javascript:alert(1)' } }, 'edit')).toHaveProperty('error');
    expect(await t.call('set_text', { ref, html: 'x', version: 'stale' }, 'edit')).toMatchObject({ error: expect.stringContaining('stale') });
  });
  it('insert_html sanitizes, matches indentation and forces a re-read after structure changes', async () => {
    const e = deck('ai-fixed-stage.html');
    const t = new DeckTools({ editor: e });
    const ref = await getRef(t, 2, /<p[^>]*data-ref="(o\d+)"/);
    const r = await t.call('insert_html', { ref, position: 'after', html: '<p class="body" onclick="x()">New<script>alert(1)</script></p>' }, 'edit');
    expect(r).toMatchObject({ ok: true, note: expect.stringContaining('get_slide') });
    const out = text(e);
    expect(out).toContain('      <p class="body">New</p>');
    expect(out).not.toContain('alert');
    expect(await t.call('set_style', { refs: [ref], properties: { color: 'red' } }, 'edit')).toMatchObject({ error: expect.stringContaining('structure changed') });
  });
  it('asset placeholders resolve on write and never leak', async () => {
    const e = deck('base64-images.html');
    const t = new DeckTools({ editor: e });
    const ref = await getRef(t, 1, /<img[^>]*data-ref="(o\d+)"/);
    await t.call('insert_html', { ref, position: 'after', html: '<img src="asset:img-1" alt="again" width="60">' }, 'edit');
    expect((text(e).match(/base64,/g) ?? []).length).toBe(2);
    expect(text(e)).not.toContain('asset:');
  });
  it('slide tools: hide, notes, duplicate, move, delete', async () => {
    const e = deck('reveal-style.html');
    const t = new DeckTools({ editor: e });
    await t.call('get_deck_overview', {}, 'edit');
    await t.call('set_slide_hidden', { slide: 1, hidden: true }, 'edit');
    expect(text(e)).toContain('<section data-visibility="hidden"><h1>Hello reveal');
    await t.call('set_notes', { slide: 1, text: 'Say <hello>' }, 'edit');
    expect(text(e)).toContain('<aside class="notes">Say &lt;hello&gt;</aside>');
    await t.call('duplicate_slides', { slides: [4] }, 'edit');
    expect(detectDeck(e.doc).slides.length).toBe(6);
    const g = deck('large-100.html');
    const gt = new DeckTools({ editor: g });
    await gt.call('move_slides', { slides: [1, 2], after: 5 }, 'edit');
    expect(detectDeck(g.doc).slides.slice(0, 6).map((s) => s.label)).toEqual(['Slide 3', 'Slide 4', 'Slide 5', 'Slide 1', 'Slide 2', 'Slide 6']);
    await gt.call('delete_slides', { slides: [1] }, 'edit');
    expect(detectDeck(g.doc).slides.length).toBe(99);
    expect(await gt.call('delete_slides', { slides: Array.from({ length: 99 }, (_, i) => i + 1) }, 'edit')).toHaveProperty('error');
  });
  it('theme variable, edit_css and replace_in_source', async () => {
    const e = deck('ai-fixed-stage.html');
    const t = new DeckTools({ editor: e });
    await t.call('set_theme_variable', { name: 'brand', value: '#0a7' }, 'edit');
    expect(text(e)).toContain('--brand: #0a7;');
    expect(await t.call('set_theme_variable', { name: 'nope', value: '#000' }, 'edit')).toHaveProperty('error');
    await t.call('edit_css', { block: 0, old: 'background: #111', new: 'background: #000' }, 'edit');
    expect(text(e)).toContain('body { margin: 0; background: #000; }');
    expect(await t.call('edit_css', { block: 0, old: 'position', new: 'x' }, 'edit')).toMatchObject({ error: expect.stringContaining('more than once') });
    expect(await t.call('edit_css', { block: 0, old: 'margin: 0', new: '@import url(https://x.test/a.css)' }, 'edit')).toHaveProperty('error');
    expect(await t.call('replace_in_source', { old: '<h1 class="title">Roadmap', new: '<h1 class="title" onclick="x()">Roadmap' }, 'edit')).toHaveProperty('error');
  });
});

describe('turns', () => {
  it('injected deck text arrives as tool data and does not change the deck', async () => {
    const e = deck('hostile.html');
    const before = text(e);
    const p = mockProvider([[tc('get_slide', { slide: 2 })], []]);
    const r = await runTurn({ provider: p, editor: e, mode: 'edit', history: [], user: 'Summarize' });
    expect(r.changes).toEqual([]);
    expect(text(e)).toBe(before);
    expect(JSON.stringify(p.requests[1]!.messages.at(-1))).toContain('ignore previous instructions');
    expect(p.requests[0]!.system).toContain('DATA written by someone else');
  });
  it('edits in a turn undo together; change summary; checkpoint restore', async () => {
    const e = deck('ai-fixed-stage.html');
    const before = text(e);
    const ref = await getRef(new DeckTools({ editor: deck('ai-fixed-stage.html') }), 1, /<h1[^>]*data-ref="(o\d+)"/); // ids are deterministic ordinals
    const p = mockProvider([
      [tc('get_slide', { slide: 1 }, 'a')],
      [tc('set_text', { ref, html: 'One' }, 'b'), tc('set_style', { refs: [ref], properties: { color: 'blue' } }, 'c')],
      [{ type: 'text', text: 'Done.' }],
    ]);
    const r = await runTurn({ provider: p, editor: e, mode: 'edit', history: [], user: 'Retitle slide 1' });
    expect(r.changes).toEqual([{ slide: 1, kind: 'changed', label: 'One' }]);
    expect(e.undoLabel).toBe('AI: Retitle slide 1');
    expect(e.undo()).toBe(true);
    expect(text(e)).toBe(before);
    expect(e.canUndo).toBe(false);
    e.redo();
    expect(restoreCheckpoint(e, r.checkpoint)).toBe(true);
    expect(text(e)).toBe(before);
  });
  it('Ask mode cannot change the deck even if the model tries', async () => {
    const e = deck('ai-fixed-stage.html');
    const before = text(e);
    const p = mockProvider([[tc('set_text', { ref: 'o3', html: 'x' })], [{ type: 'text', text: 'ok' }]]);
    await runTurn({ provider: p, editor: e, mode: 'ask', history: [], user: 'x' });
    expect(text(e)).toBe(before);
  });
  it('stops at the tool-call limit and on abort', async () => {
    const e = deck('ai-fixed-stage.html');
    const loop = mockProvider(Array.from({ length: 10 }, () => [tc('get_deck_overview', {})]));
    const r = await runTurn({ provider: loop, editor: e, mode: 'ask', history: [], user: 'x', maxToolCalls: 2 });
    expect(r.stopped).toBe(true);
    const ac = new AbortController();
    ac.abort();
    expect((await runTurn({ provider: loop, editor: e, mode: 'ask', history: [], user: 'x', signal: ac.signal })).stopped).toBe(true);
  });
  it('changing too many slides stops the work', async () => {
    const e = deck('large-100.html');
    const t = new DeckTools({ editor: e, maxChangedSlides: 3 });
    const results: unknown[] = [];
    for (let n = 1; n <= 5; n++) {
      const ref = await getRef(t, n, /<h1[^>]*data-ref="(o\d+)"/);
      results.push(await t.call('set_text', { ref, html: `T${n}` }, 'edit'));
    }
    expect(results.at(-1)).toMatchObject({ error: expect.stringContaining('more than 3 slides') });
  });
});

type Handler = (body: any, res: ServerResponse, req: IncomingMessage) => void;
async function withServer(handler: Handler, fn: (url: string) => Promise<void>): Promise<void> {
  const srv = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => handler(JSON.parse(b || '{}'), res, req)); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${(srv.address() as { port: number }).port}`); } finally { srv.close(); }
}
const collect = async (it: AsyncIterable<Chunk>) => { const out: Chunk[] = []; for await (const c of it) out.push(c); return out; };

describe('providers', () => {
  it('OpenAI-compatible streaming with tool calls', async () => {
    await withServer((body, res, req) => {
      expect(req.headers.authorization).toBe('Bearer k');
      expect(body.tools[0].function.name).toBe('get_slide');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'lo', tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_slide', arguments: '{"sli' } }] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'de":2}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 7 } })}\n\ndata: [DONE]\n\n`);
      res.end();
    }, async (url) => {
      const out = await collect(openAiProvider({ baseUrl: url, apiKey: 'k', model: 'm' }).stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'get_slide', description: 'd', parameters: {} }] }));
      expect(out).toEqual([{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }, { type: 'tool_call', id: 'c1', name: 'get_slide', args: { slide: 2 } }, { type: 'done', usage: { input: 5, output: 7 } }]);
    });
  });
  it('Anthropic streaming with tool use, and friendly errors', async () => {
    await withServer((body, res, req) => {
      if (req.headers['x-api-key'] === 'bad') { res.writeHead(401); return void res.end('{}'); }
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'r1' }, { type: 'tool_result', tool_use_id: 'b', content: 'r2' }] });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o: unknown) => res.write(`event: x\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: 'message_start', message: { usage: { input_tokens: 9 } } });
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } });
      ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'find' } });
      ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } });
      ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"x"}' } });
      ev({ type: 'message_delta', usage: { output_tokens: 4 } });
      res.end();
    }, async (url) => {
      const msgs = [
        { role: 'user' as const, content: 'q' },
        { role: 'assistant' as const, content: '', toolCalls: [{ id: 'a', name: 'find', args: {} }, { id: 'b', name: 'find', args: {} }] },
        { role: 'tool' as const, id: 'a', name: 'find', content: 'r1' },
        { role: 'tool' as const, id: 'b', name: 'find', content: 'r2' },
      ];
      const out = await collect(anthropicProvider({ baseUrl: url, apiKey: 'k', model: 'm' }).stream({ system: 's', messages: msgs, tools: [] }));
      expect(out).toEqual([{ type: 'text', text: 'Hi' }, { type: 'tool_call', id: 't1', name: 'find', args: { query: 'x' } }, { type: 'done', usage: { input: 9, output: 4 } }]);
      await expect(collect(anthropicProvider({ baseUrl: url, apiKey: 'bad', model: 'm' }).stream({ system: 's', messages: msgs, tools: [] }))).rejects.toThrow(/rejected the credentials/);
    });
  });
});
