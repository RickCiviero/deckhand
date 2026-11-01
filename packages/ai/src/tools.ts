/** Deck tools (§10.6): the only way the AI reads or changes a deck. Every write goes through Editor.exec (ARCH-02). */
import postcss from 'postcss';
import { z } from 'zod';
import {
  Editor, detectDeck, deleteElementCommand, duplicateElementCommand, getAttr, getStyleProp, isSafeCssValue, patchCommand, removeAttrPatch, reorderCommand,
  sanitizeBlockHtml, setAttrPatch, setInnerHtmlCommand, setStyleProp, styleMultiCommand, textOf, type ElementInfo, type Patch, type SlideRef, type SourceDoc,
} from '@deckhand/core';
import { parseRef, resolveAssets, toAiView } from './view.js';

export class ToolError extends Error {}

export interface ToolContext {
  editor: Editor;
  /** Element ids the user has selected right now. */
  getSelection?: () => number[];
  /** PNG (base64) of a slide as currently edited; absent → render_slide is not offered. */
  renderSlide?: (slide: number, width: number) => Promise<string>;
  /** AIS-04: let AI-written HTML add scripts-free external resources. Scripts are never allowed. */
  allowExternal?: boolean;
  /** AIT-04: slides one turn may change before it has to stop and ask. */
  maxChangedSlides?: number;
}

export type Mode = 'ask' | 'edit';
interface ToolDef { name: string; mode: Mode; description: string; schema: z.ZodObject; run(args: never): unknown | Promise<unknown> }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};
const rel = (a: ElementInfo, b: ElementInfo): boolean => b.start >= a.start && b.end <= a.end;
const slideNo = z.number().int().min(1).describe('1-based slide number');
const ref = z.string().describe('Object reference such as "o12", as shown in data-ref');
const SOFT_TAGS = new Set(['html', 'head', 'body']);

export class DeckTools {
  private assets = new Map<string, string>();
  private epoch = 0;
  private readEpoch = -1;
  private elemCount: number;
  private touched = new Set<number>();
  private defsCache: ToolDef[] | null = null;

  constructor(private ctx: ToolContext) { this.elemCount = ctx.editor.doc.elements.length; }

  private get ed(): Editor { return this.ctx.editor; }
  private get doc(): SourceDoc { return this.ed.doc; }
  private slides(): SlideRef[] { return detectDeck(this.doc).slides; }
  private slideEl(n: number): ElementInfo {
    const s = this.slides()[n - 1];
    if (!s) throw new ToolError(`No slide ${n}; the deck has ${this.slides().length} slides.`);
    return this.doc.byId(s.id)!;
  }
  private slideIndexOf(el: ElementInfo): number {
    const i = this.slides().findIndex((s) => rel(this.doc.byId(s.id)!, el));
    return i;
  }
  private version(n: number): string { const e = this.slideEl(n); return fnv(this.doc.text.slice(e.start, e.end)); }

  private el(r: string, opts: { allowSlideRoot?: boolean } = {}): ElementInfo {
    const id = parseRef(r);
    if (id === null) throw new ToolError(`"${r}" is not an object reference (expected like "o12").`);
    if (this.readEpoch !== this.epoch) throw new ToolError('The deck structure changed since you last read it. Call get_slide again before editing.');
    const el = this.doc.byId(id);
    if (!el || SOFT_TAGS.has(el.tag)) throw new ToolError(`Unknown object ${r}.`);
    const si = this.slideIndexOf(el);
    if (si < 0) throw new ToolError(`${r} is not inside a slide (deck chrome and generated content cannot be edited).`);
    if (!opts.allowSlideRoot && this.slides().some((s) => s.id === el.id)) throw new ToolError(`${r} is a slide; use the slide tools.`);
    return el;
  }

  private checkVersion(el: ElementInfo, version?: string): void {
    if (version === undefined) return;
    const n = this.slideIndexOf(el) + 1;
    if (this.version(n) !== version) throw new ToolError(`Slide ${n} changed since you read it (version ${version} is stale). Call get_slide again.`);
  }

