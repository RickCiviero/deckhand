import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Button, FluentProvider, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarActions, MessageBarBody, Tooltip, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { t } from '@deckhand/i18n';
import { Canvas } from './Canvas';
import { FormatPane } from './FormatPane';
import { AiPane } from './AiPane';
import { Backstage } from './Backstage';
import { DefineSlides } from './DefineSlides';
import { SelectionPane } from './SelectionPane';
import { ai, useAi } from './ai';
import { deckLayouts } from '@deckhand/core';
import { copySelection, paste, selectAll, setSelectionStyle, changePicture, insertPicture, newSlide, align, arrange, deleteSlide, duplicateSlide, installKeyboard, insertTextBox, moveSlide, startShow } from './actions';
import { session, useStore } from './session';

type Tab = 'file' | 'home' | 'insert' | 'design' | 'show' | 'view';

function Cmd({ label, tip, onClick, disabled, on, testid }: { label: string; tip: string; onClick: () => void; disabled?: boolean; on?: boolean; testid?: string }): JSX.Element {
  return (
    <Tooltip content={tip} relationship="description" withArrow>
      {/* mousedown default prevented so formatting buttons do not steal the text selection from the live view */}
      <Button size="small" appearance={on ? 'primary' : 'subtle'} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} data-testid={testid}>{label}</Button>
    </Tooltip>
  );
}

