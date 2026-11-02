import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor, findText, openBytes, replaceCommand, saveBytes } from './index.js';

const load = (n: string) => new Editor(openBytes(readFileSync(new URL(`../../../test-decks/decks/${n}`, import.meta.url))));
const text = (e: Editor) => new TextDecoder('latin1').decode(saveBytes(e.doc));

describe('Find and Replace', () => {
  it('finds text across slides, ignores markup, attributes, scripts and styles', () => {
    const e = load('ai-fixed-stage.html');
    expect(findText(e.doc, 'slide')).toHaveLength(0); // class names, data-slide and script text are not slide text
    expect(findText(e.doc, 'review').map((m) => m.slide)).toEqual([0]); // case-insensitive by default
    expect(findText(e.doc, 'review', { matchCase: true })).toHaveLength(0);
    expect(findText(e.doc, 'Roadmap')[0]!.slide).toBe(1);
  });
  it('matches through entities and honours whole word', () => {
    const e = load('ai-fixed-stage.html');
    expect(findText(e.doc, 'quarter & a record')).toHaveLength(1); // source has &amp;
    expect(findText(e.doc, 'Rev', { wholeWord: true })).toHaveLength(0);
    expect(findText(e.doc, 'Revenue', { wholeWord: true })).toHaveLength(1);
  });
  it('replaces only the matched characters; entities and markup around stay; undo restores the file', () => {
    const e = load('ai-fixed-stage.html');
    const before = text(e);
    const m = findText(e.doc, 'quarter', { wholeWord: true }); // "Quarterly" in the title is a different word
    e.exec(replaceCommand(m, 'period <&>'));
    expect(text(e)).toBe(before.replace('best quarter &amp; a record', 'best period &lt;&amp;&gt; &amp; a record'));
    e.undo();
    expect(text(e)).toBe(before);
  });
  it('replaces all occurrences across slides in one undo step', () => {
    const e = load('large-100.html');
    const m = findText(e.doc, 'Lorem ipsum');
    expect(m.length).toBe(1000); // capped
    expect(findText(e.doc, 'Slide 1', { wholeWord: true }).length).toBe(1);
    e.exec(replaceCommand(findText(e.doc, 'Slide 7', { wholeWord: true }), 'Seven'));
    expect(text(e)).toContain('<h1>Seven</h1>');
    expect(e.undoLabel).toBe('Replace');
  });
  it('skips comments and handles malformed markup', () => {
    const e = load('malformed.html');
    expect(findText(e.doc, 'Second')).toHaveLength(1);
    expect(findText(e.doc, 'zzz')).toHaveLength(0);
  });
});

import { parseErrors } from './source.js';
describe('parseErrors', () => {
  it('is empty for clean html and reports tokenizer errors', () => {
    expect(parseErrors('<!DOCTYPE html><html><head><title>t</title></head><body><p>x</p></body></html>')).toEqual([]);
    expect(parseErrors('<!DOCTYPE html><title>t</title><p a="1" a="2">x</p>').length).toBeGreaterThan(0);
  });
});
