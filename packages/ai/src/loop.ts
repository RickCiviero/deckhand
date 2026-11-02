/** Agent loop (§10.11): provider-neutral; the provider streams text and tool calls, tools run against the Editor. */
import { detectDeck, diffPatch, patchCommand, type Editor, type SourceDoc } from '@deckhand/core';
import { INSTRUCTIONS } from './instructions.js';
import { DeckTools, type Mode, type ToolContext, type ToolSpec } from './tools.js';

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: { id: string; name: string; args: unknown }[] }
  | { role: 'tool'; id: string; name: string; content: string };

export type Chunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'done'; usage?: { input: number; output: number } };

export interface ModelRequest { system: string; messages: Message[]; tools: ToolSpec[]; signal?: AbortSignal }
export interface Provider { stream(req: ModelRequest): AsyncIterable<Chunk> }

export type TurnEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args: unknown; result: unknown }
  | { type: 'limit'; what: string };

export interface TurnOptions {
  provider: Provider;
  editor: Editor;
  ctx?: Omit<ToolContext, 'editor'>;
  mode: Mode;
  history: Message[];
  user: string;
  /** Deck facts added to the system prompt (AIX-02). */
  deckFacts?: string;
  maxToolCalls?: number;
  signal?: AbortSignal;
  onEvent?: (e: TurnEvent) => void;
}

/** Source of every slide, in order (used to undo one slide of an AI turn). */
export const slideSources = (d: SourceDoc): string[] => detectDeck(d).slides.map((s) => d.text.slice(d.byId(s.id)!.start, d.byId(s.id)!.end));

export interface ChangeEntry { slide: number; kind: 'changed' | 'added' | 'removed'; label: string }

/** Which slides differ between two versions of the deck (AIE-04 change card). */
export function summarizeChanges(before: SourceDoc, after: SourceDoc): ChangeEntry[] {
  const view = (d: SourceDoc) => detectDeck(d).slides.map((s) => ({ label: s.label, src: d.text.slice(d.byId(s.id)!.start, d.byId(s.id)!.end) }));
  const a = view(before);
  const b = view(after);
  const out: ChangeEntry[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (!a[i]) out.push({ slide: i + 1, kind: 'added', label: b[i]!.label });
    else if (!b[i]) out.push({ slide: i + 1, kind: 'removed', label: a[i]!.label });
    else if (a[i]!.src !== b[i]!.src) out.push({ slide: i + 1, kind: 'changed', label: b[i]!.label });
  }
  return out;
}

/** Restore the document text of a checkpoint as one undoable command (AIE-06). */
export function restoreCheckpoint(editor: Editor, text: string): boolean {
  return editor.exec(patchCommand('Restore checkpoint', (d) => (d.text === text ? [] : [diffPatch(d.text, text)])), 0).length > 0;
}

export interface TurnResult { messages: Message[]; changes: ChangeEntry[]; usage: { input: number; output: number }; stopped: boolean; checkpoint: string }

export async function runTurn(o: TurnOptions): Promise<TurnResult> {
  const checkpoint = o.editor.doc.text;
  const before = o.editor.doc;
  const tools = new DeckTools({ ...o.ctx, editor: o.editor });
  const specs = tools.specs(o.mode);
  const system = `${INSTRUCTIONS}\n\nMode: ${o.mode === 'edit' ? 'Edit (you may change the deck)' : 'Ask (read-only: answer questions, do not change the deck)'}.${o.deckFacts ? `\n\n${o.deckFacts}` : ''}`;
  const added: Message[] = [{ role: 'user', content: o.user }];
  const usage = { input: 0, output: 0 };
  const max = o.maxToolCalls ?? 40;
  let calls = 0;
  let stopped = false;
  const end = o.mode === 'edit' ? o.editor.beginGroup() : () => {};
  try {
    for (;;) {
      if (o.signal?.aborted) { stopped = true; break; }
      let text = '';
      const pending: { id: string; name: string; args: unknown }[] = [];
      try {
        for await (const c of o.provider.stream({ system, messages: [...o.history, ...added], tools: specs, signal: o.signal })) {
          if (o.signal?.aborted) { stopped = true; break; }
          if (c.type === 'text') { text += c.text; o.onEvent?.({ type: 'text', text: c.text }); }
          else if (c.type === 'tool_call') pending.push(c);
          else if (c.usage) { usage.input += c.usage.input; usage.output += c.usage.output; }
        }
      } catch (e) {
        if (o.signal?.aborted) stopped = true; else throw e;
      }
      added.push({ role: 'assistant', content: text, ...(pending.length ? { toolCalls: pending } : {}) });
      if (stopped || !pending.length) break;
      for (const p of pending) {
        let result: unknown;
        if (++calls > max) { result = { error: `Tool call limit (${max}) reached. Stop and summarize.` }; o.onEvent?.({ type: 'limit', what: 'tool calls' }); }
        else result = await tools.call(p.name, p.args, o.mode);
        o.onEvent?.({ type: 'tool', name: p.name, args: p.args, result });
        added.push({ role: 'tool', id: p.id, name: p.name, content: JSON.stringify(result) });
      }
      if (calls > max) { stopped = true; break; }
    }
  } finally {
    end(`AI: ${o.user.replace(/\s+/g, ' ').slice(0, 50)}`);
  }
  return { messages: added, changes: summarizeChanges(before, o.editor.doc), usage, stopped, checkpoint };
}
