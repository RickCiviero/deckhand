/** Streaming providers over plain fetch: OpenAI-compatible (OpenAI, Azure, OpenRouter, Ollama, LM Studio, gateways) and Anthropic. */
import type { Chunk, Message, ModelRequest, Provider } from './loop.js';

export class ProviderError extends Error {}
type Fetch = typeof fetch;

export interface ProviderConfig { baseUrl: string; apiKey?: string; model: string; fetch?: Fetch; maxTokens?: number }

function friendly(status: number, body: string): string {
  if (status === 401 || status === 403) return 'The provider rejected the credentials. Check the API key in Options › AI › Connections.';
  if (status === 402) return 'The account has no credit left. Add credit on the provider\'s billing page.';
  if (status === 404) return 'The provider does not know this model or endpoint. Check the model name and base URL.';
  if (status === 429) return 'Rate limit or plan limit reached. Wait a moment or check your usage on the provider\'s page.';
  return `The provider returned an error (${status}). ${body.slice(0, 200)}`;
}

/** Server-sent events: yields the `data:` payload of each event. */
async function* sse(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new ProviderError('The provider sent an empty response.');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
}

async function post(cfg: ProviderConfig, path: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(cfg.baseUrl.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ProviderError(`Could not reach the provider: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ProviderError(friendly(res.status, await res.text().catch(() => '')));
  return res;
}

const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return {}; } };

export function openAiProvider(cfg: ProviderConfig): Provider {
  return {
    async *stream(req: ModelRequest): AsyncGenerator<Chunk> {
      const messages: unknown[] = [{ role: 'system', content: req.system }];
      for (const m of req.messages) {
        if (m.role === 'user') messages.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content || null, ...(m.toolCalls ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
        else messages.push({ role: 'tool', tool_call_id: m.id, content: m.content });
      }
      const res = await post(cfg, '/chat/completions', cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}, {
        model: cfg.model, messages, stream: true, stream_options: { include_usage: true },
        ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      }, req.signal);
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let usage: { input: number; output: number } | undefined;
      for await (const data of sse(res)) {
        if (data === '[DONE]') break;
        const j = parse(data) as { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
        const d = j.choices?.[0]?.delta;
        if (d?.content) yield { type: 'text', text: d.content };
        for (const tc of d?.tool_calls ?? []) {
          const c = calls.get(tc.index) ?? calls.set(tc.index, { id: '', name: '', args: '' }).get(tc.index)!;
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
        if (j.usage) usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
      }
      for (const c of calls.values()) yield { type: 'tool_call', id: c.id || `call_${c.name}`, name: c.name, args: parse(c.args || '{}') };
      yield { type: 'done', usage };
    },
  };
}

export function anthropicProvider(cfg: ProviderConfig): Provider {
  return {
    async *stream(req: ModelRequest): AsyncGenerator<Chunk> {
      const messages: { role: 'user' | 'assistant'; content: unknown[] | string }[] = [];
      for (const m of req.messages as Message[]) {
        if (m.role === 'user') messages.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') {
          const blocks: unknown[] = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
          messages.push({ role: 'assistant', content: blocks });
        } else {
          const block = { type: 'tool_result', tool_use_id: m.id, content: m.content };
          const last = messages.at(-1);
          if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block); // all results of one turn go in one user message
          else messages.push({ role: 'user', content: [block] });
        }
      }
      const res = await post(cfg, '/v1/messages', { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' }, {
        model: cfg.model, max_tokens: cfg.maxTokens ?? 8192, system: req.system, messages, stream: true,
        ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      }, req.signal);
      const blocks = new Map<number, { id: string; name: string; json: string }>();
      const usage = { input: 0, output: 0 };
      for await (const data of sse(res)) {
        const j = parse(data) as { type: string; index?: number; message?: { usage?: { input_tokens: number } }; usage?: { output_tokens: number }; content_block?: { type: string; id: string; name: string }; delta?: { type: string; text?: string; partial_json?: string }; error?: { message: string } };
        if (j.type === 'error') throw new ProviderError(j.error?.message ?? 'The provider reported an error.');
        if (j.type === 'message_start') usage.input = j.message?.usage?.input_tokens ?? 0;
        else if (j.type === 'message_delta') usage.output = j.usage?.output_tokens ?? usage.output;
        else if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') blocks.set(j.index!, { id: j.content_block.id, name: j.content_block.name, json: '' });
        else if (j.type === 'content_block_delta') {
          if (j.delta?.type === 'text_delta' && j.delta.text) yield { type: 'text', text: j.delta.text };
          else if (j.delta?.type === 'input_json_delta') { const b = blocks.get(j.index!); if (b) b.json += j.delta.partial_json ?? ''; }
        }
      }
      for (const b of blocks.values()) yield { type: 'tool_call', id: b.id, name: b.name, args: parse(b.json || '{}') };
      yield { type: 'done', usage };
    },
  };
}

/** Scripted provider for tests (TST-09): each element of `script` is the chunks of one model call. */
export function mockProvider(script: Chunk[][]): Provider & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    requests,
    async *stream(req) {
      requests.push(req);
      for (const c of script[i++] ?? [{ type: 'text', text: 'done' } as Chunk]) yield c;
    },
  };
}
