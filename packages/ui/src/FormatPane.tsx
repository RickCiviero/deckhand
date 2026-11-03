import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { getStyleProp, type Patch } from '@deckhand/core';
import { detectUnitMode, moveEdit, resizeEdit } from './geometry';
import { session, styleMultiCommand, useStore, type Rect } from './session';
import { setAltText } from './actions';

interface ThemeColor { name: string; value: string; start: number; end: number }

/** THM-01: CSS custom properties that hold colours become named swatches. */
export function themeColors(): ThemeColor[] {
  const out: ThemeColor[] = [];
  const doc = session.doc;
  for (const el of doc.elements) {
    if (el.tag !== 'style' || el.endTagStart === null) continue;
    const css = doc.text.slice(el.startTagEnd, el.endTagStart);
    const re = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const vs = m.index + m[0].length - m[2]!.length;
      out.push({ name: m[1]!, value: m[2]!, start: el.startTagEnd + vs, end: el.startTagEnd + vs + m[2]!.length });
    }
  }
  return out;
}

const toHex = (c: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  const m = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : '#000000';
};

/** Picture styles: plain inline declarations (they show in every browser). */
const PICTURE_RESET: Record<string, null> = { 'border-radius': null, 'box-shadow': null, border: null, filter: null };
const PICTURE_STYLES: { name: string; set: Record<string, string> }[] = [
  { name: 'Plain', set: {} },
  { name: 'Rounded', set: { 'border-radius': '16px' } },
  { name: 'Circle', set: { 'border-radius': '50%', 'object-fit': 'cover', 'aspect-ratio': '1 / 1' } },
  { name: 'Shadow', set: { 'box-shadow': '0 8px 24px rgba(0, 0, 0, 0.25)' } },
  { name: 'Frame', set: { border: '6px solid #ffffff', 'box-shadow': '0 4px 14px rgba(0, 0, 0, 0.2)' } },
  { name: 'Mono', set: { filter: 'grayscale(1)' } },
  { name: 'Sepia', set: { filter: 'sepia(0.8)' } },
];
/** The crop (top, right, bottom, left, in %) written by the crop fields: clip-path: inset(...). */
function cropOf(style: string): number[] {
  const m = /^inset\(\s*([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(getStyleProp(style, 'clip-path') ?? '');
  return m ? [1, 2, 3, 4].map((i) => Number(m[i])) : [0, 0, 0, 0];
}

function Num({ label, value, onCommit, step = 1, testid }: { label: string; value: number | null; onCommit: (v: number) => void; step?: number; testid?: string }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="num">
      <span>{label}</span>
      <input
        data-testid={testid}
        value={draft ?? (value === null ? '' : String(Math.round(value * 10) / 10))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) { const n = parseFloat(draft); if (Number.isFinite(n)) onCommit(n); setDraft(null); } }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const base = draft !== null ? parseFloat(draft) : value ?? 0; onCommit(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)); setDraft(null); }
        }}
      />
    </label>
  );
}

