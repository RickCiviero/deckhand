/** User-level actions shared by ribbon, shortcuts and context menu. */
import { applyToSimilarCommand, isObjectTag, groupCommand, groupProblem, isGroup, ungroupCommand, removeAttrPatch, PAINTABLE, isLocked, isSafeCssProp, isSafeCssValue, styleDeclarations, newSlideCommand, deleteElementCommand, duplicateElementCommand, getAttr, reorderCommand, setAttrPatch, patchCommand, styleMultiCommand, type ElementInfo, type Patch } from '@deckhand/core';
import { detectUnitMode, distributeShifts, moveEdit } from './geometry';
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
  if (s.selection.some((id) => isLocked(session.doc, id))) return; // SEL-08
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
  if (s.selection.some((id) => isLocked(session.doc, id))) { session.notify('info', 'A locked object cannot be deleted. Unlock it in the Selection Pane first.'); return; }
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

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;
const freeRect = (r: { position: string; left: number | null; top: number | null; anchors: { right: boolean; bottom: boolean } | null; transform: string | null }): boolean =>
  r.position === 'absolute' && r.left !== null && r.top !== null && !r.anchors?.right && !r.anchors?.bottom && (!r.transform || r.transform === 'none');

type Rc = NonNullable<ReturnType<typeof st>['rects'][number]>;
/** The layout box of a freely positioned object in its container's pixels. The browser reports left/top as used values, so they are right even when the deck anchors the object with right/bottom; a rotation or scale does not move the layout box. */
function layoutBox(r: Rc): { l: number; t: number; w: number; h: number; anchoredRight: boolean; anchoredBottom: boolean } | null {
  if (r.position !== 'absolute' || r.left === null || r.top === null) return null;
  const w = r.width !== null ? r.width + r.extraW : r.w / r.sx;
  const h = r.height !== null ? r.height + r.extraH : r.h / r.sy;
  return { l: r.left, t: r.top, w, h, anchoredRight: !!r.anchors?.right, anchoredBottom: !!r.anchors?.bottom };
}

/** Group (ARR-03): wrap the selected sibling objects in a div. Free objects get a wrapper with their bounding box and are re-positioned inside it. */
export function groupSelection(): void {
  const s = st();
  const problem = groupProblem(session.doc, s.selection);
  if (problem) { session.notify('info', problem); return; }
  const rects = s.selection.map((id) => s.rects[id]);
  if (rects.some((r) => !r)) { session.notify('info', 'The objects have not been measured yet. Try again in a moment.'); return; }
  const rs = rects as NonNullable<(typeof rects)[number]>[];
  const boxes = rs.map(layoutBox);
  if (boxes.every(Boolean)) {
    const bs = boxes as NonNullable<(typeof boxes)[number]>[];
    const L = Math.min(...bs.map((b) => b.l)); const T = Math.min(...bs.map((b) => b.t));
    const R = Math.max(...bs.map((b) => b.l + b.w)); const B = Math.max(...bs.map((b) => b.t + b.h));
    // an object anchored to the right or bottom is written as left/top inside the group; its old anchor is overridden (it may come from the deck's CSS)
    const childSet = new Map(rs.map((r, i) => [r.id, { left: px(bs[i]!.l - L), top: px(bs[i]!.t - T), ...(bs[i]!.anchoredRight ? { right: 'auto' } : {}), ...(bs[i]!.anchoredBottom ? { bottom: 'auto' } : {}) }] as const));
    session.exec(groupCommand(s.selection, { position: 'absolute', left: px(L), top: px(T), width: px(R - L), height: px(B - T) }, childSet));
  } else if (boxes.some(Boolean)) {
    session.notify('info', 'Group needs all the objects to be positioned freely, or none of them. Use Position > Reset on the others first.');
  } else {
    session.exec(groupCommand(s.selection, null, new Map()));
    session.notify('warning', 'The group stays in the page flow, so the layout may change. Undo (Ctrl+Z) puts it back.');
  }
}

