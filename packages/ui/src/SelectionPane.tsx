import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { hideObjectsCommand, lockObjectCommand, objectTree, renameObjectCommand, reorderCommand } from '@deckhand/core';
import { session, useStore } from './session';

/** Selection Pane (SEP-01): the current slide's objects, topmost first; select, rename, show/hide, lock. */
export function SelectionPane(): JSX.Element {
  const s = useStore();
  const [editing, setEditing] = useState<number | null>(null);
  const slideId = s.slides[s.slide]?.id;
  const tree = useMemo(() => (s.loaded && slideId !== undefined ? objectTree(session.doc, slideId) : []), [s.version, s.loaded, slideId]);
  const [dragId, setDragId] = useState<number | null>(null);
  /** Drop on a sibling: the list is topmost first, so the dragged object takes the dropped-on object's place in stacking order (SEP-04). */
  const drop = (targetId: number): void => {
    const doc = session.doc;
    const a = doc.byId(dragId ?? -1); const b = doc.byId(targetId);
    setDragId(null);
    if (!a || !b || a.id === b.id || a.parent !== b.parent || a.parent === null) return;
    const parent = doc.byId(a.parent);
    if (!parent) return;
    const sibs = parent.children;
    const ia = sibs.indexOf(a.id); const ib = sibs.indexOf(b.id);
    // dragging up the list = later in the document (drawn above); down = earlier
    const before = ia < ib ? (sibs[ib + 1] ?? null) : b.id;
    session.exec(reorderCommand(a.id, before, parent.endTagStart ?? undefined));
  };
  const allHidden = tree.length > 0 && tree.every((n) => n.hidden);
  return (
    <aside className="pane format" data-testid="selection-pane">
      <div className="row selhead">
        <Button size="small" onClick={() => session.exec(hideObjectsCommand(tree.map((n) => n.id), false))} disabled={!tree.some((n) => n.hidden)} data-testid="sel-show-all">Show All</Button>
        <Button size="small" onClick={() => session.exec(hideObjectsCommand(tree.map((n) => n.id), true))} disabled={allHidden}>Hide All</Button>
      </div>
      {tree.length === 0 && <p className="hint">This slide has no objects.</p>}
      <ul className="seltree" role="listbox" aria-label="Objects on this slide">
        {tree.map((n) => (
          <li key={n.id} role="option" aria-selected={s.selection.includes(n.id)} className={`${s.selection.includes(n.id) ? 'on' : ''} ${n.hidden ? 'dim' : ''}`} style={{ paddingLeft: 4 + n.depth * 14 }} data-testid="sel-item" draggable
            onDragStart={() => setDragId(n.id)} onDragOver={(e) => { if (dragId !== null) e.preventDefault(); }} onDrop={() => drop(n.id)} onDragEnd={() => setDragId(null)}>
            {editing === n.id ? (
              <input autoFocus defaultValue={n.custom ? n.name : ''} placeholder={n.name} aria-label="Object name" data-testid="sel-rename"
                onBlur={(e) => { session.exec(renameObjectCommand(n.id, e.target.value)); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <span className="selname" onClick={(e) => useStore.setState({ selection: e.shiftKey || e.ctrlKey ? [...new Set([...s.selection, n.id])] : [n.id] })} onDoubleClick={() => setEditing(n.id)} title="Double-click to rename">{n.name}</span>
            )}
            <button className="selbtn" aria-label={n.hidden ? 'Show' : 'Hide'} title={n.hidden ? 'Show' : 'Hide'} aria-pressed={n.hidden} onClick={() => session.exec(hideObjectsCommand([n.id], !n.hidden))} data-testid="sel-eye">{n.hidden ? '🚫' : '👁'}</button>
            <button className="selbtn" aria-label={n.locked ? 'Unlock' : 'Lock'} title={n.locked ? 'Unlock' : 'Lock'} aria-pressed={n.locked} onClick={() => session.exec(lockObjectCommand(n.id, !n.locked))} data-testid="sel-lock">{n.locked ? '🔒' : '🔓'}</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
