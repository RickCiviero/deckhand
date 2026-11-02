import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { externalDomains } from '@deckhand/core';
import { exportPdf } from './actions';
import { session, useStore, type AppSettings } from './session';

type Page = 'open' | 'info' | 'options';
const base = (f: string): string => f.split(/[\\/]/).pop() ?? f;

/** File tab (Backstage): Open + Recent, Info, Save As, Export. */
export function Backstage({ onClose, open, onOpenPath }: { onClose: () => void; open: () => void; onOpenPath: (file: string) => void }): JSX.Element {
  const s = useStore();
  const [page, setPage] = useState<Page>(s.loaded ? 'info' : 'open');
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { void window.deckhand.recent().then(setRecent).catch(() => undefined); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  // optimistic: the control reacts at once, the saved copy from the main process replaces it
  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    useStore.setState((x) => ({ settings: { ...x.settings, ...patch } }));
    useStore.setState({ settings: await window.deckhand.settings.set(patch) });
  };
  const doc = s.loaded ? session.doc : null;
  const domains = doc ? externalDomains(doc) : [];
  const run = (fn: () => void | Promise<unknown>) => () => { onClose(); void fn(); };
  return (
    <div className="backstage" data-testid="backstage" role="dialog" aria-label="File">
      <nav className="bsnav">
        <button className="bsback" onClick={onClose} aria-label="Back" data-testid="bs-back">←</button>
        <button className={page === 'open' ? 'on' : ''} onClick={() => setPage('open')}>Open</button>
        <button className={page === 'info' ? 'on' : ''} disabled={!s.loaded} onClick={() => setPage('info')} data-testid="bs-info">Info</button>
        <button className={page === 'options' ? 'on' : ''} onClick={() => setPage('options')} data-testid="bs-options">Options</button>
        <button disabled={!s.loaded} onClick={run(() => session.save())} data-testid="cmd-save">Save</button>
        <button disabled={!s.loaded} onClick={run(() => session.saveAs())}>Save As</button>
        <button disabled={!s.loaded} onClick={run(() => exportPdf())} data-testid="cmd-pdf">Export PDF</button>
      </nav>
      <section className="bspage">
        {page === 'open' && (
          <>
            <h2>Open</h2>
            <Button appearance="primary" onClick={run(open)} data-testid="cmd-open">Browse…</Button>
            <h3>Recent</h3>
            {recent.length === 0 && <p className="hint">No recent presentations.</p>}
            <ul className="recent">{recent.map((f) => (
              <li key={f}><button className="linkish" onClick={() => { onClose(); onOpenPath(f); }} title={f} data-testid="recent-item">{base(f)}</button> <small>{f}</small></li>
            ))}</ul>
          </>
        )}
        {page === 'options' && (
          <>
            <h2>Options</h2>
            <h3>Trust Center</h3>
            <p className="hint">These are the starting values for each presentation you open. The View tab changes them for the open one.</p>
            <label className="opt"><input type="checkbox" checked={s.settings.scripts} data-testid="opt-scripts" onChange={(e) => void save({ scripts: e.target.checked })} /> Run the presentation's scripts while editing (they always run in a sandbox)</label>
            <label className="opt">Remote content (fonts, pictures, scripts from the internet)
              <select value={s.settings.remote} data-testid="opt-remote" onChange={(e) => void save({ remote: e.target.value as 'allow' | 'block' })}>
                <option value="allow">Allow</option><option value="block">Block</option>
              </select>
            </label>
            <h3>AI Assistant</h3>
            <label className="opt"><input type="checkbox" checked={s.settings.aiEnabled} data-testid="opt-ai" onChange={(e) => void save({ aiEnabled: e.target.checked })} /> Turn the AI Assistant on</label>
            <label className="opt"><input type="checkbox" checked={s.settings.aiAllowExternal} disabled={!s.settings.aiEnabled} data-testid="opt-ai-external" onChange={(e) => void save({ aiAllowExternal: e.target.checked })} /> Let the AI add external content (pictures, fonts and styles from the internet). Scripts are never allowed.</label>
            <label className="opt"><input type="checkbox" checked={s.settings.aiAskBefore} disabled={!s.settings.aiEnabled} data-testid="opt-ai-ask" onChange={(e) => void save({ aiAskBefore: e.target.checked })} /> Ask before applying: show what the AI wants to change and apply it only after I click Apply</label>
            <label className="opt">Most tool calls in one AI request
              <input type="number" min={1} max={200} value={s.settings.aiMaxToolCalls} disabled={!s.settings.aiEnabled} onChange={(e) => void save({ aiMaxToolCalls: Math.max(1, Math.min(200, Number(e.target.value) || 40)) })} />
            </label>
          </>
        )}
        {page === 'info' && doc && (
          <>
            <h2>{s.name}</h2>
            <dl className="info" data-testid="info">
              <dt>Format</dt><dd>{s.detection?.adapter ?? 'unknown'}{s.detection ? ` (${Math.round(s.detection.confidence * 100)}% sure)` : ''}</dd>
              <dt>Slides</dt><dd>{s.slides.length}{s.detection?.selector ? ` · ${s.detection.selector}` : ''}</dd>
              <dt>Encoding</dt><dd>{doc.meta.encoding}{doc.meta.bom ? ' with BOM' : ''}</dd>
              <dt>Line endings</dt><dd>{doc.meta.eol}</dd>
              <dt>Size</dt><dd>{(doc.text.length / 1024).toFixed(1)} KB of source</dd>
              <dt>External domains</dt>
              <dd>{domains.length === 0 ? 'None. This presentation works offline.' : domains.map((d) => <code key={d} className="dom">{d}</code>)}</dd>
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
