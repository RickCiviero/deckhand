/** AI Assistant state and turn runner (§10). The loop and deck tools run here, next to the Editor; keys and network stay in the main process. */
import { create } from 'zustand';
import { Editor, detectDeck, diffPatch, patchCommand } from '@deckhand/core';
import { restoreCheckpoint, runTurn, slideSources, type Chunk, type ChangeEntry, type Message, type ModelRequest, type Provider } from '@deckhand/ai';
import { session, useStore } from './session';

export interface AiConnection { id: string; name: string; kind: 'anthropic' | 'openai' | 'compatible'; baseUrl: string; model: string; hasKey: boolean }
export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'step'; text: string; error?: boolean }
  | { kind: 'card'; id: number; changes: ChangeEntry[]; checkpoint: string; label: string; open: boolean; before: string[]; after: string[]; pending?: { base: string; final: string } }
  | { kind: 'error'; text: string };

interface AiState {
  connections: AiConnection[];
  secure: boolean;
  connId: string | null;
  mode: 'ask' | 'edit';
  busy: boolean;
  items: ChatItem[];
  usage: { input: number; output: number };
  loaded: boolean;
  dock: 'format' | 'ai' | 'selection' | 'frames';
}
export const useAi = create<AiState>(() => ({ connections: [], secure: true, connId: null, mode: 'edit', busy: false, items: [], usage: { input: 0, output: 0 }, loaded: false, dock: 'format' }));
const set = useAi.setState;
const get = useAi.getState;

let history: Message[] = [];
let abort: AbortController | null = null;
let cardId = 1;

