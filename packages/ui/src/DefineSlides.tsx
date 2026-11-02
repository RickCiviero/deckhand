import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { defineSlidesCommand, detectDeck, matchSelector, proposeSelectors, storedSlideSelector } from '@deckhand/core';
import { session, useStore } from './session';

/** Define Slides wizard (ADP-04): pick what a slide is from the selected object's ancestors, or type a selector; the match count updates live. */
export function DefineSlides({ onClose }: { onClose: () => void }): JSX.Element {
  const s = useStore();
  const doc = session.doc;
  const start = s.selection[0] ?? s.slides[s.slide]?.id ?? 0;
  const proposals = useMemo(() => proposeSelectors(doc, start), [doc, start]);
  const stored = storedSlideSelector(doc);
  const [sel, setSel] = useState(stored ?? proposals.find((p) => p.count >= 2)?.selector ?? proposals[0]?.selector ?? '');
  let count = 0;
  let error = '';
  let labels: string[] = [];
  try {
    const ids = matchSelector(doc, sel);
    count = ids.length;
    labels = ids.slice(0, 4).map((id) => (doc.text.slice(doc.byId(id)!.start, doc.byId(id)!.end).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)) || '(empty)');
  } catch (e) { error = (e as Error).message; }
  const apply = (value: string | null): void => { session.exec(defineSlidesCommand(value)); onClose(); };
  return (
    <div className="linkbar definebar" role="dialog" aria-label="Define slides" data-testid="define-dialog">
      <strong>Define Slides</strong>
      <small>Select an object on a slide first, then choose which of its parents is the slide.</small>
      {proposals.map((p) => (
        <label key={p.id} className="defrow"><input type="radio" name="slidesel" checked={sel === p.selector} onChange={() => setSel(p.selector)} data-testid="define-option" /> <code>{p.selector}</code> <small>{p.count} {p.count === 1 ? 'match' : 'matches'}</small></label>
      ))}
      <label className="defrow">Selector <input value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Selector" data-testid="define-selector" /></label>
      {error ? <div className="aierr" role="alert">{error}</div> : <small data-testid="define-count">{count} {count === 1 ? 'slide' : 'slides'}{labels.length ? `: ${labels.join(' · ')}` : ''}</small>}
      <div className="row">
        <Button size="small" appearance="primary" disabled={!!error || count < 1} onClick={() => apply(sel)} data-testid="define-apply">Use this</Button>
        {stored && <Button size="small" onClick={() => apply(null)} data-testid="define-reset">Detect automatically</Button>}
        <Button size="small" onClick={onClose}>Cancel</Button>
      </div>
      <small>Detected now: {detectDeck(doc).adapter}. The choice is saved in the file as one &lt;meta&gt; tag.</small>
    </div>
  );
}
