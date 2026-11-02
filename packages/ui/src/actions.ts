/** User-level actions shared by ribbon, shortcuts and context menu. */
import { deleteElementCommand, duplicateElementCommand, getAttr, reorderCommand, styleMultiCommand, type ElementInfo, type Patch } from '@deckhand/core';
import { detectUnitMode, moveEdit } from './geometry';
import { session, useStore } from './session';
import { ai, useAi } from './ai';

const st = () => useStore.getState();

function ctx() {
  const s = st();
  const styleText = session.doc.elements.filter((e) => e.tag === 'style').map((e) => session.doc.text.slice(e.startTagEnd, e.endTagStart ?? e.startTagEnd)).join('\n');
  const slideRect = s.rects[s.slides[s.slide]?.id ?? -1];
  return { mode: detectUnitMode(styleText, slideRect?.sx ?? 1), vp: s.viewport };
}

export function nudge(dx: number, dy: number): void {
  let s = st();
  if (!s.selection.length) return;
  if (s.selection.some((id) => !s.rects[id])) {
    // geometry not measured yet (key pressed right after selecting): measure first instead of silently ignoring the key
    void session.refreshRects().then(() => nudge(dx, dy));
    return;
  }
  s = st();
  const c = ctx();
  // 1 px in the design viewport; CSS px = viewport px / scale
  const fixed = s.selection.flatMap((id) => {
    const r = s.rects[id];
    return r ? [{ id, set: moveEdit(r, session.styleOf(id), dx / r.sx, dy / r.sy, c).set }] : [];
  });
  session.exec(styleMultiCommand('Nudge', fixed, 'nudge'));
  // Keep cached geometry current so key-repeat nudges accumulate instead of restarting from a stale measurement
  useStore.setState((x) => {
    const rects = { ...x.rects };
    for (const id of x.selection) {
      const r = rects[id];
      if (!r) continue;
      rects[id] = {
        ...r, x: r.x + dx, y: r.y + dy,
        left: r.left === null ? null : r.left + dx / r.sx, right: r.right === null ? null : r.right - dx / r.sx,
        top: r.top === null ? null : r.top + dy / r.sy, bottom: r.bottom === null ? null : r.bottom - dy / r.sy,
      };
    }
    return { rects };
  });
}

export function deleteSelection(): void {
  const s = st();
  if (!s.selection.length) return;
  const top = s.selection.filter((id) => !s.selection.some((o) => o !== id && session.isDescendant(id, o)));
  // delete from the end so earlier offsets stay valid: do it as one transaction via one command
  session.exec({
    label: top.length > 1 ? `Delete ${top.length} objects` : 'Delete object',
    build: (doc) => top.flatMap((id) => deleteElementCommand(id).build(doc)),
  });
  st(); useStore.setState({ selection: [] });
}

export function duplicateSelection(): void {
  const s = st();
  if (!s.selection.length) return;
  const ids = [...s.selection];
  session.exec({
    label: 'Duplicate',
    build: (doc) => ids.flatMap((id) => duplicateElementCommand(id).build(doc)),
  });
}

export function copySelection(cut = false): void {
  const s = st();
  const id = s.selection[0];
  if (id === undefined) return;
  const el = session.doc.byId(id);
  if (!el) return;
  session.clipboard = session.doc.text.slice(el.start, el.end);
  if (cut) deleteSelection();
}

export function paste(): void {
  const s = st();
  const html = session.clipboard;
  const slide = session.slideRoot();
  if (!html || !slide || slide.endTagStart === null) return;
  const eol = session.doc.meta.eol === 'crlf' ? '\r\n' : '\n';
  const indent = /([ \t]*)$/.exec(session.doc.text.slice(0, slide.endTagStart))?.[1] ?? '';
  const at = slide.endTagStart - (indent.length && session.doc.text[slide.endTagStart - indent.length - 1] === '\n' ? indent.length : 0);
  const text = indent.length ? `${indent}  ${html}${eol}` : html;
  session.exec({ label: 'Paste', build: () => [{ start: at, end: at, text }] as Patch[] });
  void s;
}

/** POS-10: z-index relative to siblings that overlap in the same container. */
export function arrange(kind: 'front' | 'back' | 'forward' | 'backward'): void {
  const s = st();
  const id = s.selection[0];
  if (id === undefined) return;
  const r = s.rects[id];
  const el = session.doc.byId(id);
  if (!r || !el || el.parent === null) return;
  const sibs = session.doc.byId(el.parent)!.children.filter((c) => c !== id).map((c) => s.rects[c]).filter((x): x is NonNullable<typeof x> => !!x);
  const z = sibs.map((x) => x.zIndex);
  const cur = r.zIndex;
  const next = kind === 'front' ? Math.max(cur, ...z, 0) + 1 : kind === 'back' ? Math.min(cur, ...z, 0) - 1 : kind === 'forward' ? cur + 1 : cur - 1;
  const set: Record<string, string> = { 'z-index': String(next) };
  if (r.position === 'static') set['position'] = 'relative';
  session.exec(styleMultiCommand('Arrange', [{ id, set }]));
}

