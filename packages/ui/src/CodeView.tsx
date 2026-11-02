import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { diffPatch, isObjectTag, parseErrors, patchCommand } from '@deckhand/core';
import { Button } from '@fluentui/react-components';
import { session, useStore } from './session';

const MAX_CHARS = 60_000_000; // long data: URIs are folded (CODE-01), so only the remaining text counts towards what CodeMirror must lay out

const DATA_URI = /data:[a-z0-9.+-/]+;base64,[A-Za-z0-9+/=]{80,}/gi;
class FoldWidget extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(o: FoldWidget): boolean { return o.label === this.label; }
  toDOM(): HTMLElement { const e = document.createElement('span'); e.className = 'cm-datafold'; e.textContent = this.label; e.title = 'Embedded data, folded. Edit it on the slide.'; return e; }
}
function foldDataUris(doc: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const m of doc.matchAll(DATA_URI)) {
    const kb = m[0].length * 0.75 / 1024;
    const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
    b.add(m.index!, m.index! + m[0].length, Decoration.replace({ widget: new FoldWidget(`${m[0].slice(0, m[0].indexOf(',') + 1)}… (${size})`) }));
  }
  return b.finish();
}
const folds = StateField.define<DecorationSet>({
  create: (st) => foldDataUris(st.doc.toString()),
  update: (v, tr) => (tr.docChanged ? foldDataUris(tr.state.doc.toString()) : v),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});
const setErrors = StateEffect.define<number[]>();
const errorMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setErrors)) {
      const len = tr.state.doc.length;
      return Decoration.set([...new Set(e.value)].filter((o) => o < len).sort((a, b) => a - b).map((o) => Decoration.mark({ class: 'cm-parseerror' }).range(o, Math.min(len, o + 1))));
    }
    return tr.docChanged ? Decoration.none : v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const foldExt: Extension[] = [folds, errorMarks];

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
  const [blocked, setBlocked] = useState<string | null>(null);
  const tooBig = s.loaded && session.doc.text.length > MAX_CHARS;

  const apply = (force = false): void => {
    window.clearTimeout(timer.current);
    const v = view.current;
    if (!v) return;
    const next = v.state.doc.toString();
    const cur = session.doc.text;
    if (next === cur) { setPending(false); setBlocked(null); return; }
    if (!force) {
      // CODE-03: hold back edits that add parse errors; the user can apply anyway
      const before = parseErrors(cur).length;
      const errs = parseErrors(next);
      if (errs.length > before) {
        v.dispatch({ effects: setErrors.of(errs.map((e) => e.offset)) });
        const line = v.state.doc.lineAt(Math.min(errs[0]!.offset, v.state.doc.length)).number;
        setBlocked(`${errs.length - before} new HTML error(s), first near line ${line}. Not applied.`);
        return;
      }
    }
    setBlocked(null);
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
          basicSetup, html(), foldExt, EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': 'HTML source', 'data-testid': 'code-content' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applying.current && !programmatic.current) {
              setPending(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => apply(), 1000);
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

  // Interactions list: jump to the script line
  useEffect(() => {
    const v = view.current;
    const j = s.codeJump;
    if (!v || !j || pending || j.pos > v.state.doc.length) return;
    fromSelection.current = true;
    v.dispatch({ selection: { anchor: j.pos }, effects: EditorView.scrollIntoView(j.pos, { y: 'center' }) });
    fromSelection.current = false;
  }, [s.codeJump, pending]);

  if (tooBig) return <div className="codeview" data-testid="code-view"><p className="hint">This file is too large for the code view (over 60 MB of source). Edit it on the slide instead.</p></div>;
  return (
    <div className="codeview" data-testid="code-view">
      <div className="row codebar">
        <small data-testid="code-status">{blocked ?? (pending ? 'Editing… applies after a second of idle time' : 'Source')}</small>
        <Button size="small" disabled={!pending} onClick={() => apply(false)} data-testid="code-apply">Apply</Button>
        {blocked && <Button size="small" onClick={() => apply(true)} data-testid="code-apply-anyway">Apply anyway</Button>}
      </div>
      <div ref={host} className="cmhost" />
    </div>
  );
}
