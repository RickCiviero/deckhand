/** Commands → patches, plus undo history (ARCH-02, UND-01/02). */
import { applyToDoc, escapeText, getAttr, setAttrPatch, setTextPatch, type SourceDoc } from './source.js';
import { applyPatches, invertPatches, type Patch } from './patch.js';
import { getStyleProp, setStyleProp, removeStyleProp } from './style.js';
import { normalizeEditedHtml, restoreEntities, toEncodingSafe } from './sanitize.js';

export interface Command {
  label: string;
  /** Resulting patches against the current doc. */
  build(doc: SourceDoc): Patch[];
  /** Commands with the same non-empty coalesceKey within coalesceMs merge into one undo step. */
  coalesceKey?: string;
}

interface Step {
  label: string;
  forward: Patch[];
  inverse: Patch[];
  key?: string;
  at: number;
  /** Text before the first command of a coalescing group; only retained on the newest step. */
  base?: string;
}

export class Editor {
  doc: SourceDoc;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  readonly limit = 1000;
  dirty = false;
  private savedDepth = 0;

  constructor(doc: SourceDoc, private now: () => number = Date.now) {
    this.doc = doc;
  }

  exec(cmd: Command, coalesceMs = 1000): Patch[] {
    const forward = cmd.build(this.doc);
    if (forward.length === 0) return [];
    const inverse = invertPatches(this.doc.text, forward);
    const t = this.now();
    const prev = this.undoStack[this.undoStack.length - 1];
    const before = this.doc.text;
    this.doc = applyToDoc(this.doc, forward);
    if (prev && cmd.coalesceKey && prev.key === cmd.coalesceKey && t - prev.at <= coalesceMs && prev.base !== undefined) {
      prev.inverse = [diffPatch(this.doc.text, prev.base)];
      prev.forward = [diffPatch(prev.base, this.doc.text)];
      prev.at = t;
    } else {
      if (prev) delete prev.base;
      this.undoStack.push({ label: cmd.label, forward, inverse, key: cmd.coalesceKey, at: t, ...(cmd.coalesceKey ? { base: before } : {}) });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    this.dirty = true;
    return forward;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | undefined { return this.undoStack.at(-1)?.label; }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    const before = this.doc.text;
    this.doc = applyToDoc(this.doc, step.inverse);
    this.redoStack.push({ ...step, forward: invertPatches(before, step.inverse), inverse: step.inverse });
    this.dirty = true;
    return true;
  }

  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    const before = this.doc.text;
    this.doc = applyToDoc(this.doc, step.forward);
    this.undoStack.push({ ...step, inverse: invertPatches(before, step.forward) });
    this.dirty = true;
    return true;
  }

  markSaved(): void { this.dirty = false; this.savedDepth = this.undoStack.length; }
  get savedAt(): number { return this.savedDepth; }
}

/** Single patch turning `from` into `to` (common prefix/suffix trimmed). */
function diffPatch(from: string, to: string): Patch {
  let a = 0;
  const max = Math.min(from.length, to.length);
  while (a < max && from.charCodeAt(a) === to.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && from.charCodeAt(from.length - 1 - b) === to.charCodeAt(to.length - 1 - b)) b++;
  return { start: a, end: from.length - b, text: to.slice(a, to.length - b) };
}

// ---- concrete commands -------------------------------------------------------------------------

function styleCommand(label: string, id: number, edit: (style: string) => string, coalesceKey?: string): Command {
  return {
    label,
    coalesceKey,
    build(doc) {
      const el = doc.byId(id);
      if (!el) return [];
      const old = getAttr(el, 'style') ?? '';
      const next = edit(old);
      if (next === old) return [];
      return [setAttrPatch(doc, el, 'style', next)];
    },
  };
}

export interface StyleEdit { id: number; set: Record<string, string | null> }

/** Several elements' inline styles changed as one undoable transaction. */
export function styleMultiCommand(label: string, edits: StyleEdit[], coalesceKey?: string): Command {
  return {
    label,
    coalesceKey,
    build(doc) {
      const out: Patch[] = [];
      for (const ed of edits) {
        const el = doc.byId(ed.id);
        if (!el) continue;
        const old = getAttr(el, 'style') ?? '';
        let next = old;
        for (const [k, v] of Object.entries(ed.set)) next = v === null ? removeStyleProp(next, k) : setStyleProp(next, k, v);
        if (next !== old) out.push(setAttrPatch(doc, el, 'style', next));
      }
      return out;
    },
  };
}