  private exec(label: string, build: (doc: SourceDoc) => Patch[], els: ElementInfo[] = []): void {
    const slidesBefore = els.map((e) => this.slideIndexOf(e)).filter((i) => i >= 0);
    const patches = this.ed.exec(patchCommand(label, build), 0);
    if (!patches.length) throw new ToolError('Nothing changed.');
    for (const i of slidesBefore) this.touched.add(i);
    const max = this.ctx.maxChangedSlides ?? 12;
    if (this.touched.size > max) throw new ToolError(`This request changes more than ${max} slides. Stop and ask the user to confirm before continuing.`);
    if (this.doc.elements.length !== this.elemCount) { this.elemCount = this.doc.elements.length; this.epoch++; }
  }

  private eol(): string { return this.doc.meta.eol === 'crlf' ? '\r\n' : '\n'; }
  private indentOf(pos: number): string {
    const ls = this.doc.text.lastIndexOf('\n', pos - 1) + 1;
    const lead = /^[ \t]*/.exec(this.doc.text.slice(ls, pos))![0];
    return lead;
  }
  /** New markup matches the surroundings (RT-04): line endings and indentation. */
  private fit(html: string, indent: string): string {
    const lines = html.replace(/\r\n?/g, '\n').trim().split('\n');
    return lines.map((l, i) => (i === 0 ? l : indent + l)).join(this.eol());
  }
  private clean(html: string): string {
    const resolved = resolveAssets(html, this.assets);
    return sanitizeBlockHtml(resolved, { allowExternal: this.ctx.allowExternal });
  }
  private result(el: ElementInfo | null, extra: Record<string, unknown> = {}): unknown {
    const out: Record<string, unknown> = { ok: true, ...extra };
    if (el) {
      const i = this.slideIndexOf(this.doc.byId(Math.min(el.id, this.doc.elements.length - 1)) ?? el);
      if (i >= 0) { out.slide = i + 1; out.version = this.version(i + 1); }
    }
    if (this.readEpoch !== this.epoch) out.note = 'Object references changed because markup was added or removed. Call get_slide before the next edit.';
    return out;
  }

