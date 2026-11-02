import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { scriptInteractions, findScriptText, getAttr, replaceScriptTextCommand, scriptTextProblem, textOf } from '@deckhand/core';
import { session, useStore } from './session';

const ASKS = /replay|play|start|run|restart|again/i;

/** Frames: a slide whose content is built by the deck's script over time (typed prompts, chat lines…) is expanded step by step; what is seen can be edited where the script writes it. */
export function FramesPane(): JSX.Element {
  const s = useStore();
  const slideId = s.slides[s.slide]?.id;
  const [picked, setPicked] = useState<string | null>(null);
  const buttons = useMemo(() => {
    if (!s.loaded || slideId === undefined) return [];
    const doc = session.doc;
    const out: { id: number; label: string }[] = [];
    const walk = (id: number): void => {
      for (const c of doc.byId(id)?.children ?? []) {
        const e = doc.byId(c)!;
        if (e.tag === 'button' || getAttr(e, 'role') === 'button') {
          const label = textOf(doc, e).replace(/<[^>]*>/g, '').trim() || getAttr(e, 'aria-label') || getAttr(e, 'id') || 'button';
          out.push({ id: e.id, label: `${label.slice(0, 40)}${getAttr(e, 'id') ? ` (#${getAttr(e, 'id')})` : ''}` });
        }
        walk(c);
      }
    };
    walk(slideId);
    return out;
  }, [s.version, s.loaded, slideId]);
  const hasTimers = useMemo(() => s.loaded && session.doc.elements.some((e) => e.tag === 'script' && e.endTagStart !== null && /setTimeout/.test(session.doc.text.slice(e.startTagEnd, e.endTagStart))), [s.version, s.loaded]);
  const guess = buttons.find((b) => ASKS.test(b.label))?.id ?? null;
  const trigger = picked === null ? guess : picked === '' ? null : Number(picked);
  const f = s.frames;
  const interactions = useMemo(() => (s.loaded ? scriptInteractions(session.doc) : []), [s.version, s.loaded]);
  const texts = useMemo(() => s.frameTexts.filter((t) => t.gen).map((t) => ({ ...t, hits: findScriptText(session.doc, t.text).length })), [s.frameTexts, s.version]);
  const editable = texts.filter((t) => t.hits > 0 && t.hits <= 8);
  const commit = (old: string, value: string): void => {
    const v = value.trim();
    if (v === old) return;
    const why = scriptTextProblem(session.doc, old, v);
    if (why) { session.notify('warning', why); return; }
    session.exec(replaceScriptTextCommand(old, v));
  };
  return (
    <aside className="pane format" data-testid="frames-pane">
      {!f ? (
        <div className="framesbox">
          <p className="hint">{hasTimers ? 'This presentation builds content with timed scripts (for example a typed prompt or a chat). Expand it to look at each frame and edit the text it shows.' : 'This presentation has no timed scripts. Steps (Selection tab) cover objects that appear one by one.'}</p>
          {hasTimers && (
            <>
              <label className="hint" htmlFor="frames-trigger">Starts when the deck’s button is pressed</label>
              <select id="frames-trigger" value={picked ?? (guess === null ? '' : String(guess))} onChange={(e) => setPicked(e.target.value)} data-testid="frames-trigger">
                <option value="">Nothing (starts by itself)</option>
                {buttons.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
              <Button appearance="primary" size="small" onClick={() => session.framesStart(trigger)} data-testid="frames-start">Expand animation</Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="row stepbar">
            <Button size="small" onClick={() => session.framesGoto(0)} aria-label="First frame" disabled={f.n === 0}>⏮</Button>
            <Button size="small" onClick={() => session.framesGoto(f.n - 1)} aria-label="Previous frame" disabled={f.n === 0} data-testid="frame-prev">◀</Button>
            <Button size="small" onClick={() => session.framesGoto(f.n + 1)} aria-label="Next frame" disabled={f.n >= f.total} data-testid="frame-next">▶</Button>
            <Button size="small" onClick={() => session.framesGoto(100000)} aria-label="Last frame" disabled={f.n >= f.total}>⏭</Button>
            <Button size="small" onClick={() => session.framesStop()} data-testid="frames-stop">Close</Button>
          </div>
          <input type="range" min={0} max={Math.max(1, f.total)} value={f.n} aria-label="Frame" onChange={(e) => session.framesGoto(Number(e.target.value))} data-testid="frame-slider" style={{ width: '100%' }} />
          <p className="hint" data-testid="frame-label">Frame {f.n} of {f.total} · {(f.time / 1000).toFixed(2)} s</p>
          {editable.length === 0 && <p className="hint">No editable text in this frame. Go to a later frame.</p>}
          <ul className="seltree" aria-label="Text in this frame">
            {editable.map((t) => (
              <li key={t.text} style={{ display: 'block' }}>
                <input defaultValue={t.text} aria-label="Frame text" data-testid="frame-text" style={{ width: '100%' }} title={t.hits > 1 ? `Appears ${t.hits} times in the script: all change` : 'Edit the text where the script writes it'}
                  onBlur={(e) => commit(t.text, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                {t.hits > 1 && <span className="hint">×{t.hits} in the script</span>}
              </li>
            ))}
          </ul>
          {texts.length > editable.length && <p className="hint">{texts.length - editable.length} more text(s) are typed letter by letter or built from pieces by the script; they can’t be edited here.</p>}
        </>
      )}
      {interactions.length > 0 && (
        <details open={!f} data-testid="interactions">
          <summary className="hint">What the script reacts to ({interactions.length})</summary>
          <ul className="seltree" aria-label="Script interactions">
            {interactions.map((i) => (
              <li key={i.pos} style={{ display: 'block' }}>
                <button className="selbtn" style={{ textAlign: 'left', width: '100%' }} onClick={() => session.jumpToCode(i.pos)} title="Show this in the source" data-testid="interaction">
                  {i.event} on {i.target}{i.keys.length ? ` — ${i.keys.join(', ')}` : ''} <span className="hint">line {i.line}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