export function ungroupSelection(): void {
  const s = st();
  const id = s.selection[0];
  if (id === undefined || s.selection.length !== 1 || !isGroup(session.doc, id)) { session.notify('info', 'Select a group made with Deckhand to ungroup it.'); return; }
  const g = session.doc.byId(id)!;
  const gr = s.rects[id];
  const childSet = new Map<number, Record<string, string>>();
  if (gr && freeRect(gr)) {
    for (const k of g.children) {
      const r = s.rects[k];
      if (!r) { if (isObjectTag(session.doc.byId(k)?.tag ?? '')) { session.notify('info', 'The objects have not been measured yet. Try again in a moment.'); return; } continue; }
      if (!freeRect(r)) { session.notify('info', 'A member of this group is not positioned freely, so it cannot be ungrouped safely.'); return; }
      childSet.set(k, { left: px(r.left! + gr.left!), top: px(r.top! + gr.top!) });
    }
  }
  session.exec(ungroupCommand(id, childSet));
}

export function distribute(axis: 'h' | 'v'): void {
  const s = st();
  const sel = s.selection.map((id) => s.rects[id]).filter((r): r is NonNullable<typeof r> => !!r);
  const shifts = distributeShifts(sel, axis);
  if (!shifts.size) { session.notify('info', 'Select three or more objects to distribute them.'); return; }
  const c = ctx();
  const edits = sel.flatMap((r) => {
    const d = shifts.get(r.id);
    return d === undefined ? [] : [{ id: r.id, set: moveEdit(r, session.styleOf(r.id), axis === 'h' ? d / r.sx : 0, axis === 'v' ? d / r.sy : 0, c).set }];
  });
  session.exec(styleMultiCommand('Distribute', edits));
}

// ---- slides ---------------------------------------------------------------------------------------------------
export function slideElement(i = st().slide): ElementInfo | undefined { return session.doc.byId(st().slides[i]?.id ?? -1); }

export function duplicateSlide(): void {
  const el = slideElement();
  if (!el) return;
  const idx = st().slide;
  session.exec(duplicateElementCommand(el.id));
  session.goTo(idx + 1); // not on a timer: a late timer would override a slide the user clicked in the meantime
}

/** New Slide gallery (ADP-07): after the current slide, from a deck layout or blank. */
export function newSlide(from: number | 'blank'): void {
  const el = slideElement();
  if (!el) return;
  const idx = st().slide;
  session.exec(newSlideCommand(from, el.id, el.id));
  session.goTo(idx + 1);
}

/** Hide Slide (SLD-02): only where the format has a hide marker, which is reveal.js `data-visibility="hidden"`. */
export const canHideSlides = (): boolean => st().detection?.adapter === 'revealjs';
export function toggleHideSlide(): void {
  const el = slideElement();
  if (!el || !canHideSlides()) return;
  const hidden = getAttr(el, 'data-visibility') === 'hidden';
  session.exec(patchCommand(hidden ? 'Show slide' : 'Hide slide', (d) => {
    const e = d.byId(el.id);
    const p = e ? (hidden ? removeAttrPatch(d, e, 'data-visibility') : setAttrPatch(d, e, 'data-visibility', 'hidden')) : null;
    return p ? [p] : [];
  }));
}

export function deleteSlide(): void {
  const el = slideElement();
  if (!el || st().slides.length <= 1) return;
  const idx = st().slide;
  session.exec(deleteElementCommand(el.id, 'Delete slide'));
  session.goTo(Math.min(idx, st().slides.length - 1));
}

export function moveSlide(from: number, toBefore: number): void {
  const s = st();
  const a = s.slides[from]; const b = s.slides[toBefore];
  if (!a || from === toBefore || from + 1 === toBefore) return;
  const parent = session.doc.byId(a.id)?.parent;
  const parentEl = parent === null || parent === undefined ? undefined : session.doc.byId(parent);
  session.exec(reorderCommand(a.id, b ? b.id : null, parentEl?.endTagStart ?? undefined));
  session.goTo(toBefore > from ? toBefore - 1 : toBefore);
}

/** INS-01: Free text box inside the current slide, inheriting the deck's text style. */
export function insertTextBox(at?: { x: number; y: number }): void {
  insertFree('Insert text box', { w: 400, h: 60 }, (x, y) => `<div style="position: absolute; left: ${x}px; top: ${y}px; width: 400px;">Click to add text</div>`, true, at);
}

