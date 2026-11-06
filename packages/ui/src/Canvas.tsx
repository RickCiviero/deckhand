import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isLocked } from '@deckhand/core';
import { detectUnitMode, isFree, moveEdit, outermost, resizeEdit, snapBox, type Box, type Handle } from './geometry';
import { session, styleMultiCommand, useStore, type Rect } from './session';

const HANDLES: { h: Handle; x: number; y: number }[] = [
  { h: 'nw', x: 0, y: 0 }, { h: 'n', x: 0.5, y: 0 }, { h: 'ne', x: 1, y: 0 }, { h: 'e', x: 1, y: 0.5 },
  { h: 'se', x: 1, y: 1 }, { h: 's', x: 0.5, y: 1 }, { h: 'sw', x: 0, y: 1 }, { h: 'w', x: 0, y: 0.5 },
];
const KEEP_ASPECT = new Set(['img', 'svg', 'canvas', 'video', 'picture']);

interface DragState {
  kind: 'move' | 'resize' | 'marquee' | 'pending';
  x0: number; y0: number;
  ids: number[];
  rects: Record<number, Rect>;
  styles: Record<number, string>;
  handle?: Handle;
  moved: boolean;
  hitId: number | null;
  shift: boolean;
  wasSelected: boolean;
  /** pointer released before the async hit-test came back: finish as a plain click */
  released?: boolean;
  hitDone?: boolean;
}

