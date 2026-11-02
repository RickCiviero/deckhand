import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor, assertNoArtifacts, detectDeck, hideObjectsCommand, lockObjectCommand, objectTree, openBytes, renameObjectCommand, saveBytes } from './index.js';

const load = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));

describe('Selection Pane model (SEP-01)', () => {
  it('lists objects topmost first with derived names', () => {
    const e = load('ai-fixed-stage.html');
    const tree = objectTree(e.doc, detectDeck(e.doc).slides[0]!.id);
    expect(tree.map((n) => n.name.split(':')[0])).toEqual(['div.logo', 'Text', 'Heading']);
    expect(tree[2]!.name).toBe('Heading: Quarterly Review');
    expect(tree.every((n) => n.depth === 0)).toBe(true);
  });
  it('rename, lock and hide are minimal attribute edits and reversible', () => {
    const e = load('ai-fixed-stage.html');
    const before = text(e);
    const logo = e.doc.elements.find((x) => x.attrs.some((a) => a.value === 'logo'))!.id;
    e.exec(renameObjectCommand(logo, 'Company logo'));
    e.exec(lockObjectCommand(logo, true));
    e.exec(hideObjectsCommand([logo], true));
    expect(text(e)).toContain('<div class="logo" data-deckhand-name="Company logo" data-deckhand-locked="" style="display: none;">');
    const n = objectTree(e.doc, detectDeck(e.doc).slides[0]!.id)[0]!;
    expect([n.name, n.custom, n.locked, n.hidden]).toEqual(['Company logo', true, true, true]);
    assertNoArtifacts(text(e));
    e.exec(hideObjectsCommand([logo], false));
    e.exec(lockObjectCommand(logo, false));
    e.exec(renameObjectCommand(logo, ''));
    expect(text(e)).toBe(before);
  });
  it('hiding keeps other inline styles', () => {
    const e = load('ai-fixed-stage.html');
    const p = e.doc.elements.find((x) => x.tag === 'p' && x.attrs.some((a) => a.name === 'style'))!.id;
    e.exec(hideObjectsCommand([p], true));
    expect(text(e)).toContain('style="color: #555; opacity: .9; display: none;"');
    e.exec(hideObjectsCommand([p], false));
    expect(text(e)).toContain('style="color: #555; opacity: .9;"'); // the semicolon the hide added stays; Undo restores the exact bytes
  });
});
