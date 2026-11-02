import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { findText, replaceCommand } from '@deckhand/core';
import { session, useStore } from './session';

/** Find and Replace over slide text (Ctrl+F / Ctrl+H). */
export function FindBar({ onClose }: { onClose: () => void }): JSX.Element {
  const s = useStore();
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [i, setI] = useState(0);
  const matches = useMemo(() => (s.loaded ? findText(session.doc, q, { matchCase, wholeWord }) : []), [s.version, s.loaded, q, matchCase, wholeWord]);
  const cur = matches.length ? matches[Math.min(i, matches.length - 1)]! : null;
  const slides = new Set(matches.map((m) => m.slide)).size;
  const show = (k: number): void => {
    if (!matches.length) return;
    const idx = (k + matches.length) % matches.length;
    setI(idx);
    const m = matches[idx]!;
    if (m.slide !== useStore.getState().slide) session.goTo(m.slide);
    window.setTimeout(() => useStore.setState({ selection: [m.id] }), 200);
  };
  return (
    <div className="linkbar findbar" role="dialog" aria-label="Find and replace" data-testid="find-bar"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'Enter' && (e.target as HTMLElement).dataset['testid'] === 'find-query') { e.preventDefault(); show(i + (e.shiftKey ? -1 : 1)); } }}>
      <div className="row"><input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Find" aria-label="Find" data-testid="find-query" />
        <Button size="small" onClick={() => show(i - 1)} disabled={!matches.length} aria-label="Previous">↑</Button>
        <Button size="small" onClick={() => show(i + 1)} disabled={!matches.length} aria-label="Next" data-testid="find-next">↓</Button>
        <Button size="small" appearance="subtle" onClick={onClose} aria-label="Close">✕</Button></div>
      <div className="row"><input value={r} onChange={(e) => setR(e.target.value)} placeholder="Replace with" aria-label="Replace with" data-testid="find-replacement" />
        <Button size="small" disabled={!cur} onClick={() => { session.exec(replaceCommand([cur!], r)); }} data-testid="find-replace">Replace</Button>
        <Button size="small" disabled={!matches.length} onClick={() => { session.exec(replaceCommand(matches, r)); }} data-testid="find-replace-all">Replace All</Button></div>
      <div className="row">
        <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word</label>
        <small data-testid="find-count">{q ? (matches.length ? `${cur ? Math.min(i, matches.length - 1) + 1 : 0} of ${matches.length} on ${slides} ${slides === 1 ? 'slide' : 'slides'}${matches.length >= 1000 ? '+' : ''}` : 'No matches') : ''}</small>
      </div>
    </div>
  );
}
