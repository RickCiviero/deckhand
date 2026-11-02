import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor, deckLayouts, detectDeck, newSlideCommand, openBytes, saveBytes } from './index.js';

const load = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));

describe('layouts from the deck (ADP-07)', () => {
  it('clusters slides by skeleton and names them', () => {
    const e = load('ai-fixed-stage.html');
    const l = deckLayouts(e.doc);
    expect(l.map((x) => x.count)).toEqual([1, 2]);
    expect(new Set(l.map((x) => x.name)).size).toBe(l.length);
    expect(l.map((x) => x.name)).toEqual(['Title and text', 'Title and text 2']);
  });
  it('new slide from a layout: placeholders, no state class or ids, rest of the file untouched', () => {
    const e = load('ai-fixed-stage.html');
    const before = text(e);
    const slides = detectDeck(e.doc).slides;
    e.exec(newSlideCommand(slides[0]!.id, slides[2]!.id, slides[2]!.id));
    const after = text(e);
    expect(detectDeck(e.doc).slides).toHaveLength(4);
    const added = after.slice(after.indexOf('\n', after.indexOf('Questions?')) );
    expect(added).toContain('Click to add title');
    expect(added).toContain('<section class="slide" data-slide="1">');
    expect(added).not.toContain('Quarterly Review');
    expect(after.replace(/\n {4}<section class="slide" data-slide="1">[\s\S]*?<\/section>(?=\n {2}<\/div>)/, '')).toBe(before);
  });
  it('blank slide copies the slide classes; pictures become placeholders; ids are dropped', () => {
    const e = load('chart-svg-icons.html');
    const s = detectDeck(e.doc).slides;
    e.exec(newSlideCommand('blank', s[0]!.id, s[0]!.id));
    expect(text(e)).toContain('<section class="slide">\n</section>');
    const g = load('base64-images.html');
    const gs = detectDeck(g.doc).slides;
    g.exec(newSlideCommand(gs[0]!.id, null, gs[0]!.id)); // before the first slide
    expect(text(g)).not.toMatch(/base64,.*base64,.*base64,/s); // original image not copied
    expect(text(g)).toContain('data:image/svg+xml,');
  });
  it('undo restores the file exactly', () => {
    const e = load('reveal-style.html');
    const before = text(e);
    const s = detectDeck(e.doc).slides;
    e.exec(newSlideCommand('blank', s[0]!.id, s[0]!.id));
    e.undo();
    expect(text(e)).toBe(before);
  });
});

describe('externalDomains (File > Info)', () => {
  it('lists hosts from attributes and CSS, ignores namespaces', async () => {
    const { externalDomains } = await import('./index.js');
    const e = load('remote-fonts-tailwind.html');
    expect(externalDomains(e.doc)).toEqual(['cdn.tailwindcss.com', 'fonts.googleapis.com']);
    expect(externalDomains(load('ai-fixed-stage.html').doc)).toEqual([]);
    expect(externalDomains(load('chart-svg-icons.html').doc)).toEqual([]);
  });
});
