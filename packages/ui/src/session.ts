/** Editing session: Editor (core) + live view bridge (agent port) + UI state. */
import { create } from 'zustand';
import {
  Editor, openBytes, saveBytes, detectDeck, getAttr, moveCommand, resizeCommand, setStyleCommand, setInnerHtmlCommand, deleteElementCommand,
  duplicateElementCommand, reorderCommand, findOutsideRefs, resetPositionCommand, styleMultiCommand, parseSource, setStyleProp, textOf, isSimpleInlineHtml, inlineTagSequence, escapeText, type Detection, type ElementInfo,
  type Patch, type SourceDoc,
} from '@deckhand/core';
import { z } from 'zod';

export interface Rect {
  id: number; x: number; y: number; w: number; h: number; sx: number; sy: number; position: string; display: string; tag: string; cls: string;
  left: number | null; top: number | null; right: number | null; bottom: number | null; width: number | null; height: number | null; cw: number; ch: number;
  transform: string | null; anchors: { right: boolean; bottom: boolean } | null; opacity: number | null; visible: boolean; color: string;
  background: string; fontSize: number | null; fontFamily: string; fontWeight: string; textAlign: string; borderRadius: string; borderWidth: string;
  borderColor: string; borderStyle: string; text: boolean; iframeLike: boolean; pdisplay: string; zIndex: number; extraW: number; extraH: number;
}

// Agent messages are untrusted (SEC-08): validate shape and size before use.
const num = z.number().finite();
const rectSchema: z.ZodType<Rect> = z.object({
  id: z.number().int(), x: num, y: num, w: num, h: num, sx: num, sy: num, position: z.string().max(40), display: z.string().max(40), tag: z.string().max(40),
  cls: z.string().max(200), left: num.nullable(), top: num.nullable(), right: num.nullable(), bottom: num.nullable(), width: num.nullable(), height: num.nullable(),
  cw: num, ch: num, transform: z.string().max(300).nullable(), anchors: z.object({ right: z.boolean(), bottom: z.boolean() }).nullable(),
  opacity: num.nullable(), visible: z.boolean(), color: z.string().max(80), background: z.string().max(80), fontSize: num.nullable(), fontFamily: z.string().max(200),
  fontWeight: z.string().max(20), textAlign: z.string().max(20), borderRadius: z.string().max(80), borderWidth: z.string().max(40), borderColor: z.string().max(80),
  borderStyle: z.string().max(40), text: z.boolean(), iframeLike: z.boolean(), pdisplay: z.string().max(40), zIndex: num, extraW: num, extraH: num,
}) as unknown as z.ZodType<Rect>;
const agentMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), title: z.string().max(300).optional(), url: z.string().max(600).optional() }),
  z.object({ t: z.literal('hb') }),
  z.object({ t: z.literal('changed') }),
  z.object({ t: z.literal('pong') }),
  z.object({ t: z.literal('shown'), index: z.any() }),
  z.object({ t: z.literal('rects'), req: z.number(), rects: z.array(rectSchema.nullable()).max(600) }),
  z.object({ t: z.literal('hit'), req: z.number(), ids: z.array(z.number().int()).max(200) }),
  z.object({ t: z.literal('children'), req: z.number(), ids: z.array(z.number().int()).max(2000) }),
  z.object({ t: z.literal('edit-started'), id: z.number().int() }),
  z.object({ t: z.literal('edit-ready'), id: z.number().int().nullable() }),
  z.object({ t: z.literal('edit-refused'), id: z.number().int(), why: z.string().max(40) }),
  z.object({ t: z.literal('edit-outside') }),
  z.object({ t: z.literal('edit-end'), id: z.number().int().nullable(), dirty: z.boolean(), html: z.string().max(2_000_000).nullable(), text: z.string().max(2_000_000).nullable(), quirk: z.boolean() }),
  z.object({ t: z.literal('key'), key: z.string().max(20), shift: z.boolean().optional(), ctrl: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional(), fwd: z.boolean().optional() }),
  z.object({ t: z.literal('viewport'), w: num, h: num, sw: num, sh: num }),
]);
type AgentMsg = z.infer<typeof agentMsg>;