function NewSlideMenu({ disabled }: { disabled: boolean }): JSX.Element {
  const version = useStore((x) => x.version);
  const layouts = !disabled ? deckLayouts(session.doc) : [];
  void version;
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button size="small" appearance="subtle" disabled={disabled} onMouseDown={(e) => e.preventDefault()} data-testid="cmd-new-slide">{t('home.newSlideMenu')} ▾</Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {layouts.map((l) => <MenuItem key={l.id} onClick={() => newSlide(l.slideId)} data-testid="layout-item">{l.name} <small>({l.count})</small></MenuItem>)}
          <MenuItem onClick={() => newSlide('blank')} data-testid="layout-blank">Blank</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export async function openFromResult(r: unknown, slide?: number): Promise<void> {
  if (!r) return;
  await session.openResult(r as { docId: string; name: string; bytes: Uint8Array }, slide ? slide - 1 : 0);
}

export function App(): JSX.Element {
  const s = useStore();
  const dock = useAi((x) => x.dock);
  const [tab, setTab] = useState<Tab>('home');
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [dropping, setDropping] = useState(false);
  const [backstage, setBackstage] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [defining, setDefining] = useState(false);
  const [recovery, setRecovery] = useState<{ key: string; file: string; time: number }[]>([]);
  useEffect(() => { if (!s.loaded) void window.deckhand.recoveryList().then((r) => setRecovery(r as typeof recovery)).catch(() => undefined); }, [s.loaded]);
  const recover = async (r: { key: string; file: string }) => {
    try {
      const opened = (await window.deckhand.openPath(r.file)) as { docId: string; name: string };
      const bytes = (await window.deckhand.recoveryRead(r.key)) as Uint8Array | null;
      if (!bytes) throw new Error('The recovered version is no longer available.');
      await session.openResult({ docId: opened.docId, name: opened.name, bytes });
      useStore.setState({ dirty: true });
      void window.deckhand.setDirty(true);
    } catch (e) { session.notify('error', cleanErr(e as Error)); }
  };
  const discard = async (key: string) => { await window.deckhand.recoveryDiscard(key); setRecovery((x) => x.filter((y) => y.key !== key)); };

  useEffect(() => {
    void window.deckhand.settings.get().then((cfg) => useStore.setState({ settings: cfg })).catch(() => undefined);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', h);
    const off = installKeyboard();
    const offOpen = window.deckhand.on('open-request', (p) => {
      const v = p as { file: string; slide?: number };
      void window.deckhand.openPath(v.file).then((r) => openFromResult(r, v.slide)).catch((e: Error) => session.notify('error', cleanErr(e)));
    });
    const offDoc = window.deckhand.on('doc-event', (p) => {
      const ev = p as { type: string; url?: string };
      if (ev.type === 'blocked') {
        session.notify('warning', 'This presentation uses files outside its folder. They were blocked for your safety.');
      } else if (ev.type === 'external-change') {
        const id = session.notify('info', 'This file was changed by another program.', [
          { label: 'Reload', run: () => void reloadFromDisk() },
          { label: 'Keep my version', run: () => session.dismiss(id) },
        ]);
      }
    });
    const offCmd = window.deckhand.on('cmd', (c) => { if (c === 'save-then-close') void session.save().then((ok) => ok && window.deckhand.closeConfirmed()); });
    const dragOver = (e: DragEvent) => { e.preventDefault(); setDropping(true); };
    const dragLeave = () => setDropping(false);
    const drop = (e: DragEvent) => {
      e.preventDefault(); setDropping(false);
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      try {
        const p = window.deckhand.pathForFile(f);
        void window.deckhand.openPath(p).then((r) => openFromResult(r)).catch((err: Error) => session.notify('error', cleanErr(err)));
      } catch (err) { session.notify('error', cleanErr(err as Error)); }
    };
    window.addEventListener('dragover', dragOver); window.addEventListener('dragleave', dragLeave); window.addEventListener('drop', drop);
    return () => { mq.removeEventListener('change', h); off(); offOpen(); offDoc(); offCmd(); window.removeEventListener('dragover', dragOver); window.removeEventListener('dragleave', dragLeave); window.removeEventListener('drop', drop); };
  }, []);

  const reloadFromDisk = async () => {
    const id = useStore.getState().docId;
    if (!id) return;
    const bytes = (await window.deckhand.readDisk(id)) as Uint8Array;
    await session.openResult({ docId: id, name: useStore.getState().name, bytes }, useStore.getState().slide);
  };

  const open = async () => { try { await openFromResult(await window.deckhand.openDialog()); } catch (e) { session.notify('error', cleanErr(e as Error)); } };
  const pathEls = s.selection[0] !== undefined && s.loaded ? session.ancestors(s.selection[0]).filter((e) => !['html', 'body'].includes(e.tag)) : [];

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
      {/* layout class lives on a wrapper: Fluent copies the provider className onto every portal (tooltips) */}
      <div className="app" data-testid="app">
      <header className="titlebar">
        <span className="appname">{t('app.name')}</span>
        <span className="docname" data-testid="docname">{s.loaded ? s.name : ''}</span>
        <span className="savestate" data-testid="savestate">{s.loaded ? (s.dirty ? 'Unsaved changes' : 'Saved') : ''}</span>
        <div className="qat">
          <Cmd label="💾" tip="Save (Ctrl+S)" disabled={!s.loaded} onClick={() => void session.save()} testid="qat-save" />
          <Cmd label="↶" tip={`Undo ${s.undoLabel} (Ctrl+Z)`} disabled={!s.canUndo} onClick={() => session.undo()} testid="qat-undo" />
          <Cmd label="↷" tip="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={() => session.redo()} testid="qat-redo" />
        </div>
      </header>

      <nav className="ribbon">
        <div className="tabrow" role="tablist">
          {(['file', 'home', 'insert', 'design', 'show', 'view'] as Tab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => (x === 'file' ? setBackstage(true) : setTab(x))} data-testid={`tab-${x}`}>{t(`tab.${x}`)}</button>
          ))}
        </div>
        <div className="tools">
          {tab === 'home' && (<>
            <Cmd label={t('home.paste')} tip="Paste (Ctrl+V)" disabled={!s.loaded} onClick={() => paste()} testid="cmd-paste" />
            <Cmd label={t('home.cut')} tip="Cut (Ctrl+X)" disabled={!s.selection.length} onClick={() => copySelection(true)} />
            <Cmd label={t('home.copy')} tip="Copy (Ctrl+C)" disabled={!s.selection.length} onClick={() => copySelection()} />
            <span className="sep" />
            <Cmd label={t('home.undo')} tip="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => session.undo()} />
            <Cmd label={t('home.redo')} tip="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={() => session.redo()} />
            <span className="sep" />
            <Cmd label="B" tip="Bold (Ctrl+B) — while editing text" disabled={s.editing === null} onClick={() => session.format('bold')} testid="fmt-bold" />
            <Cmd label="I" tip="Italic (Ctrl+I)" disabled={s.editing === null} onClick={() => session.format('italic')} />
            <Cmd label="U" tip="Underline (Ctrl+U)" disabled={s.editing === null} onClick={() => session.format('underline')} />
            <Tooltip content="Font color of the selected objects" relationship="description" withArrow>
              <input type="color" aria-label="Font color" disabled={!s.selection.length} data-testid="font-color" onChange={(e) => setSelectionStyle('Change font color', { color: e.target.value })} />
            </Tooltip>
            <Cmd label="⯇" tip="Align Text Left" disabled={!s.selection.length} onClick={() => setSelectionStyle('Align text', { 'text-align': 'left' })} testid="txt-left" />
            <Cmd label="≡" tip="Center Text" disabled={!s.selection.length} onClick={() => setSelectionStyle('Align text', { 'text-align': 'center' })} testid="txt-center" />
            <Cmd label="⯈" tip="Align Text Right" disabled={!s.selection.length} onClick={() => setSelectionStyle('Align text', { 'text-align': 'right' })} />
            <Cmd label="☰" tip="Justify" disabled={!s.selection.length} onClick={() => setSelectionStyle('Align text', { 'text-align': 'justify' })} />
            <span className="sep" />
            <NewSlideMenu disabled={!s.loaded} />
            <Cmd label={t('home.newSlide')} tip="Duplicate the current slide (Ctrl+D)" disabled={!s.loaded} onClick={duplicateSlide} testid="cmd-dup-slide" />
            <Cmd label={t('home.deleteSlide')} tip="Delete the current slide" disabled={!s.loaded || s.slides.length <= 1} onClick={deleteSlide} testid="cmd-del-slide" />
            <span className="sep" />
            <Cmd label={t('home.selectAll')} tip="Select all objects on the slide (Ctrl+A)" disabled={!s.loaded} onClick={() => selectAll()} />
            <Cmd label={t('home.front')} tip="Bring to Front" disabled={!s.selection.length} onClick={() => arrange('front')} />
            {s.settings.aiEnabled && <Cmd label={t('home.ai')} tip="Open the AI Assistant (Ctrl+Alt+I)" disabled={!s.loaded} on={dock === 'ai'} onClick={() => ai.setDock(dock === 'ai' ? 'format' : 'ai')} testid="cmd-ai" />}
            <span className="sep" />
            <Cmd label={t('home.back')} tip="Send to Back" disabled={!s.selection.length} onClick={() => arrange('back')} />
            <Cmd label="⇤" tip="Align Left" disabled={!s.selection.length} onClick={() => align('left')} />
            <Cmd label="⇔" tip="Align Center" disabled={!s.selection.length} onClick={() => align('center')} />
            <Cmd label="⇥" tip="Align Right" disabled={!s.selection.length} onClick={() => align('right')} />
          </>)}
          {tab === 'insert' && (<>
            <Cmd label={t('insert.picture')} tip="Insert a picture from a file" disabled={!s.loaded} onClick={() => void insertPicture()} testid="cmd-picture" />
            <Cmd label={t('insert.textBox')} tip="Insert a text box" disabled={!s.loaded} onClick={() => insertTextBox()} testid="cmd-textbox" />
            <span className="sep" />
            <Cmd label={t('insert.link')} tip={s.editing !== null ? 'Link the selected text to a web address' : 'Select some text while editing first'} disabled={s.editing === null} onClick={() => setLink('https://')} testid="cmd-link" />
            <Cmd label={t('insert.changePicture')} tip={s.selection.length && s.loaded && session.doc.byId(s.selection[0]!)?.tag === 'img' ? 'Replace the selected picture, keeping its size and position' : 'Select a picture first'} disabled={!(s.loaded && s.selection.length && session.doc.byId(s.selection[0]!)?.tag === 'img')} onClick={() => void changePicture()} testid="cmd-change-picture" />
          </>)}
          {tab === 'design' && (<>
            <Cmd label={t('design.defineSlides')} tip="Tell Deckhand which element is a slide, if it guessed wrong" disabled={!s.loaded} onClick={() => setDefining(true)} testid="cmd-define-slides" />
            <Cmd label={t('design.background')} tip="Open Format Background in the side pane" disabled={!s.loaded} onClick={() => { ai.setDock('format'); useStore.setState({ selection: [] }); }} />
            <Cmd label={t('design.colors')} tip="Theme colors" disabled={!s.loaded} onClick={() => ai.setDock('format')} />
          </>)}
          {tab === 'show' && (<>
            <Cmd label={t('show.fromStart')} tip="Start the slide show from the first slide (F5)" disabled={!s.loaded} onClick={() => startShow(0)} testid="cmd-show-start" />
            <Cmd label={t('show.fromCurrent')} tip="Start the slide show from this slide (Shift+F5)" disabled={!s.loaded} onClick={() => startShow(s.slide)} testid="cmd-show-current" />
          </>)}
          {tab === 'view' && (<>
            <Cmd label={t('view.fit')} tip="Fit to window (Ctrl+0)" disabled={!s.loaded} onClick={() => useStore.setState({ fit: true })} />
            <Cmd label={t('view.smart')} tip="Smart guides while dragging" on={s.smart} onClick={() => useStore.setState({ smart: !s.smart })} />
            <Cmd label={t('view.scripts')} tip="Off gives a static view for decks whose scripts get in the way" on={s.scriptsOn} disabled={!s.loaded}
              onClick={() => { useStore.setState({ scriptsOn: !s.scriptsOn }); void session.reload(); }} testid="cmd-scripts" />
            <Cmd label={t('view.remote')} tip="Load fonts, images and scripts from the internet when the deck asks for them" on={s.remote} disabled={!s.loaded}
              onClick={() => { const v = !s.remote; useStore.setState({ remote: v }); void window.deckhand.setPolicy(s.docId!, v ? 'allow' : 'block').then(() => session.reload()); }} testid="cmd-remote" />
          </>)}
        </div>
      </nav>

      <div className="msgbars" data-testid="msgbars">
        {s.notices.map((n) => (
          <MessageBar key={n.id} intent={n.kind === 'error' ? 'error' : n.kind === 'warning' ? 'warning' : 'info'} data-testid="msgbar">
            <MessageBarBody>{n.text}</MessageBarBody>
            <MessageBarActions>
              {n.actions?.map((a) => <Button key={a.label} size="small" onClick={() => { a.run(); session.dismiss(n.id); }}>{a.label}</Button>)}
              <Button size="small" appearance="transparent" aria-label="Dismiss" onClick={() => session.dismiss(n.id)}>✕</Button>
            </MessageBarActions>
          </MessageBar>
        ))}
      </div>

      {s.aiBusy && <div className="aibar" role="status" data-testid="ai-bar">AI Assistant is editing… <Button size="small" onClick={() => ai.stop()}>Stop</Button></div>}
      {!s.loaded ? (
        <main className="welcome" data-testid="welcome">
          <h1>{t('app.name')}</h1>
          <p>{t('app.tagline')}</p>
          <Button appearance="primary" onClick={() => void open()} data-testid="welcome-open">{t('file.open')}…</Button>
          <p className="hint">{t('file.drop')}</p>
          {recovery.length > 0 && (
            <section className="recovery" data-testid="recovery">
              <h3>Document Recovery</h3>
              <p>These presentations had unsaved changes when Deckhand last closed.</p>
              {recovery.map((r) => (
                <div key={r.key} className="row">
                  <span>{r.file.split(/[\/]/).pop()} <small>({new Date(r.time).toLocaleString()})</small></span>
                  <Button size="small" appearance="primary" onClick={() => void recover(r)} data-testid="recover">Recover</Button>
                  <Button size="small" onClick={() => void discard(r.key)}>Discard</Button>
                </div>
              ))}
            </section>
          )}
        </main>
      ) : (
        <main className="workspace">
          <aside className="pane slides" data-testid="slide-pane">
            {s.slides.map((sl, i) => (
              <div key={sl.id} className={`thumb ${i === s.slide ? 'on' : ''} ${sl.hidden ? 'hidden' : ''}`} draggable
                onClick={() => session.goTo(i)} data-testid={`thumb-${i}`}
                onDragStart={(e) => e.dataTransfer.setData('text/x-slide', String(i))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const from = Number(e.dataTransfer.getData('text/x-slide')); if (Number.isInteger(from)) moveSlide(from, i); }}>
                {s.thumbs[i] && <img className="timg" src={s.thumbs[i]} alt="" draggable={false} data-testid={`timg-${i}`} />}
                <span className="num">{i + 1}</span>
                <span className="lab">{sl.label}</span>
              </div>
            ))}
          </aside>
          <section className="center"><Canvas /></section>
          <div className="dock">
            <div className="dockTabs" role="tablist">
              <button role="tab" aria-selected={dock === 'selection'} className={dock === 'selection' ? 'on' : ''} onClick={() => ai.setDock('selection')} data-testid="dock-selection">Selection</button>
              <button role="tab" aria-selected={dock === 'format'} className={dock === 'format' ? 'on' : ''} onClick={() => ai.setDock('format')} data-testid="dock-format">Format</button>
              {s.settings.aiEnabled && <button role="tab" aria-selected={dock === 'ai'} className={dock === 'ai' ? 'on' : ''} onClick={() => ai.setDock('ai')} data-testid="dock-ai">AI Assistant</button>}
            </div>
            {dock === 'selection' ? <SelectionPane /> : dock === 'ai' && s.settings.aiEnabled ? <aside className="pane format"><AiPane /></aside> : <FormatPane />}
          </div>
        </main>
      )}

      <footer className="statusbar">
        <span data-testid="slide-counter">{s.loaded ? t('status.slide', { n: s.slide + 1, total: s.slides.length }) : ''}</span>
        <span className="path" data-testid="path">
          {pathEls.map((e, i) => (
            <button key={e.id} className="crumb" onClick={() => useStore.setState({ selection: [e.id] })}>{i > 0 ? ' › ' : ''}{e.tag}{(() => { const c = (e.attrs.find((a) => a.name === 'class')?.value ?? '').split(/\s+/)[0]; return c ? `.${c}` : ''; })()}</button>
          ))}
        </span>
        <span className="chip" data-testid="adapter-chip">{s.detection ? `${s.detection.adapter}` : ''}</span>
        <label className="zoom">
          <input type="range" min={10} max={400} value={Math.round(s.zoom * 100)} onChange={(e) => useStore.setState({ fit: false, zoom: Number(e.target.value) / 100 })} aria-label="Zoom" />
          <span data-testid="zoom">{Math.round(s.zoom * 100)}%</span>
        </label>
      </footer>
      {backstage && <Backstage onClose={() => setBackstage(false)} open={() => void open()} onOpenPath={(f) => void window.deckhand.openPath(f).then((r) => openFromResult(r)).catch((e: Error) => session.notify('error', cleanErr(e)))} />}
      {defining && s.loaded && <DefineSlides onClose={() => setDefining(false)} />}
      {link !== null && (
        <div className="linkbar" role="dialog" aria-label="Insert link" data-testid="link-dialog">
          <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} aria-label="Address" data-testid="link-url"
            onKeyDown={(e) => { if (e.key === 'Enter') { session.format('link', link); setLink(null); } else if (e.key === 'Escape') setLink(null); }} />
          <Button size="small" appearance="primary" disabled={!/^(https?:|mailto:|#)/i.test(link.trim())} onClick={() => { session.format('link', link); setLink(null); }} data-testid="link-ok">OK</Button>
          <Button size="small" onClick={() => setLink(null)}>Cancel</Button>
          <small>https://, mailto: or #anchor</small>
        </div>
      )}
      {dropping && <div className="dropveil">{t('file.drop')}</div>}
      </div>
    </FluentProvider>
  );
}

function cleanErr(e: Error): string {
  return e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}