export function align(kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const s = st();
  const slide = s.rects[s.slides[s.slide]?.id ?? -1];
  if (!slide || !s.selection.length) return;
  const c = ctx();
  const sel = s.selection.map((id) => s.rects[id]).filter((r): r is NonNullable<typeof r> => !!r);
  const multi = sel.length > 1;
  const box = multi
    ? { x: Math.min(...sel.map((r) => r.x)), y: Math.min(...sel.map((r) => r.y)), x2: Math.max(...sel.map((r) => r.x + r.w)), y2: Math.max(...sel.map((r) => r.y + r.h)) }
    : { x: slide.x, y: slide.y, x2: slide.x + slide.w, y2: slide.y + slide.h };
  const edits = sel.map((r) => {
    let dx = 0; let dy = 0;
    if (kind === 'left') dx = box.x - r.x; else if (kind === 'right') dx = box.x2 - (r.x + r.w); else if (kind === 'center') dx = (box.x + box.x2) / 2 - (r.x + r.w / 2);
    if (kind === 'top') dy = box.y - r.y; else if (kind === 'bottom') dy = box.y2 - (r.y + r.h); else if (kind === 'middle') dy = (box.y + box.y2) / 2 - (r.y + r.h / 2);
    return { id: r.id, set: moveEdit(r, session.styleOf(r.id), dx / r.sx, dy / r.sy, c).set };
  });
  session.exec(styleMultiCommand('Align', edits));
}

// ---- slides ---------------------------------------------------------------------------------------------------
export function slideElement(i = st().slide): ElementInfo | undefined { return session.doc.byId(st().slides[i]?.id ?? -1); }

export function duplicateSlide(): void {
  const el = slideElement();
  if (!el) return;
  const idx = st().slide;
  session.exec(duplicateElementCommand(el.id));
  setTimeout(() => session.goTo(idx + 1), 200);
}

export function deleteSlide(): void {
  const el = slideElement();
  if (!el || st().slides.length <= 1) return;
  const idx = st().slide;
  session.exec(deleteElementCommand(el.id, 'Delete slide'));
  setTimeout(() => session.goTo(Math.min(idx, st().slides.length - 1)), 200);
}

export function moveSlide(from: number, toBefore: number): void {
  const s = st();
  const a = s.slides[from]; const b = s.slides[toBefore];
  if (!a || from === toBefore || from + 1 === toBefore) return;
  const parent = session.doc.byId(a.id)?.parent;
  const parentEl = parent === null || parent === undefined ? undefined : session.doc.byId(parent);
  session.exec(reorderCommand(a.id, b ? b.id : null, parentEl?.endTagStart ?? undefined));
  setTimeout(() => session.goTo(toBefore > from ? toBefore - 1 : toBefore), 250);
}

/** INS-01: Free text box inside the current slide, inheriting the deck's text style. */
export function insertTextBox(at?: { x: number; y: number }): void {
  const s = st();
  const slide = session.slideRoot();
  const rect = s.rects[slide?.id ?? -1];
  if (!slide || !rect || slide.endTagStart === null) return;
  const doc = session.doc;
  const x = at?.x ?? (rect.w / rect.sx) / 2 - 200;
  const y = at?.y ?? (rect.h / rect.sy) / 2 - 30;
  const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
  const lineStart = doc.text.lastIndexOf('\n', slide.endTagStart - 1) + 1;
  const closeIndent = /^[ \t]*$/.test(doc.text.slice(lineStart, slide.endTagStart)) ? doc.text.slice(lineStart, slide.endTagStart) : null;
  const html = `<div style="position: absolute; left: ${Math.round(x)}px; top: ${Math.round(y)}px; width: 400px;">Click to add text</div>`;
  const patches: Patch[] = [];
  // the slide needs a positioning context for a Free object
  if (rect.position === 'static') {
    const p = session.doc.byId(slide.id)!;
    const cur = getAttr(p, 'style') ?? '';
    const next = cur ? `${cur.replace(/;?\s*$/, '')}; position: relative;` : 'position: relative;';
    patches.push(styleAttrPatch(p, cur !== '' || getAttr(p, 'style') !== undefined, next));
  }
  const text = closeIndent !== null ? `${closeIndent}  ${html}${eol}` : html;
  const at2 = closeIndent !== null ? lineStart : slide.endTagStart;
  patches.push({ start: at2, end: at2, text });
  const nonce0 = useStore.getState().loadNonce;
  session.exec({ label: 'Insert text box', build: () => patches });
  // Start editing only once the structural edit's reload has finished and the agent is back; otherwise the reload wipes the edit state.
  const began = Date.now();
  const tryEdit = (): void => {
    const st = useStore.getState();
    if ((st.loadNonce === nonce0 || !st.agentReady) && Date.now() - began < 15000) { setTimeout(tryEdit, 100); return; }
    const n = session.doc.elements.filter((e) => e.start >= at2 && e.start < at2 + text.length && e.tag === 'div').at(0);
    if (n) { useStore.setState({ selection: [n.id] }); setTimeout(() => session.startEdit(n.id), 150); }
  };
  setTimeout(tryEdit, 100);
}