/** Provider that forwards to the main process and re-assembles its chunks. */
function ipcProvider(connId: string): Provider {
  return {
    async *stream(req: ModelRequest): AsyncGenerator<Chunk> {
      const queue: { streamId: string; chunk?: Chunk; end?: boolean; error?: string }[] = [];
      let wake: (() => void) | null = null;
      const off = window.deckhand.on('ai-chunk', (p) => { queue.push(p as never); wake?.(); });
      let id: string | null = null;
      const onAbort = (): void => { if (id) void window.deckhand.ai.cancel(id); };
      req.signal?.addEventListener('abort', onAbort);
      try {
        id = await window.deckhand.ai.stream({ connId, system: req.system, messages: req.messages, tools: req.tools });
        if (req.signal?.aborted) onAbort();
        for (;;) {
          const i = queue.findIndex((m) => m.streamId === id);
          if (i < 0) { await new Promise<void>((r) => { wake = r; }); continue; }
          const m = queue.splice(i, 1)[0]!;
          if (m.error) throw new Error(m.error);
          if (m.end) return;
          if (m.chunk) yield m.chunk;
        }
      } finally {
        off();
        req.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

const errText = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

export const ai = {
  async init(): Promise<void> {
    const r = await window.deckhand.ai.list();
    set((s) => ({ connections: r.list, secure: r.secure, loaded: true, connId: s.connId && r.list.some((c) => c.id === s.connId) ? s.connId : r.list[0]?.id ?? null }));
  },
  async saveConnection(c: Partial<AiConnection> & { key?: string }): Promise<void> {
    const list = await window.deckhand.ai.save(c);
    set((s) => ({ connections: list, connId: s.connId ?? list[0]?.id ?? null }));
  },
  async removeConnection(id: string): Promise<void> {
    const list = await window.deckhand.ai.remove(id);
    set((s) => ({ connections: list, connId: s.connId === id ? list[0]?.id ?? null : s.connId }));
  },
  testConnection: (id: string) => window.deckhand.ai.test(id),
  setDock: (dock: 'format' | 'ai' | 'selection' | 'frames') => set({ dock }),
  setMode: (mode: 'ask' | 'edit') => set({ mode }),
  setConnection: (connId: string) => set({ connId }),
  newChat(): void { history = []; set({ items: [], usage: { input: 0, output: 0 } }); },
  stop(): void { abort?.abort(); },

  async send(text: string): Promise<void> {
    const st = get();
    const sess = useStore.getState();
    if (st.busy || !text.trim() || !st.connId || !sess.loaded) return;
    abort = new AbortController();
    set((s) => ({ busy: true, items: [...s.items, { kind: 'user', text }] }));
    if (st.mode === 'edit') useStore.setState({ aiBusy: true });
    const real = session.editor!;
    // Ask before applying (AIE-05): the turn runs on a scratch copy; the real document changes only on Apply
    const ask = sess.settings.aiAskBefore && st.mode === 'edit';
    const editor = ask ? new Editor(real.doc) : real;
    const startDoc = real.doc;
    let before = editor.doc;
    let assistant = '';
    const det = detectDeck(editor.doc);
    const sel = sess.selection.map((id) => editor.doc.byId(id)?.tag).filter(Boolean).join(', ');
    const facts = `Deck facts: ${det.adapter} format, ${det.slides.length} slides${det.selector ? `, slides match "${det.selector}"` : ''}. The user is looking at slide ${sess.slide + 1}${sel ? ` and has selected: ${sel}` : ''}.`;
    try {
      const r = await runTurn({
        provider: ipcProvider(st.connId), editor, mode: st.mode, history, user: text, deckFacts: facts, signal: abort.signal,
        maxToolCalls: sess.settings.aiMaxToolCalls,
        ctx: { getSelection: () => useStore.getState().selection, allowExternal: sess.settings.aiAllowExternal },
        onEvent: (e) => {
          if (e.type === 'text') {
            assistant += e.text;
            set((s) => ({ items: replaceTail(s.items, 'assistant', assistant) }));
          } else if (e.type === 'tool') {
            assistant = '';
            const err = (e.result as { error?: string } | null)?.error;
            set((s) => ({ items: [...s.items, { kind: 'step', text: err ? `${e.name}: ${err}` : e.name, error: !!err }] }));
            if (!ask && editor.doc !== before) { session.adopt(before); before = editor.doc; } // changes apply live (AIE-02)
          }
        },
      });
      history = [...history, ...r.messages].slice(-200);
      set((s) => ({
        usage: { input: s.usage.input + r.usage.input, output: s.usage.output + r.usage.output },
        items: r.changes.length && st.mode === 'edit'
          ? [...s.items, {
              kind: 'card', id: cardId++, changes: r.changes, checkpoint: r.checkpoint, open: true, before: slideSources(startDoc), after: slideSources(editor.doc),
              label: ask ? `AI: ${text.replace(/s+/g, ' ').slice(0, 50)}` : editor.undoLabel ?? '',
              ...(ask ? { pending: { base: startDoc.text, final: editor.doc.text } } : {}),
            }]
          : s.items,
      }));
    } catch (e) {
      set((s) => ({ items: [...s.items, { kind: 'error', text: errText(e) }] }));
    } finally {
      if (!ask && editor.doc !== before) session.adopt(before);
      abort = null;
      useStore.setState({ aiBusy: false });
      set({ busy: false });
    }
  },

  /** Undo all (AIE-04): the newest card undoes its single undo step; older ones restore their checkpoint (AIE-06). */
  undoCard(id: number): void {
    const card = get().items.find((i) => i.kind === 'card' && i.id === id) as Extract<ChatItem, { kind: 'card' }> | undefined;
    if (!card) return;
    const ed = session.editor!;
    const before = ed.doc;
    if (ed.undoLabel === card.label && ed.undo()) session.adopt(before);
    else if (restoreCheckpoint(ed, card.checkpoint)) session.adopt(before);
    set((s) => ({ items: s.items.map((i) => (i.kind === 'card' && i.id === id ? { ...i, open: false } : i)) }));
  },
  /** Apply a previewed turn (AIE-05) as one undo step; refused if the deck changed in the meantime. */
  applyCard(id: number): void {
    const card = cardOf(id);
    if (!card?.pending) return;
    const ed = session.editor!;
    if (ed.doc.text !== card.pending.base) {
      session.notify('error', 'The presentation changed while you were reviewing, so these changes can no longer be applied. Ask again.');
      return;
    }
    const before = ed.doc;
    const { final } = card.pending;
    ed.exec(patchCommand(card.label, (d) => (d.text === final ? [] : [diffPatch(d.text, final)])), 0);
    session.adopt(before);
    set((s) => ({ items: s.items.map((i) => (i.kind === 'card' && i.id === id ? { ...i, pending: undefined } : i)) }));
  },
  discardCard(id: number): void { set((s) => ({ items: s.items.filter((i) => !(i.kind === 'card' && i.id === id)) })); },

  /** Undo the AI's change to one slide (AIE-04), only while that slide is still as the AI left it. */
  undoSlide(id: number, slide: number): void {
    const card = cardOf(id);
    const ed = session.editor;
    if (!card || !ed) return;
    const now = slideSources(ed.doc);
    if (now.length !== card.before.length || now[slide - 1] !== card.after[slide - 1]) {
      session.notify('warning', `Slide ${slide} has changed since the AI edited it, so only "Undo all" can revert it.`);
      return;
    }
    const before = ed.doc;
    ed.exec(patchCommand(`Undo AI change on slide ${slide}`, (d) => { const el = d.byId(detectDeck(d).slides[slide - 1]!.id)!; return [{ start: el.start, end: el.end, text: card.before[slide - 1]! }]; }), 0);
    session.adopt(before);
    set((s) => ({
      items: s.items.map((i) => {
        if (i.kind !== 'card' || i.id !== id) return i;
        const changes = i.changes.filter((c) => c.slide !== slide);
        return { ...i, changes, after: i.after.map((a, k) => (k === slide - 1 ? i.before[k]! : a)), open: changes.length > 0 };
      }),
    }));
  },
  keepCard(id: number): void { set((s) => ({ items: s.items.map((i) => (i.kind === 'card' && i.id === id ? { ...i, open: false } : i)) })); },
};

const cardOf = (id: number): Extract<ChatItem, { kind: 'card' }> | undefined => get().items.find((i) => i.kind === 'card' && i.id === id) as Extract<ChatItem, { kind: 'card' }> | undefined;

function replaceTail(items: ChatItem[], kind: 'assistant', text: string): ChatItem[] {
  const last = items.at(-1);
  return last?.kind === kind ? [...items.slice(0, -1), { kind, text }] : [...items, { kind, text }];
}
