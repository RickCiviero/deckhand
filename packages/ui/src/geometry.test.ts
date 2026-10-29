import { describe, expect, it } from 'vitest';
import { detectUnitMode, moveEdit, resizeEdit, snapBox, outermost, parseLen } from './geometry';
import type { Rect } from './session';

const base: Rect = {
  id: 1, x: 100, y: 100, w: 200, h: 100, sx: 1, sy: 1, position: 'absolute', display: 'block', tag: 'div', cls: '', left: 100, top: 100, right: 1620, bottom: 880,
  width: 200, height: 100, cw: 1920, ch: 1080, transform: null, anchors: { right: false, bottom: false }, opacity: 1, visible: true, color: '', background: '',
  fontSize: 16, fontFamily: '', fontWeight: '400', textAlign: 'left', borderRadius: '0', borderWidth: '0', borderColor: '', borderStyle: 'none', text: false,
  iframeLike: false, pdisplay: 'block', zIndex: 0, extraW: 0, extraH: 0,
};
const px = { mode: 'px' as const, vp: { w: 1920, h: 1080 } };
const resp = { mode: 'responsive' as const, vp: { w: 1920, h: 1080 } };

describe('moveEdit', () => {
  it('free object → left/top px', () => {
    expect(moveEdit(base, '', 24, -12, px).set).toEqual({ left: '124px', top: '88px' });
  });
  it('keeps the unit already used (%)', () => {
    const r = moveEdit(base, 'left: 5%; top: 10%', 96, 54, px).set;
    expect(r['left']).toBe('10.21%');
    expect(r['top']).toBe('14.26%');
  });
  it('responsive free object defaults to %', () => {
    expect(moveEdit(base, '', 192, 0, resp).set['left']).toBe('15.21%');
  });
  it('right-anchored free object writes right', () => {
    const r = { ...base, anchors: { right: true, bottom: false }, right: 80 };
    expect(moveEdit(r, '', 20, 0, px).set['right']).toBe('60px');
  });
  it('layout object → translate, accumulates onto existing offset', () => {
    const r = { ...base, position: 'static' };
    expect(moveEdit(r, '', 24, -12, px).set).toEqual({ translate: '24px -12px' });
    expect(moveEdit(r, 'translate: 24px -12px', 6, 2, px).set).toEqual({ translate: '30px -10px' });
  });
  it('responsive layout object uses vw (same relative position at any viewport)', () => {
    const r = { ...base, position: 'static' };
    expect(moveEdit(r, '', 192, 0, resp).set['translate']).toMatch(/^10vw /);
  });
});

describe('resizeEdit', () => {
  it('east handle changes width only', () => {
    const { edit, w } = resizeEdit(base, '', 'e', 50, 999, px, false);
    expect(edit.set).toEqual({ width: '250px' });
    expect(w).toBe(250);
  });
  it('west handle moves left and widens, opposite edge fixed', () => {
    const { edit } = resizeEdit(base, '', 'w', -40, 0, px, false);
    expect(edit.set['width']).toBe('240px');
    expect(edit.set['left']).toBe('60px');
  });
  it('corner with aspect lock', () => {
    const { w, h } = resizeEdit(base, '', 'se', 100, 0, px, true);
    expect(w / h).toBeCloseTo(2);
  });
  it('content-box padding is subtracted', () => {
    const { edit } = resizeEdit({ ...base, extraW: 20 }, '', 'e', 0, 0, px, false);
    expect(edit.set['width']).toBe('180px');
  });
  it('flex children get flex-shrink:0', () => {
    const { edit } = resizeEdit({ ...base, position: 'static', pdisplay: 'flex' }, '', 'e', 10, 0, px, false);
    expect(edit.set['flex-shrink']).toBe('0');
  });
  it('scaled stage: sizes are in CSS px, not screen px', () => {
    const r = { ...base, sx: 0.5, sy: 0.5, w: 100, h: 50 };
    expect(resizeEdit(r, '', 'e', 25, 0, px, false).edit.set['width']).toBe('225px');
  });
});

describe('misc', () => {
  it('detectUnitMode', () => {
    expect(detectUnitMode('.a{left:10px}', 1)).toBe('px');
    expect(detectUnitMode('.a{padding:6vw;font-size:clamp(1px,5vw,2px);gap:2vw}', 1)).toBe('responsive');
    expect(detectUnitMode('.a{padding:6vw;gap:2vw;x:3vw}', 0.5)).toBe('px');
  });
  it('snapBox snaps to centre within threshold only', () => {
    const slide = { x: 0, y: 0, w: 1920, h: 1080 };
    const s = snapBox({ x: 855, y: 100, w: 200, h: 100 }, [slide], 6);
    expect(s.dx).toBe(5);
    expect(s.v).toEqual([960]);
    expect(snapBox({ x: 800, y: 100, w: 200, h: 100 }, [slide], 6).dx).toBe(0);
  });
  it('outermost', () => {
    const anc = (id: number, a: number) => id === 2 && a === 1;
    expect(outermost([1, 2, 3], anc)).toEqual([1, 3]);
  });
  it('parseLen', () => {
    expect(parseLen('-12.5px')).toEqual({ n: -12.5, unit: 'px' });
    expect(parseLen('auto')).toBeNull();
  });
});