export function Canvas(): JSX.Element {
  const s = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [live, setLive] = useState<Record<number, Box> | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverBusy = useRef(false);
  const { w: VW, h: VH } = s.viewport;
  const z = s.zoom;

  // Fit to window
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!useStore.getState().fit) return;
      // Page mode (a page without slides): fit the width and let the page scroll
      const page = ['page', 'website'].includes(useStore.getState().detection?.adapter ?? '');
      const k = Math.max(0.1, Math.min(4, page ? (el.clientWidth - 48) / VW : Math.min((el.clientWidth - 48) / VW, (el.clientHeight - 48) / VH)));
      useStore.setState({ zoom: k });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [VW, VH, s.fit]);

  useEffect(() => { session.queueRefresh(); }, [z, s.slide]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    useStore.setState((st) => ({ fit: false, zoom: Math.max(0.1, Math.min(4, st.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
  }, []);

  const toView = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };

  const slide = s.slides[s.slide];
  const slideRect = slide ? s.rects[slide.id] : undefined;
  const styleText = useMemo(() => {
    if (!s.loaded) return '';
    try { return session.doc.elements.filter((e) => e.tag === 'style').map((e) => session.doc.text.slice(e.startTagEnd, e.endTagStart ?? e.startTagEnd)).join('\n'); } catch { return ''; }
  }, [s.version, s.loaded]);
  const ctx = useMemo(() => ({ mode: detectUnitMode(styleText, slideRect?.sx ?? 1), vp: { w: VW, h: VH } }), [styleText, slideRect?.sx, VW, VH]);

  const hitObject = async (e: { clientX: number; clientY: number }): Promise<{ picked: number | null; all: number[] }> => {
    const p = toView(e);
    const ids = await session.hitTest(p.x, p.y);
    const slideId = slide?.id ?? -1;
    const chain = ids.filter((id) => { const el = session.doc.byId(id); return el && id !== slideId && session.isDescendant(id, slideId); });
    return { picked: session.pickObject(ids, slideId), all: chain };
  };

  const boxOf = (id: number): Box | null => {
    const l = live?.[id];
    if (l) return l;
    const r = s.rects[id];
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  };

  // ---- pointer ------------------------------------------------------------------------------------------------
  const onPointerDown = async (e: React.PointerEvent) => {
    if (e.button !== 0 || s.editing !== null) return;
    setMenu(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const target = e.target as HTMLElement;
    const handle = target.dataset['handle'] as Handle | undefined;
    const ids = useStore.getState().selection;
    const st = useStore.getState();
    if (handle && ids.length === 1 && !isLocked(session.doc, ids[0]!)) {
      drag.current = { kind: 'resize', x0: e.clientX, y0: e.clientY, ids, rects: { ...st.rects }, styles: { [ids[0]!]: session.styleOf(ids[0]!) }, handle, moved: false, hitId: ids[0]!, shift: e.shiftKey, wasSelected: true };
      return;
    }
    const down = { x: e.clientX, y: e.clientY, shift: e.shiftKey || e.ctrlKey || e.metaKey, alt: e.altKey };
    drag.current = { kind: 'pending', x0: e.clientX, y0: e.clientY, ids: [], rects: {}, styles: {}, moved: false, hitId: null, shift: down.shift, wasSelected: false };
    const mine = drag.current;
    const { picked, all } = await hitObject(e);
    mine.hitDone = true;
    if (drag.current !== mine) return;
    let target2 = picked;
    if (down.alt && all.length > 1) { // cycle to the object behind
      const cur = useStore.getState().selection[0];
      const i = cur === undefined ? -1 : all.indexOf(cur);
      target2 = all[(i + 1) % all.length] ?? picked;
    }
    const sel = useStore.getState().selection;
    mine.hitId = target2;
    if (target2 === null) {
      if (!down.shift) useStore.setState({ selection: [] });
      mine.kind = 'marquee';
      if (mine.released) { drag.current = null; setMarquee(null); }
      return;
    }
    if (down.shift) {
      useStore.setState({ selection: sel.includes(target2) ? sel.filter((x) => x !== target2) : [...sel, target2] });
      mine.kind = 'pending';
      if (mine.released) drag.current = null;
      return;
    }
    mine.wasSelected = sel.includes(target2);
    if (!mine.wasSelected) useStore.setState({ selection: [target2] });
    if (mine.released) { drag.current = null; session.queueRefresh(); return; } // quick click: selection done
    await session.refreshRects();
    const now = useStore.getState();
    mine.kind = 'move';
    if (now.selection.some((id) => isLocked(session.doc, id))) { // SEL-08: locked objects can be selected but not moved
      mine.kind = 'pending';
      session.notify('info', 'This object is locked. Unlock it in the Selection Pane to move it.');
      return;
    }
    mine.ids = now.selection;
    mine.rects = { ...now.rects };
    mine.styles = Object.fromEntries(now.selection.map((id) => [id, session.styleOf(id)]));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (s.editing !== null || hoverBusy.current || e.buttons) return;
      hoverBusy.current = true;
      void hitObject(e).then(({ picked }) => { useStore.setState({ hover: picked }); }).finally(() => setTimeout(() => { hoverBusy.current = false; }, 40));
      return;
    }
    const dxS = e.clientX - d.x0;
    const dyS = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dxS, dyS) < 3) return;
    d.moved = true;
    if (d.kind === 'marquee') {
      const a = toView({ clientX: d.x0, clientY: d.y0 });
      const b = toView(e);
      setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
      return;
    }
    if (d.kind === 'move' && d.ids.length) {
      let dxV = dxS / z;
      let dyV = dyS / z;
      if (e.shiftKey) { if (Math.abs(dxV) > Math.abs(dyV)) dyV = 0; else dxV = 0; }
      // smart guides
      let g = { v: [] as number[], h: [] as number[] };
      const boxes = d.ids.map((id) => d.rects[id]).filter((r): r is Rect => !!r);
      if (boxes.length && useStore.getState().smart && !e.altKey && !e.metaKey) {
        const x1 = Math.min(...boxes.map((r) => r.x)); const y1 = Math.min(...boxes.map((r) => r.y));
        const x2 = Math.max(...boxes.map((r) => r.x + r.w)); const y2 = Math.max(...boxes.map((r) => r.y + r.h));
        const others: Box[] = [];
        const st = useStore.getState();
        if (slideRect) others.push({ x: slideRect.x, y: slideRect.y, w: slideRect.w, h: slideRect.h });
        for (const id of st.slideObjects) if (!d.ids.includes(id) && st.rects[id]?.visible) { const r = st.rects[id]!; others.push({ x: r.x, y: r.y, w: r.w, h: r.h }); }
        const sn = snapBox({ x: x1 + dxV, y: y1 + dyV, w: x2 - x1, h: y2 - y1 }, others, 6 / z);
        dxV += sn.dx; dyV += sn.dy; g = { v: sn.v, h: sn.h };
      }
      setGuides(g);
      const next: Record<number, Box> = {};
      for (const id of d.ids) {
        const r = d.rects[id]; if (!r) continue;
        next[id] = { x: r.x + dxV, y: r.y + dyV, w: r.w, h: r.h };
        const edit = moveEdit(r, d.styles[id] ?? '', dxV / r.sx, dyV / r.sy, ctx);
        session.previewStyle(id, applyEdit(d.styles[id] ?? '', edit.set));
      }
      setLive(next);
    } else if (d.kind === 'resize' && d.handle) {
      const id = d.ids[0]!;
      const r = d.rects[id]!;
      const aspect = e.shiftKey ? !KEEP_ASPECT.has(r.tag) : KEEP_ASPECT.has(r.tag) && d.handle.length === 2;
      const { edit, w, h } = resizeEdit(r, d.styles[id] ?? '', d.handle, dxS / z / r.sx, dyS / z / r.sy, ctx, aspect);
      const dw = w * r.sx - r.w; const dh = h * r.sy - r.h;
      const west = d.handle.includes('w'); const north = d.handle.includes('n');
      setLive({ [id]: { x: r.x - (west ? dw : 0), y: r.y - (north ? dh : 0), w: r.w + dw, h: r.h + dh } });
      session.previewStyle(id, applyEdit(d.styles[id] ?? '', edit.set));
    }
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && d.kind === 'pending' && !d.hitDone) { d.released = true; return; } // finish once the hit-test resolves
    drag.current = null;
    setGuides({ v: [], h: [] });
    if (!d) return;
    if (d.kind === 'marquee' && d.moved) {
      const a = toView({ clientX: d.x0, clientY: d.y0 });
      const b = toView(e);
      const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
      const st = useStore.getState();
      const inside = st.slideObjects.filter((id) => { const r = st.rects[id]; return r && r.visible && r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x2 && r.y + r.h <= box.y2; });
      useStore.setState({ selection: outermost(inside, (x, anc) => session.isDescendant(x, anc)) });
      setMarquee(null);
      return;
    }
    setMarquee(null);
    if (d.kind === 'move' && d.moved && live) {
      const dxS = e.clientX - d.x0; const dyS = e.clientY - d.y0;
      void dxS; void dyS;
      const edits = d.ids.map((id) => {
        const r = d.rects[id]!; const l = live[id]!;
        return { id, set: moveEdit(r, d.styles[id] ?? '', (l.x - r.x) / r.sx, (l.y - r.y) / r.sy, ctx).set };
      });
      session.exec(styleMultiCommand(edits.length > 1 ? `Move ${edits.length} objects` : 'Move object', edits));
    } else if (d.kind === 'resize' && d.moved && live && d.handle) {
      const id = d.ids[0]!; const r = d.rects[id]!;
      const aspect = e.shiftKey ? !KEEP_ASPECT.has(r.tag) : KEEP_ASPECT.has(r.tag) && d.handle.length === 2;
      const { edit } = resizeEdit(r, d.styles[id] ?? '', d.handle, (e.clientX - d.x0) / z / r.sx, (e.clientY - d.y0) / z / r.sy, ctx, aspect);
      session.exec(styleMultiCommand('Resize object', [{ id, set: edit.set }]));
    } else if (d.kind === 'move' && !d.moved && d.hitId !== null) {
      const sel = useStore.getState().selection;
      if (sel.length > 1 && !d.shift) useStore.setState({ selection: [d.hitId] });
      else if (d.wasSelected && sel.length === 1) {
        const r = useStore.getState().rects[d.hitId];
        if (r?.text) { const v = toView(e); session.startEdit(d.hitId, { x: v.x, y: v.y, mode: 'caret' }); } // clicking an already-selected text object enters editing (TXT-02)
      }
    }
    setLive(null);
    session.queueRefresh();
  };

  const onDouble = async (e: React.MouseEvent) => {
    if (s.editing !== null) return;
    const { picked } = await hitObject(e);
    if (picked === null) return;
    useStore.setState({ selection: [picked] });
    const v = toView(e);
    session.startEdit(picked, { x: v.x, y: v.y, mode: 'word' });
  };

  const onContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const { picked } = await hitObject(e);
    if (picked !== null && !useStore.getState().selection.includes(picked)) useStore.setState({ selection: [picked] });
    const r = stage.current!.getBoundingClientRect();
    setMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const ctxFor = (id: number) => s.rects[id];
  void ctxFor;

  return (
    <div className="canvas-wrap" tabIndex={0} aria-label="Slide canvas" ref={wrap} onWheel={onWheel} data-testid="canvas" data-bridge-ready={s.bridgeReady ? '1' : '0'}>
      <div className="stage" ref={stage} style={{ width: VW * z, height: VH * z }}>
        {s.src && (
          <iframe
            key={s.loadNonce}
            ref={(el) => session.attachIframe(el)}
            title="Slide"
            data-testid="live-view"
            src={s.src}
            // allow-same-origin is safe here only because the document origin differs from the editor's (RND-01)
            sandbox={s.scriptsOn ? 'allow-scripts allow-same-origin' : ''}
            onLoad={() => session.onFrameLoad()}
            style={{ width: VW, height: VH, transform: `scale(${z})`, transformOrigin: '0 0' }}
            referrerPolicy="origin"
            allow=""
          />
        )}
        <div
          className="overlay"
          style={{ pointerEvents: s.editing !== null ? 'none' : 'auto' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onDoubleClick={onDouble} onContextMenu={onContext} data-testid="overlay"
        >
          {s.hover !== null && !s.selection.includes(s.hover) && s.rects[s.hover] && <Outline b={s.rects[s.hover]!} z={z} cls="hover" label={labelFor(s.rects[s.hover]!)} />}
          {s.selection.map((id) => { const b = boxOf(id); return b ? <Outline key={id} b={b} z={z} cls="sel" label={badge(s.rects[id])} /> : null; })}
          {s.selection.length === 1 && s.editing === null && (() => {
            const id = s.selection[0]!; const b = boxOf(id);
            if (!b) return null;
            return HANDLES.map((hd) => (
              <div key={hd.h} className="handle" data-handle={hd.h} style={{ left: (b.x + b.w * hd.x) * z - 5, top: (b.y + b.h * hd.y) * z - 5, cursor: `${hd.h}-resize` }} />
            ));
          })()}
          {s.selection.length === 1 && s.editing !== null && boxOf(s.editing) && <Outline b={boxOf(s.editing)!} z={z} cls="edit" label="Editing" />}
          {guides.v.map((x) => <div key={`v${x}`} className="guide v" style={{ left: x * z }} />)}
          {guides.h.map((y) => <div key={`h${y}`} className="guide h" style={{ top: y * z }} />)}
          {marquee && <div className="marquee" style={{ left: marquee.x * z, top: marquee.y * z, width: marquee.w * z, height: marquee.h * z }} />}
          {live && s.selection.length === 1 && s.rects[s.selection[0]!] && (() => {
            const id = s.selection[0]!; const l = live[id]; const r = s.rects[id]!;
            if (!l || !slideRect) return null;
            return <div className="tip" style={{ left: l.x * z + 8, top: (l.y + l.h) * z + 8 }}>X {Math.round((l.x - slideRect.x) / r.sx)} Y {Math.round((l.y - slideRect.y) / r.sy)} · W {Math.round(l.w / r.sx)} H {Math.round(l.h / r.sy)}</div>;
          })()}
        </div>
        {menu && <ContextMenu x={menu.x} y={menu.y} close={() => setMenu(null)} />}
      </div>
    </div>
  );
}

function applyEdit(style: string, set: Record<string, string | null>): string {
  // preview only: build a style string cheaply (final write goes through the validated patch engine)
  const map = new Map<string, string>();
  for (const part of style.split(';')) { const i = part.indexOf(':'); if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim()); }
  for (const [k, v] of Object.entries(set)) { if (v === null) map.delete(k); else map.set(k, v); }
  return [...map].map(([k, v]) => `${k}: ${v}`).join('; ');
}

