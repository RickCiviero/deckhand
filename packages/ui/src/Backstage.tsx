import type { JSX } from 'react';
import { QuestionCircle24Regular, ArrowLeft24Regular, DocumentArrowRight24Regular, DocumentPdf24Regular, History24Regular, ImageMultiple24Regular, Image24Regular, FolderOpen24Regular, Info24Regular, Save24Regular, SaveCopy24Regular, Settings24Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { externalDomains, openBytes } from '@deckhand/core';
import { exportPdf, exportPng, exportSingle } from './actions';
import { Help } from './Help';
import { session, useStore, type AppSettings } from './session';

type Page = 'open' | 'info' | 'options' | 'history' | 'help';
type Version = { id: string; time: number; size: number };
const base = (f: string): string => f.split(/[\\/]/).pop() ?? f;

/** File tab (Backstage): Open + Recent, Info, Save As, Export. */
export function Backstage({ onClose, open, onOpenPath, initialPage }: { onClose: () => void; open: () => void; onOpenPath: (file: string) => void; initialPage?: Page }): JSX.Element {
  const s = useStore();
  const [page, setPage] = useState<Page>(initialPage ?? (s.loaded ? 'info' : 'open'));
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { void window.deckhand.recent().then(setRecent).catch(() => undefined); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const locked = (k: string): boolean => !!s.settings.locked?.includes(k);
  // optimistic: the control reacts at once, the saved copy from the main process replaces it
  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    useStore.setState((x) => ({ settings: { ...x.settings, ...patch } }));
    useStore.setState({ settings: await window.deckhand.settings.set(patch) });
  };
  const [versions, setVersions] = useState<Version[] | null>(null);
  useEffect(() => {
    if (page !== 'history' || !s.docId) return;
    void window.deckhand.historyList(s.docId).then(setVersions).catch(() => setVersions([]));
  }, [page, s.docId]);
  const restore = async (v: Version): Promise<void> => {
    if (!s.docId) return;
    const text = openBytes(await window.deckhand.historyRead(s.docId, v.id)).text;
    onClose();
    session.exec({ label: 'Restore version', build: (d) => [{ start: 0, end: d.text.length, text }] });
  };
  const doc = s.loaded ? session.doc : null;
  const domains = doc ? externalDomains(doc) : [];
  const run = (fn: () => void | Promise<unknown>) => () => { onClose(); void fn(); };
  return (
    <div className="backstage" data-testid="backstage" role="dialog" aria-label="File">
      <nav className="bsnav">
        <button className="bsback" onClick={onClose} aria-label="Back" data-testid="bs-back"><ArrowLeft24Regular /></button>
        <button className={page === 'open' ? 'on' : ''} onClick={() => setPage('open')}><FolderOpen24Regular />Open</button>
        <button className={page === 'info' ? 'on' : ''} disabled={!s.loaded} onClick={() => setPage('info')} data-testid="bs-info"><Info24Regular />Info</button>
        <button className={page === 'options' ? 'on' : ''} onClick={() => setPage('options')} data-testid="bs-options"><Settings24Regular />Options</button>
        <button disabled={!s.loaded} onClick={run(() => session.save())} data-testid="cmd-save"><Save24Regular />Save</button>
        <button disabled={!s.loaded} onClick={run(() => session.saveAs())}><SaveCopy24Regular />Save As</button>
        <button disabled={!s.loaded} onClick={run(() => exportPdf())} data-testid="cmd-pdf"><DocumentPdf24Regular />Export PDF</button>
        <button disabled={!s.loaded} onClick={run(() => exportPng(false))} data-testid="cmd-png"><Image24Regular />Export slide as PNG</button>
        <button disabled={!s.loaded} onClick={run(() => exportPng(true))} data-testid="cmd-png-all"><ImageMultiple24Regular />Export all as PNG</button>
        <button disabled={!s.loaded} onClick={run(() => exportSingle())} data-testid="cmd-single"><DocumentArrowRight24Regular />Export single HTML file</button>
        <button className={page === 'help' ? 'on' : ''} onClick={() => setPage('help')} data-testid="bs-help"><QuestionCircle24Regular />Help</button>
        <button className={page === 'history' ? 'on' : ''} disabled={!s.loaded} onClick={() => setPage('history')} data-testid="bs-history"><History24Regular />Version History</button>
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
            {!!s.settings.locked?.length && <p className="hint" data-testid="policy-note">Some settings are fixed by your administrator and cannot be changed here.</p>}
            <p className="hint">These are the starting values for each presentation you open. The View tab changes them for the open one.</p>
            <label className="opt"><input type="checkbox" checked={s.settings.scripts} disabled={locked('scripts')} data-testid="opt-scripts" onChange={(e) => void save({ scripts: e.target.checked })} /> Run the presentation's scripts while editing (they always run in a sandbox)</label>
            <label className="opt">Remote content (fonts, pictures, scripts from the internet)
              <select value={s.settings.remote} disabled={locked('remote')} data-testid="opt-remote" onChange={(e) => void save({ remote: e.target.value as 'allow' | 'block' | 'ask' })}>
                <option value="allow">Allow</option><option value="ask">Ask me when a presentation uses it</option><option value="block">Block</option>
              </select>
            </label>
            <h3>AI Assistant</h3>
            <label className="opt"><input type="checkbox" checked={s.settings.aiEnabled} disabled={locked('aiEnabled')} data-testid="opt-ai" onChange={(e) => void save({ aiEnabled: e.target.checked })} /> Turn the AI Assistant on</label>
            <label className="opt"><input type="checkbox" checked={s.settings.aiAllowExternal} disabled={!s.settings.aiEnabled || locked('aiAllowExternal')} data-testid="opt-ai-external" onChange={(e) => void save({ aiAllowExternal: e.target.checked })} /> Let the AI add external content (pictures, fonts and styles from the internet). Scripts are never allowed.</label>
            <label className="opt"><input type="checkbox" checked={s.settings.aiAskBefore} disabled={!s.settings.aiEnabled || locked('aiAskBefore')} data-testid="opt-ai-ask" onChange={(e) => void save({ aiAskBefore: e.target.checked })} /> Ask before applying: show what the AI wants to change and apply it only after I click Apply</label>
            <label className="opt">Most tool calls in one AI request
              <input type="number" min={1} max={200} value={s.settings.aiMaxToolCalls} disabled={!s.settings.aiEnabled} onChange={(e) => void save({ aiMaxToolCalls: Math.max(1, Math.min(200, Number(e.target.value) || 40)) })} />
            </label>
            <h3>Editing</h3>
            <label className="opt"><input type="checkbox" checked={s.settings.spell} disabled={locked('spell')} data-testid="opt-spell" onChange={(e) => void save({ spell: e.target.checked })} /> Check spelling while editing text (uses the operating system's checker on Windows and macOS)</label>
            <h3>Updates</h3>
            <label className="opt">Check for a newer version
              <select value={s.settings.updates} disabled={locked('updates')} data-testid="opt-updates" onChange={(e) => void save({ updates: e.target.value as 'notify' | 'off' })}>
                <option value="notify">Tell me when one exists</option><option value="off">Never</option>
              </select>
            </label>
            <p className="hint">Once per start, Deckhand asks github.com which release is newest. It never downloads or installs anything by itself.</p>
          </>
        )}
        {page === 'help' && <Help />}
        {page === 'history' && (
          <>
            <h2>Version History</h2>
            <p className="hint">Each time you save, Deckhand keeps the file as it was before, in its own folder (the 30 newest). Restoring puts a version into the open presentation; Undo takes it back, and nothing changes on disk until you save.</p>
            {versions === null && <p className="hint">Loading…</p>}
            {versions?.length === 0 && <p className="hint" data-testid="history-empty">No earlier versions yet. They appear after you save changes.</p>}
            <ul className="recent" data-testid="history-list">{versions?.map((v) => (
              <li key={v.id}>{new Date(v.time).toLocaleString()} <small>{(v.size / 1024).toFixed(1)} KB</small> <Button size="small" onClick={() => void restore(v)} data-testid="history-restore">Restore</Button></li>
            ))}</ul>
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