  // ---- CSS helpers ---------------------------------------------------------------------------------------
  private styleBlocks(): ElementInfo[] { return this.doc.elements.filter((e) => e.tag === 'style' && e.endTagStart !== null); }
  private themeVars(): { name: string; value: string; block: number; start: number; end: number }[] {
    const out: { name: string; value: string; block: number; start: number; end: number }[] = [];
    this.styleBlocks().forEach((b, bi) => {
      const css = textOf(this.doc, b);
      let root: postcss.Root;
      try { root = postcss.parse(css); } catch { return; }
      root.walkRules((rule) => {
        if (!/(^|,)\s*(:root|html|body)\s*(,|$)/.test(rule.selector)) return;
        rule.each((n) => {
          if (n.type !== 'decl' || !n.prop.startsWith('--') || n.source?.start?.offset === undefined) return;
          const raw = (n.raws.value as { raw?: string } | undefined)?.raw ?? n.value;
          const vs = n.source.start.offset + n.prop.length + (n.raws.between?.length ?? 1);
          out.push({ name: n.prop, value: n.value, block: bi, start: b.startTagEnd + vs, end: b.startTagEnd + vs + raw.length });
        });
      });
    });
    return out;
  }
  private checkCss(css: string): void {
    try { postcss.parse(css); } catch (e) { throw new ToolError(`That CSS does not parse: ${(e as Error).message}`); }
    if (/@import/i.test(css) && !this.ctx.allowExternal) throw new ToolError('@import is not allowed here.');
    if (/url\s*\(\s*['"]?\s*(https?:|\/\/)/i.test(css) && !this.ctx.allowExternal) throw new ToolError('New external resources are not allowed.');
    if (/<\/?style|<script|expression\s*\(|javascript:/i.test(css)) throw new ToolError('That CSS contains something not allowed.');
  }

  private noteRef(slide: ElementInfo): ElementInfo | undefined {
    return slide.children.map((c) => this.doc.byId(c)!).find((c) => c.tag === 'aside' && (getAttr(c, 'class') ?? '').split(/\s+/).includes('notes'));
  }

  // ---- definitions ---------------------------------------------------------------------------------------
  private build(): ToolDef[] {
    const t = (name: string, mode: Mode, description: string, schema: z.ZodObject, run: (a: never) => unknown): ToolDef => ({ name, mode, description, schema, run: run as ToolDef['run'] });
    const list: ToolDef[] = [
      t('get_deck_overview', 'ask', 'Format, outline, theme variables, fonts, stylesheets and assets of the open deck.', z.object({}), () => {
        const det = detectDeck(this.doc);
        const fonts = new Set<string>();
        for (const b of this.styleBlocks()) for (const m of textOf(this.doc, b).matchAll(/font-family\s*:\s*([^;}]+)/gi)) fonts.add(m[1]!.trim());
        this.readEpoch = this.epoch;
        return {
          format: det.adapter, slideSelector: det.selector, slideCount: det.slides.length,
          outline: det.slides.map((s, i) => ({ slide: i + 1, title: s.label, hidden: !!s.hidden })),
          themeVariables: Object.fromEntries(this.themeVars().map((v) => [v.name, v.value])),
          fonts: [...fonts],
          styleBlocks: this.styleBlocks().map((b, i) => ({ index: i, chars: textOf(this.doc, b).length })),
          linkedStylesheets: this.doc.elements.filter((e) => e.tag === 'link' && getAttr(e, 'rel')?.includes('stylesheet')).map((e) => getAttr(e, 'href')),
          dataUris: this.doc.elements.reduce((n, e) => n + e.attrs.filter((a) => /^\s*data:/i.test(a.value)).length, 0),
        };
      }),
      t('get_slide', 'ask', 'The AI view of a slide: markup with data-ref object references, plus text, notes and a version for stale-write protection.',
        z.object({ slide: slideNo, parts: z.array(z.enum(['html', 'text', 'notes'])).optional() }), (a: { slide: number; parts?: string[] }) => {
          const el = this.slideEl(a.slide);
          const parts = a.parts ?? ['html'];
          this.readEpoch = this.epoch;
          const out: Record<string, unknown> = { slide: a.slide, version: this.version(a.slide) };
          if (parts.includes('html')) { out.html = toAiView(this.doc, el, this.assets); out.assets = [...this.assets.keys()].map((k) => ({ id: `asset:${k}`, bytes: this.assets.get(k)!.length })); }
          if (parts.includes('text')) out.text = textOf(this.doc, el).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          if (parts.includes('notes')) { const n = this.noteRef(el); out.notes = n ? textOf(this.doc, n).replace(/<[^>]*>/g, '').trim() : ''; }
          return out;
        }),
      t('get_styles', 'ask', 'The <style> blocks of the deck with line numbers, optionally only lines containing a filter text.', z.object({ filter: z.string().optional() }), (a: { filter?: string }) => {
        return this.styleBlocks().map((b, i) => {
          const lines = textOf(this.doc, b).split(/\r?\n/).map((l, n) => ({ n: n + 1, l }));
          const keep = a.filter ? lines.filter((x) => x.l.toLowerCase().includes(a.filter!.toLowerCase())) : lines;
          return { block: i, lines: keep.slice(0, 400).map((x) => `${x.n}: ${x.l}`) };
        });
      }),
      t('find', 'ask', 'Find text (or a regular expression) in the slides; returns object references.', z.object({ query: z.string().min(1), regex: z.boolean().optional() }), (a: { query: string; regex?: boolean }) => {
        let re: RegExp;
        try { re = a.regex ? new RegExp(a.query, 'i') : new RegExp(a.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } catch { throw new ToolError('Invalid regular expression.'); }
        this.readEpoch = this.epoch;
        const hits: { ref: string; slide: number; text: string }[] = [];
        for (const el of this.doc.elements) {
          const si = this.slideIndexOf(el);
          if (si < 0 || el.endTagStart === null || ['script', 'style'].includes(el.tag)) continue;
          const own = el.children.reduce((s, c) => { const k = this.doc.byId(c)!; return s.replace(this.doc.text.slice(k.start, k.end), ' '); }, textOf(this.doc, el)).replace(/<[^>]*>/g, '').trim();
          if (re.test(own)) hits.push({ ref: `o${el.id}`, slide: si + 1, text: own.slice(0, 160) });
          if (hits.length >= 50) break;
        }
        return { matches: hits };
      }),
      t('get_selection', 'ask', 'What the user has selected right now.', z.object({}), () => {
        this.readEpoch = this.epoch;
        const ids = this.ctx.getSelection?.() ?? [];
        return ids.map((id) => ({ ref: `o${id}`, tag: this.doc.byId(id)?.tag, slide: (this.doc.byId(id) ? this.slideIndexOf(this.doc.byId(id)!) : -1) + 1 }));
      }),
      t('set_text', 'edit', 'Replace an object\'s content. Inline formatting only (b, i, u, a, span, br…).', z.object({ ref, html: z.string().max(100_000), version: z.string().optional() }), (a: { ref: string; html: string; version?: string }) => {
        const el = this.el(a.ref);
        this.checkVersion(el, a.version);
        if (el.endTagStart === null) throw new ToolError('This object has no content.');
        const cmd = setInnerHtmlCommand(el.id, resolveAssets(a.html, this.assets));
        this.exec('AI: set text', (d) => cmd.build(d), [el]);
        return this.result(el);
      }),
      t('set_style', 'edit', 'Change inline styles of objects; null removes a property.', z.object({ refs: z.array(ref).min(1).max(100), properties: z.record(z.string(), z.string().nullable()), version: z.string().optional() }),
        (a: { refs: string[]; properties: Record<string, string | null>; version?: string }) => {
          const els = a.refs.map((r) => this.el(r));
          els.forEach((e) => this.checkVersion(e, a.version));
          for (const [k, v] of Object.entries(a.properties)) {
            if (v !== null && (!isSafeCssValue(v) || (!this.ctx.allowExternal && /url\s*\(\s*['"]?\s*(https?:|\/\/)/i.test(v)))) throw new ToolError(`Value not allowed for ${k}.`);
            if (!/^(--[\w-]+|-?[a-z][a-z0-9-]*)$/i.test(k)) throw new ToolError(`Bad property name ${k}.`);
          }
          const cmd = styleMultiCommand('AI: set style', els.map((e) => ({ id: e.id, set: a.properties })));
          this.exec('AI: set style', (d) => cmd.build(d), els);
          return this.result(els[0]!);
        }),
      t('set_geometry', 'edit', 'Move, resize or rotate an object in px relative to its container. Omit values to keep them.',
        z.object({ ref, x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(), rotation: z.number().optional(), version: z.string().optional() }),
        (a: { ref: string; x?: number; y?: number; w?: number; h?: number; rotation?: number; version?: string }) => {
          const el = this.el(a.ref);
          this.checkVersion(el, a.version);
          const style = getAttr(el, 'style') ?? '';
          const free = /^(absolute|fixed|relative)$/.test(getStyleProp(style, 'position') ?? '');
          const set: Record<string, string> = {};
          // shortcut: only inline `position` is known here, not the computed one; in-layout objects move with translate (upgrade: ask the live view)
          if (a.x !== undefined) set[free ? 'left' : 'translate'] = free ? `${a.x}px` : `${a.x}px ${a.y ?? 0}px`;
          if (a.y !== undefined && free) set.top = `${a.y}px`;
          if (a.y !== undefined && !free && a.x === undefined) set.translate = `0px ${a.y}px`;
          if (a.w !== undefined) set.width = `${a.w}px`;
          if (a.h !== undefined) set.height = `${a.h}px`;
          if (a.rotation !== undefined) set.rotate = `${a.rotation}deg`;
          if (!Object.keys(set).length) throw new ToolError('Give at least one of x, y, w, h, rotation.');
          const cmd = styleMultiCommand('AI: set geometry', [{ id: el.id, set }]);
          this.exec('AI: set geometry', (d) => cmd.build(d), [el]);
          return this.result(el);
        }),
      t('set_attributes', 'edit', 'Set or remove (null) attributes. Not style (use set_style) and no event handlers.', z.object({ ref, attributes: z.record(z.string(), z.string().nullable()), version: z.string().optional() }),
        (a: { ref: string; attributes: Record<string, string | null>; version?: string }) => {
          const el = this.el(a.ref);
          this.checkVersion(el, a.version);
          for (const [k, v] of Object.entries(a.attributes)) {
            if (!/^[a-z][a-z0-9:_-]*$/i.test(k) || /^on/i.test(k) || /^(style|srcdoc|contenteditable)$/i.test(k) || /^data-(deckhand|ref)/i.test(k)) throw new ToolError(`Attribute ${k} is not allowed.`);
            if (v !== null && /^(href|src|action|formaction|xlink:href)$/i.test(k)) {
              const c = v.replace(/[\u0000- \u007f-\u009f]/g, '');
              if (/^(javascript|vbscript):/i.test(c) || (/^data:(?!image\/)/i.test(c)) || (/^(https?:)?\/\//i.test(c) && !this.ctx.allowExternal)) throw new ToolError(`That ${k} is not allowed.`);
            }
          }
          this.exec('AI: set attributes', (d) => {
            const e = d.byId(el.id)!;
            const out: Patch[] = [];
            for (const [k, v] of Object.entries(a.attributes)) {
              if (v === null) { const p = removeAttrPatch(d, e, k); if (p) out.push(p); } else out.push(setAttrPatch(d, e, k, v));
            }
            return out;
          }, [el]);
          return this.result(el);
        }),
      t('set_classes', 'edit', 'Add and remove CSS classes.', z.object({ ref, add: z.array(z.string()).optional(), remove: z.array(z.string()).optional(), version: z.string().optional() }),
        (a: { ref: string; add?: string[]; remove?: string[]; version?: string }) => {
          const el = this.el(a.ref);
          this.checkVersion(el, a.version);
          const all = [...(a.add ?? []), ...(a.remove ?? [])];
          if (all.some((c) => !/^[\w:/.\[\]%-]+$/.test(c))) throw new ToolError('Bad class name.');
          this.exec('AI: set classes', (d) => {
            const e = d.byId(el.id)!;
            const cur = (getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean);
            const next = [...cur.filter((c) => !(a.remove ?? []).includes(c)), ...(a.add ?? []).filter((c) => !cur.includes(c))];
            if (next.join(' ') === cur.join(' ')) return [];
            if (!next.length) { const p = removeAttrPatch(d, e, 'class'); return p ? [p] : []; }
            return [setAttrPatch(d, e, 'class', next.join(' '))];
          }, [el]);
          return this.result(el);
        }),
      t('insert_html', 'edit', 'Insert new markup before/after an object or at the start/end of it. Asset placeholders (asset:img-N) are resolved.',
        z.object({ ref, position: z.enum(['before', 'after', 'start', 'end']), html: z.string().min(1).max(200_000), version: z.string().optional() }),
        (a: { ref: string; position: 'before' | 'after' | 'start' | 'end'; html: string; version?: string }) => {
          const el = this.el(a.ref, { allowSlideRoot: true });
          this.checkVersion(el, a.version);
          const html = this.clean(a.html);
          if (!html.trim()) throw new ToolError('Nothing left after removing unsafe markup.');
          this.exec('AI: insert', (d) => {
            const e = d.byId(el.id)!;
            const eol = this.eol();
            const ind = this.indentOf(e.start);
            const onOwn = d.text.slice(d.text.lastIndexOf('\n', e.start - 1) + 1, e.start).trim() === '';
            if (a.position === 'before') return [{ start: e.start, end: e.start, text: onOwn ? `${this.fit(html, ind)}${eol}${ind}` : html }];
            if (a.position === 'after') return [{ start: e.end, end: e.end, text: onOwn ? `${eol}${ind}${this.fit(html, ind)}` : html }];
            if (e.endTagStart === null) throw new ToolError('This object cannot contain markup.');
            const kid = e.children.length ? d.byId(e.children[0]!)! : null;
            const kidInd = kid && d.text.slice(d.text.lastIndexOf('\n', kid.start - 1) + 1, kid.start).trim() === '' ? this.indentOf(kid.start) : `${ind}  `;
            if (a.position === 'start') return [{ start: e.startTagEnd, end: e.startTagEnd, text: `${eol}${kidInd}${this.fit(html, kidInd)}` }];
            const trailing = /\s*$/.exec(d.text.slice(e.startTagEnd, e.endTagStart))![0].length;
            const at = e.endTagStart - trailing;
            return [{ start: at, end: at, text: `${eol}${kidInd}${this.fit(html, kidInd)}` }];
          }, [el]);
          return this.result(el);
        }),
      t('replace_html', 'edit', 'Replace an object (its tag included) with new markup.', z.object({ ref, html: z.string().min(1).max(200_000), version: z.string().optional() }), (a: { ref: string; html: string; version?: string }) => {
        const el = this.el(a.ref);
        this.checkVersion(el, a.version);
        const html = this.clean(a.html);
        if (!html.trim()) throw new ToolError('Nothing left after removing unsafe markup.');
        this.exec('AI: replace', (d) => { const e = d.byId(el.id)!; return [{ start: e.start, end: e.end, text: this.fit(html, this.indentOf(e.start)) }]; }, [el]);
        return this.result(el);
      }),
      t('delete', 'edit', 'Delete objects.', z.object({ refs: z.array(ref).min(1).max(100), version: z.string().optional() }), (a: { refs: string[]; version?: string }) => {
        const els = a.refs.map((r) => this.el(r));
        els.forEach((e) => this.checkVersion(e, a.version));
        this.exec('AI: delete', (d) => {
          const top = els.filter((e) => !els.some((o) => o !== e && o.start <= e.start && o.end >= e.end && (o.start < e.start || o.end > e.end)));
          return top.flatMap((e) => deleteElementCommand(e.id).build(d));
        }, els);
        return this.result(null, { deleted: els.length });
      }),
      t('add_slide', 'edit', 'Add a slide after slide `after` (0 = first). Give `layout` (an existing slide number to copy the structure from) or `html` for the new slide element.',
        z.object({ after: z.number().int().min(0), layout: slideNo.optional(), html: z.string().max(200_000).optional() }), (a: { after: number; layout?: number; html?: string }) => {
          const n = this.slides().length;
          if (a.after > n) throw new ToolError(`The deck has ${n} slides.`);
          if (!a.layout && !a.html) throw new ToolError('Give either layout or html.');
          const src = a.layout ? this.slideEl(a.layout) : null;
          const html = a.html ? this.clean(a.html) : this.doc.text.slice(src!.start, src!.end);
          const anchor = this.slideEl(a.after || 1);
          this.exec('AI: add slide', (d) => {
            const e = d.byId(anchor.id)!;
            const ind = this.indentOf(e.start);
            const eol = this.eol();
            return a.after === 0 ? [{ start: e.start, end: e.start, text: `${this.fit(html, ind)}${eol}${ind}` }] : [{ start: e.end, end: e.end, text: `${eol}${ind}${this.fit(html, ind)}` }];
          }, []);
          this.touched.add(a.after);
          return this.result(null, { slides: this.slides().length });
        }),
      t('duplicate_slides', 'edit', 'Duplicate slides (each copy is placed right after its original).', z.object({ slides: z.array(slideNo).min(1).max(50) }), (a: { slides: number[] }) => {
        const ids = a.slides.map((n) => this.slideEl(n).id).sort((x, y) => y - x);
        for (const id of ids) this.exec('AI: duplicate slide', (d) => duplicateElementCommand(id).build(d), []);
        this.touched.add(a.slides[0]!);
        return this.result(null, { slides: this.slides().length });
      }),
      t('move_slides', 'edit', 'Move slides so they follow slide `after` (0 = to the start). Their relative order is kept.', z.object({ slides: z.array(slideNo).min(1).max(50), after: z.number().int().min(0) }), (a: { slides: number[]; after: number }) => {
        const all = this.slides();
        if (a.after > all.length) throw new ToolError(`The deck has ${all.length} slides.`);
        const nums = [...new Set(a.slides)].sort((x, y) => x - y);
        if (nums.includes(a.after)) throw new ToolError('`after` cannot be one of the slides being moved.');
        const moving = nums.map((n) => this.slideEl(n));
        const rest = all.filter((_, i) => !nums.includes(i + 1));
        const idx = all.slice(0, a.after).filter((_, i) => !nums.includes(i + 1)).length; // rest[idx] follows the target
        const following = rest[idx] ? this.doc.byId(rest[idx]!.id)! : null;
        const parent = this.doc.byId(moving[0]!.parent!)!;
        this.exec('AI: move slides', (d) => {
          const eol = this.eol();
          const ind = this.indentOf(moving[0]!.start);
          const html = moving.map((e) => d.text.slice(e.start, e.end)).join(eol + ind);
          const out: Patch[] = moving.map((e) => ({ start: e.start, end: e.end + (/^[ \t]*\r?\n/.exec(d.text.slice(e.end))?.[0].length ?? 0), text: '' }));
          if (following) out.push({ start: following.start, end: following.start, text: html + eol + ind });
          else { const at = parent.endTagStart! - /\s*$/.exec(d.text.slice(parent.startTagEnd, parent.endTagStart!))![0].length; out.push({ start: at, end: at, text: eol + ind + html }); }
          return out;
        }, moving);
        return this.result(null, { order: this.slides().map((s, i) => `${i + 1}: ${s.label}`) });
      }),
      t('delete_slides', 'edit', 'Delete slides (never all of them).', z.object({ slides: z.array(slideNo).min(1).max(50) }), (a: { slides: number[] }) => {
        if (new Set(a.slides).size >= this.slides().length) throw new ToolError('A deck needs at least one slide.');
        const els = [...new Set(a.slides)].map((n) => this.slideEl(n));
        this.exec('AI: delete slides', (d) => els.flatMap((e) => deleteElementCommand(e.id).build(d)), els);
        return this.result(null, { slides: this.slides().length });
      }),
      t('set_slide_hidden', 'edit', 'Hide or show a slide in the slide show (reveal.js decks).', z.object({ slide: slideNo, hidden: z.boolean() }), (a: { slide: number; hidden: boolean }) => {
        if (detectDeck(this.doc).adapter !== 'revealjs') throw new ToolError('Hiding slides is only supported for reveal.js decks.');
        const el = this.slideEl(a.slide);
        this.exec('AI: hide slide', (d) => {
          const e = d.byId(el.id)!;
          if (a.hidden) return [setAttrPatch(d, e, 'data-visibility', 'hidden')];
          const p = removeAttrPatch(d, e, 'data-visibility');
          return p ? [p] : [];
        }, [el]);
        return this.result(el);
      }),
      t('set_notes', 'edit', 'Set the speaker notes of a slide (reveal.js decks: <aside class="notes">).', z.object({ slide: slideNo, text: z.string().max(20_000) }), (a: { slide: number; text: string }) => {
        if (detectDeck(this.doc).adapter !== 'revealjs') throw new ToolError('Speaker notes are only supported for reveal.js decks.');
        const el = this.slideEl(a.slide);
        const body = this.clean(a.text.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
        this.exec('AI: set notes', (d) => {
          const e = d.byId(el.id)!;
          const note = e.children.map((c) => d.byId(c)!).find((c) => c.tag === 'aside' && (getAttr(c, 'class') ?? '').split(/\s+/).includes('notes'));
          if (note) return [{ start: note.startTagEnd, end: note.endTagStart!, text: body }];
          const at = e.endTagStart!;
          return [{ start: at, end: at, text: `<aside class="notes">${body}</aside>` }];
        }, [el]);
        return this.result(el);
      }),
      t('set_theme_variable', 'edit', 'Change a CSS custom property (theme color or font) declared on :root.', z.object({ name: z.string(), value: z.string() }), (a: { name: string; value: string }) => {
        const name = a.name.startsWith('--') ? a.name : `--${a.name}`;
        if (!isSafeCssValue(a.value) || (!this.ctx.allowExternal && /url\s*\(\s*['"]?\s*(https?:|\/\/)/i.test(a.value))) throw new ToolError('That value is not allowed.');
        const v = this.themeVars().find((x) => x.name === name);
        if (!v) throw new ToolError(`No theme variable ${name}. Existing: ${this.themeVars().map((x) => x.name).join(', ') || 'none'}.`);
        this.exec('AI: theme', () => [{ start: v.start, end: v.end, text: a.value }], []);
        this.touched.clear();
        return { ok: true };
      }),
      t('edit_css', 'edit', 'Exact replacement inside a <style> block (deck-wide restyling). `old` must occur exactly once in that block.', z.object({ block: z.number().int().min(0), old: z.string().min(1), new: z.string() }), (a: { block: number; old: string; new: string }) => {
        const b = this.styleBlocks()[a.block];
        if (!b) throw new ToolError(`No style block ${a.block}.`);
        const css = textOf(this.doc, b);
        const first = css.indexOf(a.old);
        if (first < 0 || css.indexOf(a.old, first + 1) >= 0) throw new ToolError(first < 0 ? '`old` was not found in that block.' : '`old` occurs more than once; include more context.');
        this.checkCss(css.slice(0, first) + a.new + css.slice(first + a.old.length));
        this.exec('AI: edit css', () => [{ start: b.startTagEnd + first, end: b.startTagEnd + first + a.old.length, text: a.new }], []);
        this.touched.clear();
        return { ok: true };
      }),
      t('replace_in_source', 'edit', 'Last resort: exact replacement in the HTML source; `old` must match exactly once. Scripts and handlers cannot be added.', z.object({ old: z.string().min(1), new: z.string() }), (a: { old: string; new: string }) => {
        const text = this.doc.text;
        const first = text.indexOf(a.old);
        if (first < 0 || text.indexOf(a.old, first + 1) >= 0) throw new ToolError(first < 0 ? '`old` was not found.' : '`old` occurs more than once; include more context.');
        const added = resolveAssets(a.new, this.assets);
        if (/<script|\son[a-z]+\s*=|javascript:|data-deckhand|data-ref=/i.test(added)) throw new ToolError('That markup contains scripts, handlers or editor attributes, which are not allowed.');
        if (!this.ctx.allowExternal && /(src|href)\s*=\s*["']?(https?:)?\/\//i.test(added)) throw new ToolError('New external resources are not allowed.');
        this.exec('AI: edit source', () => [{ start: first, end: first + a.old.length, text: added }], []);
        this.touched.clear();
        return { ok: true, note: 'Call get_slide again.' };
      }),
    ];
    if (this.ctx.renderSlide) {
      list.push(t('render_slide', 'ask', 'PNG of a slide as currently edited (vision models).', z.object({ slide: slideNo, width: z.number().int().min(200).max(1920).optional() }), async (a: { slide: number; width?: number }) => {
        this.slideEl(a.slide);
        return { image: await this.ctx.renderSlide!(a.slide, a.width ?? 960) };
      }));
    }
    return list;
  }

  private defs(): ToolDef[] { return (this.defsCache ??= this.build()); }

  /** Tool definitions for the model: Ask offers only the read tools (AIE-01). */
  specs(mode: Mode): ToolSpec[] {
    return this.defs().filter((d) => mode === 'edit' || d.mode === 'ask').map((d) => ({ name: d.name, description: d.description, parameters: z.toJSONSchema(d.schema) as Record<string, unknown> }));
  }

  /** Validate and run one call; failures come back as `{error}` the model can act on (AIT-01). */
  async call(name: string, args: unknown, mode: Mode): Promise<unknown> {
    const d = this.defs().find((x) => x.name === name);
    if (!d || (mode === 'ask' && d.mode === 'edit')) return { error: `Unknown tool ${name}.` };
    const parsed = d.schema.safeParse(args);
    if (!parsed.success) return { error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    try {
      return await d.run(parsed.data as never);
    } catch (e) {
      if (e instanceof ToolError) return { error: e.message };
      return { error: `The tool failed: ${(e as Error).message}` };
    }
  }

  get changedSlides(): number[] { return [...this.touched].sort((a, b) => a - b); }
}