export interface Notice { id: number; kind: 'info' | 'warning' | 'error'; text: string; actions?: { label: string; run: () => void }[] }

interface State {
  loaded: boolean;
  name: string;
  docId: string | null;
  version: number; // bumps on every doc change
  slides: Detection['slides'];
  detection: Detection | null;
  slide: number;
  selection: number[];
  hover: number | null;
  rects: Record<number, Rect>;
  slideObjects: number[];
  zoom: number;
  fit: boolean;
  viewport: { w: number; h: number };
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  editing: number | null;
  notices: Notice[];
  src: string | null;
  origin: string | null;
  token: string | null;
  loadNonce: number;
  agentReady: boolean;
  scriptsOn: boolean;
  guides: { v: number[]; h: number[] };
  showGuides: boolean;
  smart: boolean;
  zoomBox: boolean;
  thumbs: Record<number, string>;
}

export const useStore = create<State>(() => ({
  loaded: false, name: '', docId: null, version: 0, slides: [], detection: null, slide: 0, selection: [], hover: null, rects: {}, slideObjects: [],
  zoom: 0.5, fit: true, viewport: { w: 1920, h: 1080 }, dirty: false, canUndo: false, canRedo: false, undoLabel: '', editing: null, notices: [], src: null,
  origin: null, token: null, loadNonce: 0, agentReady: false, scriptsOn: true, guides: { v: [], h: [] }, showGuides: true, smart: true, zoomBox: false, thumbs: {},
}));
const set = useStore.setState;
const get = useStore.getState;