export type Category = 'free' | 'layout';

export function moveCommand(id: number, category: Category, to: { left?: string; top?: string; translate?: string }, key?: string): Command {
  return styleCommand('Move object', id, (s) => {
    if (category === 'free') {
      if (to.left !== undefined) s = setStyleProp(s, 'left', to.left);
      if (to.top !== undefined) s = setStyleProp(s, 'top', to.top);
    } else if (to.translate !== undefined) {
      s = setStyleProp(s, 'translate', to.translate);
    }
    return s;
  }, key);
}

export function resizeCommand(id: number, size: { width?: string; height?: string; left?: string; top?: string }): Command {
  return styleCommand('Resize object', id, (s) => {
    for (const [k, v] of Object.entries(size)) if (v !== undefined) s = setStyleProp(s, k, v);
    return s;
  });
}

export function setStyleCommand(id: number, prop: string, value: string | null, label = `Change ${prop}`): Command {
  return styleCommand(label, id, (s) => (value === null ? removeStyleProp(s, prop) : setStyleProp(s, prop, value)));
}

export function resetPositionCommand(id: number): Command {
  return styleCommand('Reset position', id, (s) => removeStyleProp(s, 'translate'));
}

/** Replace an element's content with sanitized inline HTML (text editing commit). */
export function setInnerHtmlCommand(id: number, html: string, sanitized = false): Command {
  return {
    label: 'Edit text',
    build(doc) {
      const el = doc.byId(id);
      if (!el || el.endTagStart === null) return [];
      const old = doc.text.slice(el.startTagEnd, el.endTagStart);
      const clean = toEncodingSafe(restoreEntities(old, sanitized ? html : normalizeEditedHtml(html)), doc.meta.encoding);
      if (old === clean) return [];
      return [setTextPatch(doc, el, clean)];
    },
  };
}

export function setPlainTextCommand(id: number, text: string): Command {
  return setInnerHtmlCommand(id, escapeText(text).replace(/\n/g, '<br>'), true);
}

export function deleteElementCommand(id: number, label = 'Delete'): Command {
  return {
    label,
    build(doc) {
      const el = doc.byId(id);
      return el ? [{ start: el.start, end: el.end, text: '' }] : [];
    },
  };
}

export function duplicateElementCommand(id: number): Command {
  return {
    label: 'Duplicate',
    build(doc) {
      const el = doc.byId(id);
      if (!el) return [];
      const html = doc.text.slice(el.start, el.end);
      const lineStart = doc.text.lastIndexOf('\n', el.start - 1) + 1;
      const indent = /^[ \t]*/.exec(doc.text.slice(lineStart, el.start))![0];
      const eol = doc.meta.eol === 'crlf' ? '\r\n' : '\n';
      const onOwnLine = doc.text.slice(lineStart, el.start).trim() === '';
      return [{ start: el.end, end: el.end, text: onOwnLine ? `${eol}${indent}${html}` : html }];
    },
  };
}

/** Move slide `from` before/after sibling `to` by swapping source ranges. */
export function reorderCommand(id: number, beforeId: number | null, parentEndFallback?: number): Command {
  return {
    label: 'Reorder',
    build(doc) {
      const el = doc.byId(id);
      if (!el) return [];
      const html = doc.text.slice(el.start, el.end);
      const target = beforeId === null ? parentEndFallback : doc.byId(beforeId)?.start;
      if (target === undefined || (target >= el.start && target <= el.end)) return [];
      return [
        { start: target, end: target, text: html + leadingWs(doc, el) },
        { start: el.start, end: el.end + trailingWsLen(doc, el), text: '' },
      ];
    },
  };
}
const leadingWs = (doc: SourceDoc, el: { start: number }): string => {
  const ls = doc.text.lastIndexOf('\n', el.start - 1) + 1;
  const ind = doc.text.slice(ls, el.start);
  return ind.trim() === '' ? (doc.meta.eol === 'crlf' ? '\r\n' : '\n') + ind : '';
};
const trailingWsLen = (doc: SourceDoc, el: { end: number }): number => {
  const m = /^[ \t]*\r?\n/.exec(doc.text.slice(el.end));
  return m ? m[0].length : 0;
};

export { applyPatches };