/** Insert > Shapes (SHP-01, reduced): a plain div with inline styling, drawn centred on the slide. */
export function insertShape(kind: 'rectangle' | 'rounded' | 'ellipse' | 'line'): void {
  const fill = 'background: #4472c4;';
  const body = kind === 'line' ? { w: 400, h: 4, css: 'width: 400px; height: 4px; background: #4472c4;' }
    : { w: 300, h: 180, css: `width: 300px; height: 180px; ${fill}${kind === 'ellipse' ? ' border-radius: 50%;' : kind === 'rounded' ? ' border-radius: 24px;' : ''}` };
  insertFree(`Insert ${kind === 'rounded' ? 'rounded rectangle' : kind}`, body, (x, y) => `<div style="position: absolute; left: ${x}px; top: ${y}px; ${body.css}"></div>`, false);
}

/** Insert > Table (TBL-01, reduced): a plain table with inline cell borders, placed as a Free object. Row and column editing is not built yet. */
export function insertTable(rows: number, cols: number): void {
  const r = Math.max(1, Math.min(20, Math.floor(rows))); const c = Math.max(1, Math.min(12, Math.floor(cols)));
  const cell = (tag: 'th' | 'td', text: string): string => `<${tag} style="border: 1px solid #888; padding: 12px 20px; min-width: 120px; text-align: left;">${text}</${tag}>`;
  const row = (i: number): string => `<tr>${Array.from({ length: c }, (_, j) => cell(i === 0 ? 'th' : 'td', i === 0 ? `Column ${j + 1}` : 'Text')).join('')}</tr>`;
  const inner = Array.from({ length: r }, (_, i) => row(i)).join('');
  insertFree(`Insert ${r}×${c} table`, { w: c * 160, h: r * 60 }, (x, y) => `<table style="position: absolute; left: ${x}px; top: ${y}px; border-collapse: collapse; font-size: 28px;"><tbody>${inner}</tbody></table>`, false);
}

