import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor, groupCommand, groupProblem, isGroup, openBytes, saveBytes, ungroupCommand } from './index.js';

const load = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));
const slide1 = (e: Editor) => e.doc.elements.find((x) => x.tag === 'section')!.children;

describe('Group / Ungroup', () => {
  it('wraps contiguous siblings with exact insertions; children keep their markup; Undo restores the bytes', () => {
    const e = load('ai-fixed-stage.html');
    const orig = text(e);
    const [title, body] = slide1(e);
    expect(groupProblem(e.doc, [title!, body!])).toBeNull();
    e.exec(groupCommand([title!, body!], { position: 'absolute', left: '0px', top: '10px' }, new Map([[title!, { left: '5px' }]])));
    const out = text(e);
    expect(out).toContain('<div data-deckhand-group style="position: absolute; left: 0px; top: 10px;"><h1 class="title" style="left: 5px;">Quarterly Review</h1>');
    expect(out).toContain('record.</p></div>');
    e.undo();
    expect(text(e)).toBe(orig);
  });
  it('ungroup removes only the wrapper tags and restores the original bytes when children are put back', () => {
    const e = load('ai-fixed-stage.html');
    const orig = text(e);
    const [title, body] = slide1(e);
    e.exec(groupCommand([title!, body!], null, new Map()));
    const g = e.doc.elements.find((x) => x.tag === 'div' && isGroup(e.doc, x.id))!;
    e.exec(ungroupCommand(g.id, new Map()));
    expect(text(e)).toBe(orig);
  });
  it('refuses objects with different parents or gaps between them', () => {
    const e = load('ai-fixed-stage.html');
    const [title, , logo] = slide1(e);
    expect(groupProblem(e.doc, [title!, logo!])).toMatch(/next to each other/);
    const other = e.doc.elements.filter((x) => x.tag === 'h1')[1]!;
    expect(groupProblem(e.doc, [title!, other.id])).toMatch(/same parent/);
    expect(groupProblem(e.doc, [title!])).toMatch(/two or more/);
  });
  it('rejects a style that could break out of the attribute', () => {
    const e = load('ai-fixed-stage.html');
    const [t, b] = slide1(e);
    expect(() => groupCommand([t!, b!], { left: 'x" onclick="alert(1)' }, new Map())).toThrow();
  });
});