export function FormatPane(): JSX.Element {
  const s = useStore();
  const [tab, setTab] = useState<'shape' | 'theme'>('shape');
  const id = s.selection[0];
  const r: Rect | undefined = id !== undefined ? s.rects[id] : undefined;
  const slideRect = s.rects[s.slides[s.slide]?.id ?? -1];
  const colors = useMemo(() => (s.loaded ? themeColors() : []), [s.version, s.loaded]);

  const ctx = () => {
    const styleText = session.doc.elements.filter((e) => e.tag === 'style').map((e) => session.doc.text.slice(e.startTagEnd, e.endTagStart ?? e.startTagEnd)).join('\n');
    return { mode: detectUnitMode(styleText, slideRect?.sx ?? 1), vp: s.viewport };
  };
  const setAll = (label: string, set: Record<string, string | null>) => {
    if (!s.selection.length) return;
    session.exec(styleMultiCommand(label, s.selection.map((i) => ({ id: i, set }))));
  };

  const setCrop = (side: number, v: number) => {
    const cur = cropOf(session.styleOf(r!.id));
    cur[side] = Math.max(0, Math.min(90, Math.round(v * 10) / 10));
    if (cur[0]! + cur[2]! > 95 || cur[1]! + cur[3]! > 95) return;
    setAll('Crop picture', { 'clip-path': cur.every((x) => x === 0) ? null : `inset(${cur[0]}% ${cur[1]}% ${cur[2]}% ${cur[3]}%)` });
  };

  const setX = (v: number, axis: 'x' | 'y') => {
    if (!r || !slideRect) return;
    const cur = axis === 'x' ? (r.x - slideRect.x) / r.sx : (r.y - slideRect.y) / r.sy;
    const d = v - cur;
    session.exec(styleMultiCommand('Move object', [{ id: r.id, set: moveEdit(r, session.styleOf(r.id), axis === 'x' ? d : 0, axis === 'y' ? d : 0, ctx()).set }]));
  };
  const setSize = (v: number, axis: 'w' | 'h') => {
    if (!r) return;
    const cur = axis === 'w' ? r.w / r.sx : r.h / r.sy;
    const { edit } = resizeEdit(r, session.styleOf(r.id), axis === 'w' ? 'e' : 's', axis === 'w' ? v - cur : 0, axis === 'h' ? v - cur : 0, ctx(), false);
    session.exec(styleMultiCommand('Resize object', [{ id: r.id, set: edit.set }]));
  };

  const editThemeColor = (c: ThemeColor, hex: string) => {
    const patch: Patch = { start: c.start, end: c.end, text: hex };
    session.exec({ label: `Change ${c.name}`, build: () => [patch] });
  };

  if (!s.loaded) return <aside className="pane format" tabIndex={0} aria-label="Format" />;
  return (
    <aside className="pane format" data-testid="format-pane" tabIndex={0} aria-label="Format">
      <div className="tabs">
        <button className={tab === 'shape' ? 'on' : ''} onClick={() => setTab('shape')}>{r ? 'Format Shape' : 'Format'}</button>
        <button className={tab === 'theme' ? 'on' : ''} onClick={() => setTab('theme')}>Theme</button>
      </div>
      {tab === 'theme' && (
        <section>
          <h4>Theme colors</h4>
          {colors.length === 0 && <p className="hint">This deck defines no colour variables (CSS custom properties).</p>}
          {colors.map((c) => (
            <label key={c.name + c.start} className="swatchrow">
              <input type="color" aria-label={`Theme color ${c.name}`} value={toHex(c.value)} onChange={(e) => editThemeColor(c, e.target.value)} data-testid={`theme-${c.name}`} />
              <span>{c.name.replace(/^--/, '').replace(/[-_]/g, ' ')}</span>
              <code>{c.value}</code>
            </label>
          ))}
        </section>
      )}
      {tab === 'shape' && !r && (
        <>
          <section data-testid="bg-section">
            <h4>Format Background</h4>
            {(() => {
              const sid = s.slides[s.slide]?.id;
              const setBg = (v: string | null) => { if (sid !== undefined) session.exec(styleMultiCommand('Change slide background', [{ id: sid, set: { 'background-color': v } }])); };
              return (
                <>
                  <div className="row">
                    <input type="color" aria-label="Background color" data-testid="bg-color" value={toHex(!slideRect || slideRect.background === 'rgba(0, 0, 0, 0)' ? '#ffffff' : slideRect.background)} onChange={(e) => setBg(e.target.value)} />
                    <button className="small" onClick={() => setBg(null)}>Reset</button>
                  </div>
                  {colors.length > 0 && <div className="swatches">{colors.map((c) => <button key={c.name + c.start} className="sw" title={c.name} style={{ background: c.value }} onClick={() => setBg(`var(${c.name})`)} />)}</div>}
                </>
              );
            })()}
          </section>
          <p className="hint">Select an object to format it.</p>
        </>
      )}
      {tab === 'shape' && r && slideRect && (
        <>
          <section>
            <h4>Size &amp; Position <span className={`chip ${r.position === 'absolute' || r.position === 'fixed' ? 'free' : ''}`} title={r.position === 'absolute' || r.position === 'fixed'
              ? 'Free: placed with left/top. Moving it does not affect other objects.' : 'In layout: moving adds a visual offset (translate) and leaves the layout alone.'}>
              {r.position === 'absolute' || r.position === 'fixed' ? 'Free' : 'In layout'}</span></h4>
            <div className="grid2">
              <Num label="X" testid="fp-x" value={(r.x - slideRect.x) / r.sx} onCommit={(v) => setX(v, 'x')} />
              <Num label="Y" testid="fp-y" value={(r.y - slideRect.y) / r.sy} onCommit={(v) => setX(v, 'y')} />
              <Num label="W" testid="fp-w" value={r.w / r.sx} onCommit={(v) => setSize(v, 'w')} />
              <Num label="H" testid="fp-h" value={r.h / r.sy} onCommit={(v) => setSize(v, 'h')} />
            </div>
            <button className="small" onClick={() => setAll('Reset position', { translate: null })}>Reset position</button>
          </section>
          {r.tag === 'img' && (
            <section>
              <h4>Picture</h4>
              <label className="num wide"><span>Alt text</span>
                <input type="text" data-testid="fp-alt" key={r.id + session.doc.text.length} defaultValue={(session.doc.byId(r.id)?.attrs.find((a) => a.name === 'alt')?.value) ?? ''} onBlur={(e) => setAltText(e.target.value)} />
              </label>
              <h4>Picture styles</h4>
              <div className="row" data-testid="picture-styles">
                {PICTURE_STYLES.map((ps) => <button key={ps.name} className="small" data-testid={`pstyle-${ps.name.toLowerCase()}`} onClick={() => setAll(`Picture style: ${ps.name}`, { ...PICTURE_RESET, ...ps.set })}>{ps.name}</button>)}
              </div>
              <h4>Crop (% cut off)</h4>
              <div className="grid2" data-testid="crop">
                {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side, i) => (
                  <Num key={side} label={side} testid={`crop-${side.toLowerCase()}`} value={cropOf(session.styleOf(r.id))[i]!} onCommit={(v) => setCrop(i, v)} />
                ))}
              </div>
              <button className="small" onClick={() => setAll('Reset crop', { 'clip-path': null })}>Reset crop</button>
            </section>
          )}
          <section>
            <h4>Fill</h4>
            <div className="row">
              <input type="color" aria-label="Fill color" data-testid="fp-fill" value={toHex(r.background === 'rgba(0, 0, 0, 0)' ? '#ffffff' : r.background)} onChange={(e) => setAll('Change fill', { 'background-color': e.target.value })} />
              <button className="small" onClick={() => setAll('Remove fill', { 'background-color': 'transparent' })}>None</button>
            </div>
            {colors.length > 0 && (
              <div className="swatches">
                {colors.map((c) => <button key={c.name + c.start} className="sw" title={c.name} style={{ background: c.value }} onClick={() => setAll(`Fill ${c.name}`, { 'background-color': `var(${c.name})` })} />)}
              </div>
            )}
          </section>
          <section>
            <h4>Border</h4>
            <div className="grid2">
              <Num label="Width" value={parseFloat(r.borderWidth)} onCommit={(v) => setAll('Change border', { 'border-width': `${v}px`, 'border-style': r.borderStyle === 'none' ? 'solid' : r.borderStyle })} />
              <Num label="Radius" value={parseFloat(r.borderRadius) || 0} onCommit={(v) => setAll('Change corner radius', { 'border-radius': `${v}px` })} />
            </div>
            <input type="color" aria-label="Border color" value={toHex(r.borderColor)} onChange={(e) => setAll('Change border color', { 'border-color': e.target.value })} />
          </section>
          <section>
            <h4>Effects</h4>
            <label className="num wide"><span>Opacity</span>
              <input type="range" min={0} max={100} value={Math.round((r.opacity ?? 1) * 100)} onChange={(e) => setAll('Change opacity', { opacity: String(Number(e.target.value) / 100) })} />
            </label>
          </section>
          <section>
            <h4>Text</h4>
            <div className="grid2">
              <Num label="Size" testid="fp-size" value={r.fontSize} onCommit={(v) => {
                const cur = getStyleProp(session.styleOf(r.id), 'font-size');
                const unit = /(rem|em|vw|%)$/.exec(cur ?? '')?.[1];
                // keep the unit the element already uses (TXT-07)
                const out = unit && cur ? `${Math.round((parseFloat(cur) * v / (r.fontSize || v)) * 100) / 100}${unit}` : `${v}px`;
                setAll('Change font size', { 'font-size': out });
              }} />
              <label className="num"><span>Color</span><input type="color" data-testid="fp-color" value={toHex(r.color)} onChange={(e) => setAll('Change font color', { color: e.target.value })} /></label>
            </div>
            <div className="row">
              <button className={`small ${Number(r.fontWeight) >= 600 ? 'on' : ''}`} onClick={() => setAll('Bold', { 'font-weight': Number(r.fontWeight) >= 600 ? '400' : '700' })}><b>B</b></button>
              {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                <button key={a} className={`small ${r.textAlign === a ? 'on' : ''}`} onClick={() => setAll('Align text', { 'text-align': a })}>{a[0]!.toUpperCase()}</button>
              ))}
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
