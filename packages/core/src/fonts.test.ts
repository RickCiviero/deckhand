import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor, findFonts, openBytes, replaceFontCommand, saveBytes } from './index.js';

const load = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));

describe('Theme fonts', () => {
  it('lists the families a deck declares, without generic keywords', () => {
    const e = load('ai-fixed-stage.html');
    expect(findFonts(e.doc)).toEqual([{ family: 'Georgia', count: 1 }]);
  });
  it('replaces one family in place and one Undo restores the bytes', () => {
    const e = load('ai-fixed-stage.html');
    const orig = text(e);
    e.exec(replaceFontCommand('georgia', 'Open Sans'));
    expect(text(e)).toBe(orig.replace('font-family: Georgia, serif', 'font-family: "Open Sans", serif'));
    expect(findFonts(e.doc)).toEqual([{ family: 'Open Sans', count: 1 }]);
    e.undo();
    expect(text(e)).toBe(orig);
  });
  it('rejects names that could break out of the declaration', () => {
    expect(() => replaceFontCommand('Georgia', 'x; } body { background: url(//evil)')).toThrow();
    expect(() => replaceFontCommand('Georgia', 'a"b')).toThrow();
  });
  it('handles inline styles and custom properties', () => {
    const e = new Editor(openBytes(new TextEncoder().encode('<!doctype html><style>:root{--font-body: Lato, sans-serif}</style><p style="font-family:\'Lato\'">x</p>')));
    expect(findFonts(e.doc)).toEqual([{ family: 'Lato', count: 2 }]);
    e.exec(replaceFontCommand('Lato', 'Roboto'));
    expect(text(e)).toBe('<!doctype html><style>:root{--font-body: Roboto, sans-serif}</style><p style="font-family:Roboto">x</p>');
  });
});