function labelFor(r: Rect): string { return r.cls ? `${r.tag}.${r.cls.split(/\s+/)[0]}` : r.tag; }
function badge(r?: Rect): string { return r ? (r.iframeLike ? 'Embedded content' : isFree(r) ? 'Free' : 'In layout') : ''; }

function Outline({ b, z, cls, label }: { b: Box; z: number; cls: string; label: string }): JSX.Element {
  return <div className={`outline ${cls}`} style={{ left: b.x * z, top: b.y * z, width: b.w * z, height: b.h * z }}>{label && <span className="lbl">{label}</span>}</div>;
}

function ContextMenu({ x, y, close }: { x: number; y: number; close: () => void }): JSX.Element {
  const sel = useStore((s) => s.selection);
  const has = sel.length > 0;
  const act = (fn: () => void) => () => { fn(); close(); };
  return (
    <div className="ctxmenu" style={{ left: x, top: y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'edit-text' })))}>Edit Text</button>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'copy' })))}>Copy</button>
      <button onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'paste' })))}>Paste</button>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'duplicate' })))}>Duplicate</button>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'front' })))}>Bring to Front</button>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'back' })))}>Send to Back</button>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'reset-position' })))}>Reset Position</button>
      <button disabled={!has} onClick={act(() => window.dispatchEvent(new CustomEvent('deckhand-cmd', { detail: 'delete' })))}>Delete</button>
    </div>
  );
}
