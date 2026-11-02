import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { findFonts, isSafeFontName, replaceFontCommand } from '@deckhand/core';
import { session, useStore } from './session';

// fonts present on most computers; a web font is not added to the file (that needs a link or an embedded copy)
const COMMON = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Helvetica', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

/** Replace Fonts (THM-03): pick a family the deck uses and a replacement; every declaration follows, as one undo step. */
export function FontsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const s = useStore();
  const found = useMemo(() => findFonts(session.doc), [s.version]);
  const [from, setFrom] = useState(found[0]?.family ?? '');
  const [to, setTo] = useState('');
  const bad = to !== '' && !isSafeFontName(to);
  const apply = (): void => { session.exec(replaceFontCommand(from, to.trim())); onClose(); };
  return (
    <div className="linkbar definebar" role="dialog" aria-label="Replace fonts" data-testid="fonts-dialog">
      <strong>Replace Fonts</strong>
      {found.length === 0 ? <small>This presentation names no fonts of its own.</small> : (
        <>
          <label className="defrow">Replace <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Font to replace" data-testid="fonts-from">
            {found.map((f) => <option key={f.family} value={f.family}>{f.family} ({f.count})</option>)}
          </select></label>
          <label className="defrow">With <input list="fonts-common" value={to} onChange={(e) => setTo(e.target.value)} aria-label="New font" data-testid="fonts-to" /></label>
          <datalist id="fonts-common">{[...new Set([...found.map((f) => f.family), ...COMMON])].map((f) => <option key={f} value={f} />)}</datalist>
          {bad && <div className="aierr" role="alert">Use letters, digits, spaces, dots, dashes and underscores only.</div>}
          <small>Only the name changes. If the new font is not installed on another computer, the browser falls back to the next font in the list. A web font is not downloaded or linked for you.</small>
        </>
      )}
      <div className="row">
        <Button size="small" appearance="primary" disabled={!from || !to.trim() || bad} onClick={apply} data-testid="fonts-apply">Replace</Button>
        <Button size="small" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