declare global {
  interface Window { deckhand: import('../../../apps/desktop/src/preload/index').DeckhandApi }
}

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'span', 'a', 'sup', 'sub', 'mark', 'small', 'code', 'br', 'font']);
const isObject = (el: ElementInfo): boolean => !INLINE.has(el.tag) && !['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'title', 'template', 'noscript'].includes(el.tag);

class Session {
  editor: Editor | null = null;
  port: MessagePort | null = null;
  iframe: HTMLIFrameElement | null = null;
  private req = 1;
  private waiters = new Map<number, (m: AgentMsg) => void>();
  private lastHb = 0;
  private hbTimer: number | undefined;
  private recoverTimer: number | undefined;
  private noticeId = 1;
  clipboard: string | null = null;
  private pendingShow: number | null = null;
  private editResolve: ((m: Extract<AgentMsg, { t: 'edit-end' }>) => void) | null = null;
  private refreshQueued = false;
  private thumbTimer: number | undefined;
  private retried = 0;

  get doc(): SourceDoc { return this.editor!.doc; }

  // ---- opening -----------------------------------------------------------------------------------------------
  async openResult(r: { docId: string; name: string; bytes: Uint8Array }, slide = 0): Promise<void> {
    const doc = openBytes(r.bytes);
    this.editor = new Editor(doc);
    const det = detectDeck(doc);
    set({
      loaded: true, name: r.name, docId: r.docId, detection: det, slides: det.slides, slide: Math.min(slide, Math.max(0, det.slides.length - 1)), selection: [],
      dirty: false, canUndo: false, canRedo: false, editing: null, notices: [], rects: {}, version: 0, hover: null,
    });
    const outside = findOutsideRefs(doc.text);
    if (outside.length) this.notify('warning', `This presentation uses files outside its folder (${outside.slice(0, 2).join(', ')}${outside.length > 2 ? '…' : ''}). They were blocked for your safety.`);
    if (det.confidence >= 0.8) this.notify('info', `Found ${det.slides.length} slides (${det.adapter}).`);
    else if (det.adapter === 'page') this.notify('warning', 'No slides found: editing as a single page.');
    else this.notify('warning', `Not sure how this deck is organised — assuming ${det.slides.length} slides (${Math.round(det.confidence * 100)}% confident).`);
    set({ thumbs: {} });
    await this.reload();
    this.requestThumbs(true);
    window.clearInterval(this.hbTimer);
    window.clearInterval(this.recoverTimer);
    this.lastHb = Date.now();
    this.hbTimer = window.setInterval(() => this.checkHeartbeat(), 1000);
    this.recoverTimer = window.setInterval(() => void this.autoRecover(), 60_000);
    const rec = (await window.deckhand.recoveryList()) as { key: string; file: string; time: number }[];
    void rec; // listing is surfaced by the welcome screen
  }

  /** RND-09: thumbnails come from a hidden window in the main process; all of them after a structural change, otherwise only the current slide. */
  requestThumbs(all: boolean): void {
    window.clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => {
      const s = get();
      if (!s.docId || !this.editor) return;
      const indices = all ? s.slides.map((_, i) => i) : [s.slide];
      void window.deckhand.thumbs(s.docId, this.doc.text, indices).then((r) => set((x) => ({ thumbs: { ...(all ? {} : x.thumbs), ...r } }))).catch(() => undefined);
    }, all ? 300 : 1000);
  }

  notify(kind: Notice['kind'], text: string, actions?: Notice['actions']): number {
    const id = this.noticeId++;
    set((s) => ({ notices: [...s.notices.filter((n) => n.text !== text), { id, kind, text, actions }] }));
    return id;
  }
  dismiss(id: number): void { set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })); }

  private checkHeartbeat(): void {
    const s = get();
    if (!s.loaded || !s.agentReady || !s.scriptsOn) return;
    if (Date.now() - this.lastHb > 5000 && !s.notices.some((n) => n.text.startsWith("The presentation's scripts"))) {
      this.notify('warning', "The presentation's scripts aren't responding.", [
        { label: 'Reload', run: () => void this.reload() },
        { label: 'Reload with scripts off', run: () => { set({ scriptsOn: false }); void this.reload(); } },
      ]);
    }
  }

  // ---- live view ---------------------------------------------------------------------------------------------
  attachIframe(el: HTMLIFrameElement | null): void { this.iframe = el; }

  async reload(): Promise<void> {
    const s = get();
    if (!s.docId || !this.editor) return;
    const r = (await window.deckhand.setText(s.docId, this.doc.text)) as { src: string; origin: string; token: string };
    this.closePort();
    const nonce = get().loadNonce + 1;
    window.setTimeout(() => {
      const cur = get();
      if (cur.loadNonce === nonce && !cur.agentReady && cur.scriptsOn && this.retried !== nonce) { this.retried = nonce; void this.reload(); }
    }, 4000);
    set((st) => ({ src: r.src, origin: r.origin, token: r.token, loadNonce: st.loadNonce + 1, agentReady: false, editing: null }));
  }

  private closePort(): void {
    this.port?.close();
    this.port = null;
    for (const w of this.waiters.values()) w({ t: 'pong' });
    this.waiters.clear();
  }

  /** Called from the iframe's onLoad. Establishes the private channel with the agent. */
  onFrameLoad(): void {
    const s = get();
    if (!this.iframe?.contentWindow || !s.origin || !s.token) return;
    this.closePort();
    const ch = new MessageChannel();
    this.port = ch.port1;
    ch.port1.onmessage = (e) => this.onAgent(e.data);
    // exact target origin: only the document's own origin can receive the port
    this.iframe.contentWindow.postMessage({ t: 'deckhand:init', token: s.token }, s.origin, [ch.port2]);
  }

  private onAgent(raw: unknown): void {
    const p = agentMsg.safeParse(raw);
    if (!p.success) return; // untrusted: ignore anything malformed
    const m = p.data;
    this.lastHb = Date.now();
    switch (m.t) {
      case 'ready': void this.afterReady(); break;
      case 'changed': this.queueRefresh(); break;
      case 'rects': case 'hit': case 'children': { const w = this.waiters.get(m.req); if (w) { this.waiters.delete(m.req); w(m); } break; }
      case 'edit-started': this.iframe?.focus(); this.iframe?.contentWindow?.focus(); this.send({ t: 'refocus' }); break; // editing state starts once focus is confirmed
      case 'edit-ready': set({ editing: m.id ?? get().selection[0] ?? null }); break;
      case 'edit-refused': this.notify('warning', m.why === 'transformed'
        ? "This text is changed by the presentation's scripts, so it can't be edited here. Turn off deck scripts (View) to edit it."
        : m.why === 'structure'
          ? "This text is restructured by the browser or the presentation's scripts, so it can't be edited here without changing its markup."
          : "This text can't be edited.");
        break;
      case 'edit-outside': void this.endEdit(true); break;
      case 'edit-end':
        // Either we asked for the end (resolver waiting) or the agent ended the session itself (Esc inside the live view).
        if (this.editResolve) { this.editResolve(m); this.editResolve = null; } else this.finishEdit(m);
        break;
      case 'key': window.dispatchEvent(new CustomEvent('deckhand-key', { detail: m })); break;
      default: break;
    }
  }

  private async afterReady(): Promise<void> {
    set({ agentReady: true });
    this.send({ t: 'slides', ids: get().slides.map((x) => x.id) });
    this.send({ t: 'show', index: get().slide });
    await new Promise((r) => setTimeout(r, 50));
    this.queueRefresh();
  }

  send(m: unknown): void { this.port?.postMessage(m); }

  request<T extends AgentMsg>(msg: Record<string, unknown>, timeout = 1500): Promise<T | null> {
    return new Promise((resolve) => {
      if (!this.port) return resolve(null);
      const req = this.req++;
      const t = window.setTimeout(() => { this.waiters.delete(req); resolve(null); }, timeout);
      this.waiters.set(req, (m) => { window.clearTimeout(t); resolve(m as T); });
      this.port.postMessage({ ...msg, req });
    });
  }

  async hitTest(vx: number, vy: number): Promise<number[]> {
    const r = await this.request<Extract<AgentMsg, { t: 'hit' }>>({ t: 'hit', x: vx, y: vy }, 4000);
    return r?.ids ?? [];
  }

  /** Re-measure the slide's objects and the selection. */
  queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => { this.refreshQueued = false; void this.refreshRects(); });
  }

  async refreshRects(): Promise<void> {
    const s = get();
    if (!this.editor || !s.agentReady) return;
    const slide = s.slides[s.slide];
    if (!slide) return;
    const objs = this.objectsOnSlide(slide.id).slice(0, 400);
    const ids = [slide.id, ...new Set([...objs, ...s.selection])];
    const r = await this.request<Extract<AgentMsg, { t: 'rects' }>>({ t: 'rects', ids });
    if (!r) return;
    const map: Record<number, Rect> = {};
    r.rects.forEach((x, i) => { if (x) map[ids[i]!] = x; });
    set({ rects: map, slideObjects: objs });
  }

  objectsOnSlide(slideId: number): number[] {
    const out: number[] = [];
    const walk = (id: number): void => {
      const el = this.doc.byId(id);
      if (!el) return;
      for (const c of el.children) {
        const ce = this.doc.byId(c)!;
        if (isObject(ce)) out.push(c);
        walk(c);
      }
    };
    walk(slideId);
    return out;
  }

  /** SEL-02: deepest object within the current slide under the pointer. */
  pickObject(hitIds: number[], slideId: number): number | null {
    for (const id of hitIds) {
      if (id === slideId) return null;
      const el = this.doc.byId(id);
      if (!el || !isObject(el)) continue;
      if (!this.isDescendant(id, slideId)) continue;
      return id;
    }
    return null;
  }

  isDescendant(id: number, ancestor: number): boolean {
    let cur = this.doc.byId(id)?.parent ?? null;
    while (cur !== null) { if (cur === ancestor) return true; cur = this.doc.byId(cur)?.parent ?? null; }
    return false;
  }

  ancestors(id: number): ElementInfo[] {
    const out: ElementInfo[] = [];
    let cur: number | null = id;
    while (cur !== null) { const e = this.doc.byId(cur); if (!e) break; out.unshift(e); cur = e.parent; }
    return out;
  }

  // ---- slides ------------------------------------------------------------------------------------------------
  goTo(i: number): void {
    const n = get().slides.length;
    if (n === 0) return;
    const idx = Math.max(0, Math.min(n - 1, i));
    if (get().editing !== null) void this.endEdit(true);
    set({ slide: idx, selection: [], hover: null });
    this.send({ t: 'show', index: idx });
    setTimeout(() => this.queueRefresh(), 80);
  }

  // ---- editing ----------------------------------------------------------------------------------------------
  exec(cmd: Parameters<Editor['exec']>[0], opts?: { live?: boolean; selectAfter?: number[] }): boolean {
    const ed = this.editor!;
    const before = ed.doc;
    const patches = ed.exec(cmd);
    if (patches.length === 0) return false;
    this.afterChange(before, patches, opts);
    return true;
  }

  /** The Editor was changed by something other than exec (AI deck tools): bring the UI and live view up to date. */
  adopt(before: SourceDoc): void { this.afterChange(before, null, undefined); }

  undo(): void { this.stepHistory('undo'); }
  redo(): void { this.stepHistory('redo'); }
  private stepHistory(k: 'undo' | 'redo'): void {
    const ed = this.editor!;
    const before = ed.doc;
    if (!(k === 'undo' ? ed.undo() : ed.redo())) return;
    this.afterChange(before, null, undefined);
  }

  private afterChange(before: SourceDoc, patches: Patch[] | null, opts?: { live?: boolean; selectAfter?: number[] }): void {
    const ed = this.editor!;
    const after = ed.doc;
    set((s) => ({ version: s.version + 1, dirty: true, canUndo: ed.canUndo, canRedo: ed.canRedo, undoLabel: ed.undoLabel ?? '' }));
    void window.deckhand.setDirty(true);
    if (opts?.selectAfter) set({ selection: opts.selectAfter });

    // Live update when the element structure is untouched and only style attributes changed (RND-08); otherwise reload.
    const same = before.elements.length === after.elements.length && before.elements.every((e, i) => e.tag === after.elements[i]!.tag);
    let ops: { id: number; style: string }[] | null = null;
    if (same) {
      ops = [];
      for (const e of after.elements) {
        const o = before.elements[e.id]!;
        const a = before.text.slice(o.start, o.startTagEnd);
        const b = after.text.slice(e.start, e.startTagEnd);
        if (a !== b) {
          const strip = (t: string) => t.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, '');
          if (strip(a) !== strip(b)) { ops = null; break; }
          ops.push({ id: e.id, style: getAttr(e, 'style') ?? '' });
        } else if (before.text.slice(o.startTagEnd, o.endTagStart ?? o.startTagEnd) !== after.text.slice(e.startTagEnd, e.endTagStart ?? e.startTagEnd) && e.children.length === 0) {
          ops = null; break; // text content changed: simplest is reload
        }
      }
      // any change in text outside start tags (but same structure) → reload
      if (ops) {
        const bodyChanged = patches ? patches.some((p) => !before.elements.some((el) => p.start >= el.start && p.end <= el.startTagEnd)) : true;
        if (bodyChanged) ops = null;
      }
    }
    this.requestThumbs(!ops);
    if (ops && !opts?.live) {
      for (const o of ops) this.send({ t: 'style', id: o.id, style: o.style });
      this.queueRefresh();
    } else if (!ops) {
      this.refreshSlidesFromDoc();
      void this.reload();
    }
  }

  private refreshSlidesFromDoc(): void {
    const s = get();
    const det = detectDeck(this.doc);
    // keep the user's slide structure when detection is stable
    const slides = det.slides.length >= 1 ? det.slides : s.slides;
    set({ detection: det, slides, slide: Math.min(s.slide, Math.max(0, slides.length - 1)) });
  }

  styleOf(id: number): string { const e = this.doc.byId(id); return e ? getAttr(e, 'style') ?? '' : ''; }

  /** Preview a style without touching history (drag). */
  previewStyle(id: number, style: string): void { this.send({ t: 'style', id, style }); }

  // ---- text editing --------------------------------------------------------------------------------------------
  startEdit(id: number, at?: { x: number; y: number; mode: 'word' | 'caret' }): void {
    const el = this.doc.byId(id);
    if (!el || el.endTagStart === null) return;
    if (!isSimpleInlineHtml(textOf(this.doc, el))) {
      this.notify('warning', "This object contains images or other embedded content, so its text can't be edited inline.");
      return;
    }
    const text = textOf(this.doc, el).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    const decoded = new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? text;
    this.send({ t: 'edit', id, text: decoded, at, tags: inlineTagSequence(textOf(this.doc, el)) });
  }

  private finishEdit(r: Extract<AgentMsg, { t: 'edit-end' }>): void {
    set({ editing: null });
    this.iframe?.blur();
    window.focus(); // the live view must not keep keyboard focus after editing
    if (r.dirty && r.id !== null) {
      // quirk mode: the live DOM had parser/script-made structure, so only the plain text is written back
      if (r.quirk && r.text !== null) this.exec(setInnerHtmlCommand(r.id, escapeText(r.text), true), { selectAfter: [r.id] });
      else if (r.html !== null) this.exec(setInnerHtmlCommand(r.id, r.html), { selectAfter: [r.id] });
    }
  }

  /** One end-of-edit round trip at a time: Esc followed at once by Ctrl+S joins the first instead of racing it. */
  endEdit(commit: boolean): Promise<void> {
    if (get().editing === null) return this.ending ?? Promise.resolve();
    this.ending ??= this.doEndEdit(commit).finally(() => { this.ending = null; });
    return this.ending;
  }
  private ending: Promise<void> | null = null;
  private async doEndEdit(commit: boolean): Promise<void> {
    const done = new Promise<Extract<AgentMsg, { t: 'edit-end' }>>((res) => { this.editResolve = res; });
    this.send({ t: 'edit-end', commit });
    const r = await Promise.race([done, new Promise<null>((res) => setTimeout(() => res(null), 1500))]);
    this.editResolve = null;
    if (r) this.finishEdit(r); else set({ editing: null });
  }
  format(cmd: 'bold' | 'italic' | 'underline' | 'color' | 'size' | 'link', value?: string): void { this.send({ t: 'fmt', cmd, value }); }

  // ---- saving -------------------------------------------------------------------------------------------------
  async save(): Promise<boolean> {
    if (get().editing !== null) await this.endEdit(true);
    const s = get();
    if (!s.docId || !this.editor) return false;
    try {
      await window.deckhand.save(s.docId, saveBytes(this.doc));
      this.editor.markSaved();
      set({ dirty: false });
      void window.deckhand.setDirty(false);
      return true;
    } catch (e) {
      this.notify('error', `Could not save: ${(e as Error).message.replace(/^Error invoking remote method '[^']*': /, '')}`);
      return false;
    }
  }

  async saveAs(): Promise<void> {
    const s = get();
    if (!s.docId) return;
    if (get().editing !== null) await this.endEdit(true);
    const r = (await window.deckhand.saveAs(s.docId, saveBytes(this.doc))) as { file: string } | null;
    if (r) this.notify('info', `Saved a copy to ${r.file}`);
  }

  private async autoRecover(): Promise<void> {
    const s = get();
    if (s.dirty && s.docId) await window.deckhand.autoRecover(s.docId, saveBytes(this.doc)).catch(() => undefined);
  }

  // ---- helpers for commands -------------------------------------------------------------------------------------
  slideRoot(): ElementInfo | undefined { const s = get(); return this.doc.byId(s.slides[s.slide]?.id ?? -1); }
}

export const session = new Session();
export { styleMultiCommand, moveCommand, resizeCommand, setStyleCommand, deleteElementCommand, duplicateElementCommand, reorderCommand, resetPositionCommand, parseSource, setStyleProp };
