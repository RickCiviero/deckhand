import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { diffPatch, isObjectTag, patchCommand } from '@deckhand/core';
import { Button } from '@fluentui/react-components';
import { session, useStore } from './session';

const MAX_CHARS = 2_000_000; // honest limit: CodeMirror on a deck full of embedded pictures would freeze the editor (FMT-06)

/** Code view (CODE-01…03): the file's source, editable; edits apply as one undo step after 1 s idle or on Apply; selection is synced both ways. */
export function CodeView(): JSX.Element {
  const s = useStore();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const applying = useRef(false);
  const fromSelection = useRef(false);
  const programmatic = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const tooBig = s.loaded && session.doc.text.length > MAX_CHARS;

  const apply = (): void => {
    window.clearTimeout(timer.current);
    const v = view.current;
    if (!v) return;
    const next = v.state.doc.toString();
    const cur = session.doc.text;
    if (next === cur) { setPending(false); return; }
    applying.current = true;
    session.exec(patchCommand('Edit source', (d) => (d.text === next ? [] : [diffPatch(d.text, next)])));
    applying.current = false;
    setPending(false);
  };

  useEffect(() => {
    if (!host.current || tooBig) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: session.doc.text,
        extensions: [
          basicSetup, html(), EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': 'HTML source', 'data-testid': 'code-content' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applying.current && !programmatic.current) {
              setPending(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(apply, 1000);
            }
            if (u.selectionSet && !u.docChanged && !fromSelection.current) {
              // CODE-02: the caret picks the object whose source it is in
              const pos = u.state.selection.main.head;
              const doc = session.doc;
              let best: number | null = null;
              for (const e of doc.elements) if (isObjectTag(e.tag) && e.start <= pos && pos <= e.end && (best === null || e.start >= doc.byId(best)!.start)) best = e.id;
              const slideId = useStore.getState().slides[useStore.getState().slide]?.id;
              if (best !== null && best !== slideId && session.isDescendant(best, slideId ?? -1)) useStore.setState({ selection: [best] });
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => { window.clearTimeout(timer.current); v.destroy(); view.current = null; };
  }, [tooBig]);

  // the document changed elsewhere (canvas edit, undo, AI): show the new source unless the user is mid-edit here
  useEffect(() => {
    const v = view.current;
    if (!v || pending) return;
    const text = session.doc.text;
    if (v.state.doc.toString() !== text) {
      programmatic.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      programmatic.current = false;
    }
  }, [s.version, pending]);

  // CODE-02: selecting an object reveals and highlights its source
  useEffect(() => {
    const v = view.current;
    const id = s.selection[0];
    if (!v || id === undefined || pending) return;
    const e = session.doc.byId(id);
    if (!e || e.end > v.state.doc.length) return;
    fromSelection.current = true;
    v.dispatch({ selection: { anchor: e.start, head: e.startTagEnd }, effects: EditorView.scrollIntoView(e.start, { y: 'center' }) });
    fromSelection.current = false;
  }, [s.selection, pending]);

  if (tooBig) return <div className="codeview" data-testid="code-view"><p className="hint">This file is too large for the code view (over 2 MB of source, usually embedded pictures). Edit it on the slide instead.</p></div>;
  return (
    <div className="codeview" data-testid="code-view">
      <div className="row codebar">
        <small>{pending ? 'Editing… applies after a second of idle time' : 'Source'}</small>
        <Button size="small" disabled={!pending} onClick={apply} data-testid="code-apply">Apply</Button>
      </div>
      <div ref={host} className="cmhost" />
    </div>
  );
}
