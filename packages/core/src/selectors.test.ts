import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor, defineSlidesCommand, detectDeck, matchSelector, openBytes, proposeSelectors, saveBytes, storedSlideSelector } from './index.js';

const load = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));

describe('Define Slides (ADP-04)', () => {
  it('matches tag, class, id, attribute, child and descendant selectors', () => {
    const e = load('ai-fixed-stage.html');
    expect(matchSelector(e.doc, 'section.slide')).toHaveLength(3);
    expect(matchSelector(e.doc, '#stage > section')).toHaveLength(3);
    expect(matchSelector(e.doc, 'body section[data-slide="2"]')).toHaveLength(1);
    expect(matchSelector(e.doc, '.slide.active')).toHaveLength(1);
    expect(matchSelector(e.doc, 'h1')).toHaveLength(3);
    expect(matchSelector(e.doc, 'div')).toHaveLength(1); // #stage swallows the nested .logo div: outermost only
  });
  it('rejects selectors it cannot handle', () => {
    const e = load('ai-fixed-stage.html');
    for (const bad of ['', 'a >', 'p:first-child', 'a + b', '.']) expect(() => matchSelector(e.doc, bad)).toThrow();
  });
  it('proposes selectors for an element and its ancestors with counts', () => {
    const e = load('ai-fixed-stage.html');
    const h1 = e.doc.elements.find((x) => x.tag === 'h1')!;
    expect(proposeSelectors(e.doc, h1.id).map((x) => [x.selector, x.count])).toEqual([['h1.title', 3], ['section.slide', 3], ['div', 1]]);
  });
  it('writes one meta tag, which detection then obeys; reset removes it byte-exactly', () => {
    const e = load('responsive-scroll-snap.html');
    const before = text(e);
    expect(detectDeck(e.doc).adapter).toBe('generic');
    e.exec(defineSlidesCommand('.card'));
    const out = text(e);
    expect(out).toContain('<meta name="deckhand:slides" content=".card">');
    expect(out.replace(/\n?\s*<meta name="deckhand:slides"[^>]*>/, '')).toBe(before);
    const d = detectDeck(e.doc);
    expect([d.adapter, d.slides.length, storedSlideSelector(e.doc)]).toEqual(['custom', 3, '.card']);
    e.exec(defineSlidesCommand('.page'));
    expect(text(e).match(/deckhand:slides/g)).toHaveLength(1);
    e.exec(defineSlidesCommand(null));
    expect(text(e)).toBe(before);
    e.undo(); e.undo(); e.undo();
    expect(text(e)).toBe(before);
  });
  it('an unsupported selector writes nothing', () => {
    const e = load('ai-fixed-stage.html');
    expect(() => e.exec(defineSlidesCommand('p:hover'))).toThrow();
  });
});
