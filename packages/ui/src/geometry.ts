/** Pure positioning math (POS-01…09, GEO-01). No React, no DOM. */
import { getStyleProp } from '@deckhand/core';
import type { Rect } from './session';

export type UnitMode = 'px' | 'responsive';

export const round = (n: number, d = 1): number => { const f = 10 ** d; return Math.round(n * f) / f; };
export const px = (n: number): string => `${round(n, 1)}px`;
export const pct = (n: number): string => `${round(n, 2)}%`;
export const vw = (n: number): string => `${round(n, 2)}vw`;

/** POS-04 step 2/3: fixed pixel design (incl. scaled stages) vs responsive deck. */
export function detectUnitMode(styleBlocks: string, slideScale: number): UnitMode {
  if (Math.abs(slideScale - 1) > 0.001) return 'px';
  const responsive = (styleBlocks.match(/\d(vw|vh|vmin|vmax)\b|clamp\(|minmax\(|\d%/g) ?? []).length;
  return responsive >= 3 ? 'responsive' : 'px';
}

export const isFree = (r: Rect): boolean => r.position === 'absolute' || r.position === 'fixed';

/** Parse one component of a CSS length: returns number and unit. */
export function parseLen(v: string | undefined): { n: number; unit: string } | null {
  if (!v) return null;
  const m = /^\s*(-?\d*\.?\d+)\s*(px|%|vw|vh|rem|em)?\s*$/.exec(v);
  return m ? { n: parseFloat(m[1]!), unit: m[2] ?? 'px' } : null;
}

export interface Edit { set: Record<string, string | null> }

/** Convert a CSS-px value to the unit the element already uses, else the deck's mode. */
function toUnit(cssPx: number, existing: string | undefined, mode: UnitMode, axis: 'x' | 'y', r: Rect, vp: { w: number; h: number }, containing: boolean): string {
  const u = parseLen(existing)?.unit;
  if (u === '%' && containing) return pct((cssPx / (axis === 'x' ? r.cw : r.ch)) * 100);
  if (u === 'vw') return vw((cssPx / vp.w) * 100);
  if (u === 'vh') return `${round((cssPx / vp.h) * 100, 2)}vh`;
  if (u === 'px' || !u) {
    if (existing) return px(cssPx);
    if (mode === 'responsive' && containing && (axis === 'x' ? r.cw : r.ch) > 0) return pct((cssPx / (axis === 'x' ? r.cw : r.ch)) * 100);
    if (mode === 'responsive') return vw((cssPx / vp.w) * 100);
  }
  return px(cssPx);
}

export interface MoveCtx { mode: UnitMode; vp: { w: number; h: number } }

/** Style edit for moving an object by (dx, dy) CSS px. */
export function moveEdit(r: Rect, style: string, dx: number, dy: number, ctx: MoveCtx): Edit {
  if (isFree(r)) {
    const set: Record<string, string> = {};
    const hor = r.anchors?.right ? 'right' : 'left';
    const ver = r.anchors?.bottom ? 'bottom' : 'top';
    const curX = (hor === 'right' ? r.right : r.left) ?? 0;
    const curY = (ver === 'bottom' ? r.bottom : r.top) ?? 0;
    const nx = hor === 'right' ? curX - dx : curX + dx;
    const ny = ver === 'bottom' ? curY - dy : curY + dy;
    set[hor] = toUnit(nx, getStyleProp(style, hor), ctx.mode, 'x', r, ctx.vp, true);
    set[ver] = toUnit(ny, getStyleProp(style, ver), ctx.mode, 'y', r, ctx.vp, true);
    return { set };
  }
  // In layout: visual offset via the `translate` property, which leaves siblings and existing transforms alone (POS-02)
  const cur = (getStyleProp(style, 'translate') ?? '').split(/\s+/).filter(Boolean);
  const cx = parseLen(cur[0]);
  const cy = parseLen(cur[1] ?? (cur[0] ? '0px' : undefined));
  const toCss = (l: { n: number; unit: string } | null, axis: 'x' | 'y'): number => {
    if (!l) return 0;
    if (l.unit === 'vw') return (l.n / 100) * ctx.vp.w;
    if (l.unit === 'vh') return (l.n / 100) * ctx.vp.h;
    if (l.unit === '%') return (l.n / 100) * (axis === 'x' ? r.w / r.sx : r.h / r.sy);
    return l.n;
  };
  const nx = toCss(cx, 'x') + dx;
  const ny = toCss(cy, 'y') + dy;
  const unitFor = cx?.unit && cx.unit !== '%' ? cx.unit : ctx.mode === 'responsive' ? 'vw' : 'px';
  const f = (v: number, axis: 'x' | 'y'): string => unitFor === 'vw' ? vw((v / ctx.vp.w) * 100) : unitFor === 'vh' ? `${round((v / ctx.vp.h) * 100, 2)}vh` : px(axis === 'x' ? v : v);
  return { set: { translate: `${f(nx, 'x')} ${unitFor === 'vw' ? vw((ny / ctx.vp.w) * 100) : f(ny, 'y')}` } };
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Style edit for resizing: new border-box size in CSS px; moves the origin when dragging west/north handles. */
export function resizeEdit(r: Rect, style: string, handle: Handle, dw: number, dh: number, ctx: MoveCtx, keepAspect: boolean): { edit: Edit; w: number; h: number } {
  const w0 = r.w / r.sx;
  const h0 = r.h / r.sy;
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  let w = Math.max(4, w0 + sx * dw);
  let h = Math.max(4, h0 + sy * dh);
  if (keepAspect && w0 > 0 && h0 > 0) {
    const k = sx !== 0 && sy !== 0 ? Math.max(w / w0, h / h0) : sx !== 0 ? w / w0 : h / h0;
    w = w0 * k; h = h0 * k;
  }
  const set: Record<string, string | null> = {};
  if (sx !== 0 || keepAspect) set['width'] = unitSize(w - r.extraW, getStyleProp(style, 'width'), 'x', r, ctx);
  if (sy !== 0 || keepAspect) set['height'] = unitSize(h - r.extraH, getStyleProp(style, 'height'), 'y', r, ctx);
  if (!isFree(r) && (r.pdisplay.includes('flex') || r.pdisplay.includes('grid'))) set['flex-shrink'] = '0'; // make the size take effect
  const moveX = sx < 0 ? w0 - w : 0;
  const moveY = sy < 0 ? h0 - h : 0;
  if (moveX !== 0 || moveY !== 0) Object.assign(set, moveEdit(r, mergeStyle(style, set), moveX, moveY, ctx).set);
  return { edit: { set }, w, h };
}

function mergeStyle(style: string, set: Record<string, string | null>): string {
  let s = style;
  for (const [k, v] of Object.entries(set)) if (v !== null) s += `;${k}:${v}`;
  return s;
}

function unitSize(cssPx: number, existing: string | undefined, axis: 'x' | 'y', r: Rect, ctx: MoveCtx): string {
  const u = parseLen(existing)?.unit;
  if (u === '%') return pct((cssPx / (axis === 'x' ? r.cw : r.ch)) * 100);
  if (u === 'vw') return vw((cssPx / ctx.vp.w) * 100);
  if (u === 'vh') return `${round((cssPx / ctx.vp.h) * 100, 2)}vh`;
  if (!existing && ctx.mode === 'responsive' && (axis === 'x' ? r.cw : r.ch) > 0) return pct((cssPx / (axis === 'x' ? r.cw : r.ch)) * 100);
  return px(cssPx);
}

// ---- smart guides (POS-07) -----------------------------------------------------------------------------------------
export interface Box { x: number; y: number; w: number; h: number }
export interface Snap { dx: number; dy: number; v: number[]; h: number[] }

/** Snap a moving box (viewport px) to slide/object edges and centres within `threshold` viewport px. */
export function snapBox(moving: Box, others: Box[], threshold: number): Snap {
  const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];
  const best = (mv: number[], cand: number[]): { d: number; line: number } | null => {
    let out: { d: number; line: number } | null = null;
    for (const m of mv) for (const c of cand) {
      const d = c - m;
      if (Math.abs(d) <= threshold && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, line: c };
    }
    return out;
  };
  const bx = best(xs(moving), others.flatMap(xs));
  const by = best(ys(moving), others.flatMap(ys));
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, v: bx ? [bx.line] : [], h: by ? [by.line] : [] };
}

/** Outermost-only filter for marquee selection (SEL-05). */
export function outermost(ids: number[], isDescendant: (id: number, anc: number) => boolean): number[] {
  return ids.filter((id) => !ids.some((o) => o !== id && isDescendant(id, o)));
}