function styleAttrPatch(el: ElementInfo, has: boolean, value: string): Patch {
  const doc = session.doc;
  const existing = el.attrs.find((a) => a.name === 'style');
  if (has && existing) return { start: existing.start, end: existing.end, text: `style="${value}"` };
  const pos = el.startTagEnd - (doc.text[el.startTagEnd - 2] === '/' ? 2 : 1);
  return { start: pos, end: pos, text: ` style="${value}"` };
}

export function startShow(from: number): void {
  const id = st().docId;
  if (id) void window.deckhand.startShow(id, from);
}

export async function exportPdf(): Promise<void> {
  const s = st();
  if (!s.docId) return;
  try {
    const out = await window.deckhand.exportPdf(s.docId, s.slides.length);
    if (out) session.notify('info', 'Saved ' + out);
  } catch (e) { session.notify('error', (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
}

export function installKeyboard(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const s = st();
    if (!s.loaded) return;
    if (e.key === 'F5') { e.preventDefault(); startShow(e.shiftKey ? s.slide : 0); return; }
    if (mod && e.altKey && e.key.toLowerCase() === 'i') { e.preventDefault(); ai.setDock(useAi.getState().dock === 'ai' ? 'format' : 'ai'); return; }
    const k = e.key;
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); void (e.shiftKey ? session.saveAs() : session.save()); return; }
    if (s.editing !== null) { if (k === 'Escape') { e.preventDefault(); void session.endEdit(true); } return; }
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); session.redo(); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); if (s.selection.length) duplicateSelection(); else duplicateSlide(); return; }
    if (mod && k.toLowerCase() === 'c') { copySelection(); return; }
    if (mod && k.toLowerCase() === 'x') { copySelection(true); return; }
    if (mod && k.toLowerCase() === 'v') { paste(); return; }
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault();
      const root = s.slides[s.slide]?.id ?? -2;
      useStore.setState({ selection: s.slideObjects.filter((id) => session.doc.byId(id)?.parent === root) }); // SEL-06: top-level objects
      return;
    }
    if (mod && k === '0') { e.preventDefault(); useStore.setState({ fit: true }); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); useStore.setState((x) => ({ fit: false, zoom: Math.min(4, x.zoom * 1.1) })); return; }
    if (mod && k === '-') { e.preventDefault(); useStore.setState((x) => ({ fit: false, zoom: Math.max(0.1, x.zoom / 1.1) })); return; }
    if (k === 'Delete' || k === 'Backspace') { if (s.selection.length) { e.preventDefault(); deleteSelection(); } return; }
    if (k === 'F2' || k === 'Enter') { const id = s.selection[0]; if (id !== undefined && s.rects[id]?.text) { e.preventDefault(); session.startEdit(id); } return; }
    if (k === 'Escape') {
      const id = s.selection[0];
      if (id === undefined) return;
      const parent = session.doc.byId(id)?.parent;
      const slideId = s.slides[s.slide]?.id;
      useStore.setState({ selection: parent !== null && parent !== undefined && parent !== slideId && session.isDescendant(parent, slideId ?? -1) ? [parent] : [] });
      return;
    }
    if (k === 'PageDown') { e.preventDefault(); session.goTo(s.slide + 1); return; }
    if (k === 'PageUp') { e.preventDefault(); session.goTo(s.slide - 1); return; }
    if (k.startsWith('Arrow') && s.selection.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
    }
  };
  const onCmd = (e: Event): void => {
    const c = (e as CustomEvent<string>).detail;
    const s = st();
    if (c === 'edit-text' && s.selection[0] !== undefined) session.startEdit(s.selection[0]);
    else if (c === 'copy') copySelection();
    else if (c === 'paste') paste();
    else if (c === 'duplicate') duplicateSelection();
    else if (c === 'front' || c === 'back') arrange(c);
    else if (c === 'delete') deleteSelection();
    else if (c === 'reset-position' && s.selection.length) session.exec(styleMultiCommand('Reset position', s.selection.map((id) => ({ id, set: { translate: null } }))));
  };
  const onAgentKey = (e: Event): void => {
    const m = (e as CustomEvent<{ key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean; fwd?: boolean }>).detail;
    if (m.fwd) {
      // key pressed while the live view had focus (not editing): replay it as if typed in the editor
      window.dispatchEvent(new KeyboardEvent('keydown', { key: m.key, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, metaKey: !!m.meta, bubbles: true, cancelable: true }));
      return;
    }
    if (m.key === 's') void session.save();
    else if (m.key === 'z') { void session.endEdit(true).then(() => (m.shift ? session.redo() : session.undo())); }
    else if (m.key === 'y') { void session.endEdit(true).then(() => session.redo()); }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('deckhand-cmd', onCmd);
  window.addEventListener('deckhand-key', onAgentKey);
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('deckhand-cmd', onCmd); window.removeEventListener('deckhand-key', onAgentKey); };
}