// Insert > Icons (ICO-01, reduced): a few drawn-in-place SVG icons, no network. They take the text colour (currentColor) and are plain markup in the file.
export const ICONS: Record<string, { label: string; path: string }> = {
  check: { label: 'Check', path: 'M4 12.5l5 5L20 6.5' },
  cross: { label: 'Cross', path: 'M5 5l14 14M19 5L5 19' },
  arrow: { label: 'Arrow', path: 'M4 12h15M13 6l6 6-6 6' },
  plus: { label: 'Plus', path: 'M12 4v16M4 12h16' },
  star: { label: 'Star', path: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  heart: { label: 'Heart', path: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z' },
  info: { label: 'Info', path: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z' },
};
export function insertIcon(key: keyof typeof ICONS): void {
  const ic = ICONS[key];
  if (!ic) return;
  insertFree(`Insert icon: ${ic.label}`, { w: 96, h: 96 }, (x, y) => `<svg viewBox="0 0 24 24" role="img" aria-label="${ic.label}" style="position: absolute; left: ${x}px; top: ${y}px; width: 96px; height: 96px; color: #4472c4;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ic.path}"/></svg>`, false);
}

function insertFree(label: string, size: { w: number; h: number }, html: (x: number, y: number) => string, edit: boolean, at?: { x: number; y: number }): void {
  const s = st();
  const slide = session.slideRoot();
  const rect = s.rects[slide?.id ?? -1];
  if (!slide || !rect || slide.endTagStart === null) return;
  const doc = session.doc;
  const x = Math.round(at?.x ?? (rect.w / rect.sx) / 2 - size.w / 2);
  const y = Math.round(at?.y ?? (rect.h / rect.sy) / 2 - size.h / 2);
  const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
  const lineStart = doc.text.lastIndexOf('\n', slide.endTagStart - 1) + 1;
  const closeIndent = /^[ \t]*$/.test(doc.text.slice(lineStart, slide.endTagStart)) ? doc.text.slice(lineStart, slide.endTagStart) : null;
  const markup = html(x, y);
  const patches: Patch[] = [];
  // the slide needs a positioning context for a Free object
  if (rect.position === 'static') {
    const p = session.doc.byId(slide.id)!;
    const cur = getAttr(p, 'style') ?? '';
    const next = cur ? `${cur.replace(/;?\s*$/, '')}; position: relative;` : 'position: relative;';
    patches.push(styleAttrPatch(p, cur !== '' || getAttr(p, 'style') !== undefined, next));
  }
  const text = closeIndent !== null ? `${closeIndent}  ${markup}${eol}` : markup;
  const at2 = closeIndent !== null ? lineStart : slide.endTagStart;
  patches.push({ start: at2, end: at2, text });
  const nonce0 = useStore.getState().loadNonce;
  session.exec({ label, build: () => patches });
  // Start editing only once the structural edit's reload has finished and the bridge is back; otherwise the reload wipes the edit state.
  const began = Date.now();
  const tryEdit = (): void => {
    const st = useStore.getState();
    if ((st.loadNonce === nonce0 || !st.bridgeReady) && Date.now() - began < 15000) { setTimeout(tryEdit, 100); return; }
    const n = session.doc.elements.filter((e) => e.start >= at2 && e.start < at2 + text.length && isObjectTag(e.tag)).at(0);
    if (n) { useStore.setState({ selection: [n.id] }); if (edit) setTimeout(() => session.startEdit(n.id), 150); }
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

export function previewInBrowser(): void {
  const id = st().docId;
  if (id) void window.deckhand.previewInBrowser(id).then((u) => session.notify('info', `Preview running at ${String(u)} (this computer only; stops when you close the document)`)).catch((e: Error) => session.notify('error', `Could not start the preview: ${e.message}`));
}

export async function exportPdf(): Promise<void> {
  const s = st();
  if (!s.docId) return;
  try {
    const out = await window.deckhand.exportPdf(s.docId, s.slides.length);
    if (out) session.notify('info', 'Saved ' + out);
  } catch (e) { session.notify('error', (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
}

const clean = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/** Export the current slide, or every slide, as PNG pictures. */
export async function exportPng(all: boolean): Promise<void> {
  const s = st();
  if (!s.docId) return;
  try {
    const out = await window.deckhand.exportPng(s.docId, s.slides.length, all ? null : s.slide);
    if (out) session.notify('info', 'Saved ' + out);
  } catch (e) { session.notify('error', clean(e)); }
}

/** Export one HTML file with every local picture, style, script and font written into it. */
export async function exportSingle(): Promise<void> {
  const s = st();
  if (!s.docId) return;
  try {
    const out = await window.deckhand.exportSingle(s.docId, session.doc.text);
    if (!out) return;
    session.notify(out.missing.length ? 'warning' : 'info', `Saved ${out.file} with ${out.inlined} file${out.inlined === 1 ? '' : 's'} inside.${out.missing.length ? ` Not found, left as links: ${out.missing.slice(0, 3).join(', ')}${out.missing.length > 3 ? '…' : ''}` : ''}`);
  } catch (e) { session.notify('error', clean(e)); }
}

export function installKeyboard(): () => void {
  // Format Painter applies when a different object gets selected
  const unsub = useStore.subscribe((x, prev) => {
    const p = x.painter;
    if (!p || x.selection === prev.selection || !x.selection.length || x.selection.includes(p.from)) return;
    setSelectionStyle('Format Painter', p.set);
    if (!p.sticky) useStore.setState({ painter: null });
  });
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const s = st();
    if (e.key === 'F1') { e.preventDefault(); window.dispatchEvent(new CustomEvent('deckhand-help')); return; }
    if (!s.loaded) return;
    if (mod && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) { e.preventDefault(); useStore.setState({ findOpen: true }); return; }
    if (mod && e.key.toLowerCase() === 'g' && !e.altKey) { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
    if (e.key === 'F5') { e.preventDefault(); startShow(e.shiftKey ? s.slide : 0); return; }
    if (e.altKey && e.key === 'F10') { e.preventDefault(); ai.setDock(useAi.getState().dock === 'selection' ? 'format' : 'selection'); return; }
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
      if (s.painter) { useStore.setState({ painter: null }); return; }
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
  const onBridgeKey = (e: Event): void => {
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
  window.addEventListener('deckhand-key', onBridgeKey);
  return () => { unsub(); window.removeEventListener('keydown', onKey); window.removeEventListener('deckhand-cmd', onCmd); window.removeEventListener('deckhand-key', onBridgeKey); };
}

const errMsg = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/** Insert > Pictures: the main process copies the file next to the deck (IMG-02); the new <img> is a Free object on the current slide. */
export async function insertPicture(): Promise<void> {
  const s = st();
  const slide = session.slideRoot();
  const rect = s.rects[slide?.id ?? -1];
  if (!s.docId || !slide || !rect || slide.endTagStart === null) return;
  try {
    const pic = await window.deckhand.pickImage(s.docId);
    if (!pic) return;
    const sw = rect.w / rect.sx;
    const sh = rect.h / rect.sy;
    const w = Math.round(Math.min(pic.w, sw * 0.6, (sh * 0.6 * pic.w) / pic.h));
    const h = Math.round((w * pic.h) / pic.w);
    const doc = session.doc;
    const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
    const lineStart = doc.text.lastIndexOf('\n', slide.endTagStart - 1) + 1;
    const closeIndent = /^[ \t]*$/.test(doc.text.slice(lineStart, slide.endTagStart)) ? doc.text.slice(lineStart, slide.endTagStart) : null;
    const html = `<img src="${pic.src}" alt="" style="position: absolute; left: ${Math.round((sw - w) / 2)}px; top: ${Math.round((sh - h) / 2)}px; width: ${w}px; height: ${h}px;">`;
    const patches: Patch[] = [];
    if (rect.position === 'static') {
      const p = doc.byId(slide.id)!;
      const cur = getAttr(p, 'style') ?? '';
      patches.push(styleAttrPatch(p, getAttr(p, 'style') !== undefined, cur ? `${cur.replace(/;?\s*$/, '')}; position: relative;` : 'position: relative;'));
    }
    const at = closeIndent !== null ? lineStart : slide.endTagStart;
    patches.push({ start: at, end: at, text: closeIndent !== null ? `${closeIndent}  ${html}${eol}` : html });
    session.exec({ label: 'Insert picture', build: () => patches });
  } catch (e) { session.notify('error', errMsg(e)); }
}

/** Picture Format > Change Picture: only the src attribute changes; size and position stay. */
export async function changePicture(): Promise<void> {
  const s = st();
  const id = s.selection[0];
  const el = id === undefined ? undefined : session.doc.byId(id);
  if (!s.docId || !el || el.tag !== 'img') return;
  try {
    const pic = await window.deckhand.pickImage(s.docId);
    if (!pic) return;
    session.exec({ label: 'Change picture', build: (d) => [setAttrPatch(d, d.byId(el.id)!, 'src', pic.src)] });
  } catch (e) { session.notify('error', errMsg(e)); }
}

export function setAltText(alt: string): void {
  const id = st().selection[0];
  if (id === undefined) return;
  session.exec({ label: 'Change alt text', coalesceKey: `alt-${id}`, build: (d) => { const e = d.byId(id); return e ? [setAttrPatch(d, e, 'alt', alt)] : []; } });
}

/** Home > Paragraph / Font: whole-object formatting of the selection (range formatting happens while editing text). */
export function setSelectionStyle(label: string, set: Record<string, string | null>): void {
  const s = st();
  if (!s.selection.length) return;
  session.exec(styleMultiCommand(label, s.selection.map((id) => ({ id, set }))));
}

/** Format Painter: copy the selected object's visual style; the next object selected receives it (once, or until Esc when sticky). */
export function pickFormat(sticky: boolean): void {
  const s = st();
  const id = s.selection[0];
  if (id === undefined) return;
  const set: Record<string, string> = {};
  for (const [p, v] of styleDeclarations(session.styleOf(id))) if (PAINTABLE.test(p) && isSafeCssProp(p) && isSafeCssValue(v)) set[p] = v;
  if (!Object.keys(set).length) { session.notify('info', 'This object has no inline formatting to copy.'); return; }
  useStore.setState({ painter: { set, sticky, from: id } });
}

/** Apply the selected object's look to every object like it (same tag and classes) on all slides. */
export function applyToSimilar(): void {
  const s = st();
  const id = s.selection[0];
  if (id === undefined) return;
  const cmd = applyToSimilarCommand(session.doc, id, s.slides.map((x) => x.id));
  if (!cmd) { session.notify('info', 'No other objects like this one, or this object has no inline formatting to copy.'); return; }
  session.exec(cmd);
}

export function selectAll(): void {
  const s = st();
  const root = s.slides[s.slide]?.id ?? -2;
  useStore.setState({ selection: s.slideObjects.filter((id) => session.doc.byId(id)?.parent === root) });
}
