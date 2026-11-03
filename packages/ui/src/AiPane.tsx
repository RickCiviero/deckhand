import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { ai, useAi, type AiConnection, type ChatItem } from './ai';
import { useStore } from './session';

const PRESETS: { label: string; kind: AiConnection['kind']; baseUrl: string; model: string; help: string }[] = [
  { label: 'Claude (API key)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', help: 'Create a key in the Claude Console.' },
  { label: 'OpenAI (API key)', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', help: 'Create a key on the OpenAI Platform.' },
  { label: 'Ollama (this computer)', kind: 'compatible', baseUrl: 'http://localhost:11434/v1', model: '', help: 'Free and private; no key needed.' },
  { label: 'Other OpenAI-compatible', kind: 'compatible', baseUrl: 'https://', model: '', help: 'OpenRouter, LM Studio, a company gateway…' },
];

const SUGGESTIONS = ['Summarize this deck', 'Fix spelling on all slides', 'Make this slide more concise', 'Translate the deck into Italian', 'Give the deck a darker theme'];

function ConnectionForm({ onDone }: { onDone: () => void }): JSX.Element {
  const [p, setP] = useState(PRESETS[0]!);
  const [name, setName] = useState(PRESETS[0]!.label);
  const [baseUrl, setBaseUrl] = useState(PRESETS[0]!.baseUrl);
  const [model, setModel] = useState(PRESETS[0]!.model);
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (label: string): void => {
    const x = PRESETS.find((q) => q.label === label)!;
    setP(x); setName(x.label); setBaseUrl(x.baseUrl); setModel(x.model);
  };
  const save = async (): Promise<void> => {
    setBusy(true); setErr('');
    try {
      await ai.saveConnection({ name, kind: p.kind, baseUrl, model, ...(key ? { key } : {}) });
      const id = useAi.getState().connections.at(-1)?.id;
      if (id) {
        const r = await ai.testConnection(id);
        if (!r.ok) { setErr(r.error ?? 'The test failed.'); setBusy(false); return; }
      }
      onDone();
    } catch (e) { setErr((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
    setBusy(false);
  };
  return (
    <div className="aiform" data-testid="ai-form">
      <label>Provider<select value={p.label} onChange={(e) => pick(e.target.value)}>{PRESETS.map((x) => <option key={x.label}>{x.label}</option>)}</select></label>
      <small>{p.help}</small>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Address<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
      <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model name" data-testid="ai-model" /></label>
      <label>API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" data-testid="ai-key" /></label>
      {!useAi.getState().secure && <small className="warn">This computer cannot store keys securely, so a key cannot be saved.</small>}
      <small>Slide content and your messages are sent straight to this provider. Deckhand has no server of its own.</small>
      {err && <div className="aierr" role="alert">{err}</div>}
      <div className="row"><Button appearance="primary" size="small" disabled={busy || !name || !model} onClick={() => void save()} data-testid="ai-save">Save and test</Button><Button size="small" onClick={onDone}>Cancel</Button></div>
    </div>
  );
}

function Card({ item }: { item: Extract<ChatItem, { kind: 'card' }> }): JSX.Element {
  return (
    <div className="aicard" data-testid="ai-card">
      <strong>{item.pending ? 'The AI wants to change' : ''} {item.changes.length} slide{item.changes.length === 1 ? '' : 's'}{item.pending ? '' : ' changed'}</strong>
      <ul>{item.changes.map((c) => (
        <li key={`${c.slide}${c.kind}`}>Slide {c.slide} ({c.kind}): {c.label}
          {item.open && !item.pending && c.kind === 'changed' && item.changes.every((x) => x.kind === 'changed') && <> <button className="linkish" onClick={() => ai.undoSlide(item.id, c.slide)} data-testid="ai-undo-slide">Undo</button></>}
        </li>
      ))}</ul>
      {item.pending && <div className="row"><Button size="small" appearance="primary" onClick={() => ai.applyCard(item.id)} data-testid="ai-apply">Apply</Button><Button size="small" onClick={() => ai.discardCard(item.id)} data-testid="ai-discard">Discard</Button></div>}
      {item.open && !item.pending && <div className="row"><Button size="small" appearance="primary" onClick={() => ai.keepCard(item.id)}>Keep</Button><Button size="small" onClick={() => ai.undoCard(item.id)} data-testid="ai-undo">Undo all</Button></div>}
    </div>
  );
}

export function AiPane(): JSX.Element {
  const s = useAi();
  const sess = useStore();
  const [text, setText] = useState('');
  const [managing, setManaging] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!s.loaded) void ai.init(); }, [s.loaded]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [s.items]);
  const conn = s.connections.find((c) => c.id === s.connId);
  const send = (t: string): void => { if (!t.trim()) return; setText(''); void ai.send(t); };

  if (managing || (s.loaded && s.connections.length === 0)) {
    return (
      <div className="aipane" data-testid="ai-pane">
        <h4>Connect an AI</h4>
        <ConnectionForm onDone={() => setManaging(false)} />
        {s.connections.length > 0 && (
          <ul className="conns">{s.connections.map((c) => (
            <li key={c.id}>{c.name} <small>({c.model})</small> <Button size="small" appearance="subtle" onClick={() => void ai.removeConnection(c.id)}>Remove</Button></li>
          ))}</ul>
        )}
      </div>
    );
  }
  return (
    <div className="aipane" data-testid="ai-pane">
      <div className="aihead">
        <select value={s.connId ?? ''} onChange={(e) => ai.setConnection(e.target.value)} aria-label="Connection" data-testid="ai-conn">
          {s.connections.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
        </select>
        <Button size="small" appearance="subtle" onClick={() => setManaging(true)}>Manage</Button>
        <Button size="small" appearance="subtle" onClick={() => ai.newChat()} disabled={s.busy}>New</Button>
      </div>
      <div className="aimsgs" aria-live="polite" tabIndex={0} role="log" aria-label="Conversation">
        {s.items.length === 0 && (
          <div className="aiempty">
            <p>Ask a question about this deck or describe a change. In Edit mode the assistant changes the deck directly; one Undo reverts everything it did.</p>
            {SUGGESTIONS.map((x) => <button key={x} className="sugg" onClick={() => send(x)} disabled={!sess.loaded}>{x}</button>)}
          </div>
        )}
        {s.items.map((it, i) => it.kind === 'card' ? <Card key={i} item={it} /> : (
          <div key={i} className={`aimsg ${it.kind}${'error' in it && it.error ? ' bad' : ''}`}>{it.text}</div>
        ))}
        {s.busy && <div className="aibusy">Working… <Button size="small" onClick={() => ai.stop()} data-testid="ai-stop">Stop</Button></div>}
        <div ref={end} />
      </div>
      <div className="aichip">Context: Deck · Slide {sess.slide + 1}{sess.selection.length ? ` · ${sess.selection.length} selected` : ''}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question or describe a change" rows={3} data-testid="ai-input"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
      <div className="row">
        <select value={s.mode} onChange={(e) => ai.setMode(e.target.value as 'ask' | 'edit')} aria-label="Mode" data-testid="ai-mode"><option value="edit">Edit</option><option value="ask">Ask</option></select>
        <Button appearance="primary" size="small" disabled={s.busy || !text.trim() || !conn || !sess.loaded} onClick={() => send(text)} data-testid="ai-send">Send</Button>
      </div>
      <small className="aiusage">API · {s.usage.input + s.usage.output} tokens this chat</small>
    </div>
  );
}
