/**
 * Agent: injected as the first script of the live view only (never saved). It runs in the same context as
 * (potentially hostile) deck scripts, so it captures native APIs first and talks to the editor over a
 * private MessagePort that deck code never sees. The editor treats every message as untrusted (SEC-08).
 */
declare const __DECKHAND_TOKEN__: string;

(() => {
  const TOKEN = __DECKHAND_TOKEN__;
  // --- capture natives before deck scripts run ---------------------------------------------------
  const doc = document;
  const win = window;
  const N = {
    qsa: Document.prototype.querySelectorAll.bind(doc),
    qs: Document.prototype.querySelector.bind(doc),
    qsaOf: (root: Element, sel: string): Element[] => Array.from(Element.prototype.querySelectorAll.call(root, sel) as NodeListOf<Element>),
    elementsFromPoint: Document.prototype.elementsFromPoint.bind(doc),
    getComputedStyle: win.getComputedStyle.bind(win),
    getAttribute: Element.prototype.getAttribute,
    setAttribute: Element.prototype.setAttribute,
    removeAttribute: Element.prototype.removeAttribute,
    gbcr: Element.prototype.getBoundingClientRect,
    addEventListener: win.addEventListener.bind(win),
    postMessage: MessagePort.prototype.postMessage,
    setInterval: win.setInterval.bind(win),
    setTimeout: win.setTimeout.bind(win),
    clearTimeout: win.clearTimeout.bind(win),
    JSON,
    Math,
    Array,
    from: Array.from,
  };
  const me = doc.currentScript;
  const ID = 'data-deckhand-id';
  const MAX_HTML = 2_000_000;

  let port: MessagePort | null = null;
  const send = (m: unknown): void => { if (port) N.postMessage.call(port, m); };

  const byId = (id: number): HTMLElement | null => N.qs(`[${ID}="${id}"]`) as HTMLElement | null;
  const idOf = (el: Element | null): number | null => {
    if (!el) return null;
    const v = N.getAttribute.call(el, ID);
    if (v === null) return null;
    const n = Number(v);
    // duplicate ids (nodes cloned by deck scripts) are generated content (ARCH-04)
    return Number.isInteger(n) && (N.qsa(`[${ID}="${n}"]`) as NodeListOf<Element>).length === 1 ? n : null;
  };

  // Editor stylesheet: live view only. Final-state animations (RND-07).
  const style = doc.createElement('style');
  style.textContent = `*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;animation-iteration-count:1!important;animation-fill-mode:forwards!important;transition:none!important;caret-color:auto}
a{pointer-events:auto}html{scroll-behavior:auto!important}[data-deckhand-editing]{outline:2px dashed #C43E1C;outline-offset:2px;cursor:text}`;
  const inject = (): void => { (doc.head || doc.documentElement).appendChild(style); };
  if (doc.head) inject(); else N.addEventListener('DOMContentLoaded', inject);

  // --- geometry ------------------------------------------------------------------------------------
  const px = (v: string): number | null => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  const anchors = (el: Element): { right: boolean; bottom: boolean } => {
    let right = N.getAttribute.call(el, 'style')?.match(/(^|;)\s*right\s*:/i) != null;
    let bottom = N.getAttribute.call(el, 'style')?.match(/(^|;)\s*bottom\s*:/i) != null;
    const left = N.getAttribute.call(el, 'style')?.match(/(^|;)\s*left\s*:/i) != null;
    const top = N.getAttribute.call(el, 'style')?.match(/(^|;)\s*top\s*:/i) != null;
    for (const sheet of N.from(doc.styleSheets) as CSSStyleSheet[]) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of N.from(rules) as CSSRule[]) {
        const sr = r as CSSStyleRule;
        if (!sr.selectorText || !sr.style) continue;
        let m = false;
        try { m = (el as Element).matches(sr.selectorText); } catch { /* ignore */ }
        if (!m) continue;
        if (sr.style.getPropertyValue('right') && !sr.style.getPropertyValue('left') && !left) right = true;
        if (sr.style.getPropertyValue('bottom') && !sr.style.getPropertyValue('top') && !top) bottom = true;
      }
    }
    return { right, bottom };
  };

  const rectOf = (id: number) => {
    const el = byId(id);
    if (!el) return null;
    const r = N.gbcr.call(el) as DOMRect;
    const cs = N.getComputedStyle(el);
    const ow = (el as HTMLElement).offsetWidth || r.width;
    const oh = (el as HTMLElement).offsetHeight || r.height;
    const parent = el.parentElement;
    const pr = parent ? (N.gbcr.call(parent) as DOMRect) : r;
    const pw = parent ? parent.clientWidth || pr.width : 0;
    const ph = parent ? parent.clientHeight || pr.height : 0;
    return {
      id,
      x: r.left, y: r.top, w: r.width, h: r.height,
      // CSS px → viewport px scale (stage scaling, zoom, transforms)
      sx: ow ? r.width / ow : 1, sy: oh ? r.height / oh : 1,
      position: cs.position, display: cs.display, tag: el.tagName.toLowerCase(),
      cls: (N.getAttribute.call(el, 'class') || '').slice(0, 200),
      left: px(cs.left), top: px(cs.top), right: px(cs.right), bottom: px(cs.bottom),
      width: px(cs.width), height: px(cs.height), cw: pw, ch: ph,
      transform: cs.transform === 'none' ? null : cs.transform,
      anchors: cs.position === 'absolute' || cs.position === 'fixed' ? anchors(el) : null,
      opacity: px(cs.opacity), visible: cs.visibility !== 'hidden' && cs.display !== 'none',
      color: cs.color, background: cs.backgroundColor, fontSize: px(cs.fontSize), fontFamily: cs.fontFamily.slice(0, 120),
      fontWeight: cs.fontWeight, textAlign: cs.textAlign, borderRadius: cs.borderRadius, borderWidth: cs.borderTopWidth,
      borderColor: cs.borderTopColor, borderStyle: cs.borderTopStyle,
      text: el.children.length === 0 && el.tagName !== 'IMG' && !!el.textContent,
      pdisplay: parent ? N.getComputedStyle(parent).display : '', zIndex: cs.zIndex === 'auto' ? 0 : (px(cs.zIndex) ?? 0),
      extraW: cs.boxSizing === 'border-box' ? 0 : (px(cs.paddingLeft) ?? 0) + (px(cs.paddingRight) ?? 0) + (px(cs.borderLeftWidth) ?? 0) + (px(cs.borderRightWidth) ?? 0),
      extraH: cs.boxSizing === 'border-box' ? 0 : (px(cs.paddingTop) ?? 0) + (px(cs.paddingBottom) ?? 0) + (px(cs.borderTopWidth) ?? 0) + (px(cs.borderBottomWidth) ?? 0),
      iframeLike: ['IFRAME', 'VIDEO', 'CANVAS', 'AUDIO', 'OBJECT', 'EMBED'].includes(el.tagName),
    };
  };

  const hit = (x: number, y: number): number[] => {
    const out: number[] = [];
    for (const el of N.elementsFromPoint(x, y)) {
      const id = idOf(el);
      if (id !== null) out.push(id);
    }
    return out;
  };

  // --- slide navigation (design mode only; live DOM, never saved) -----------------------------------
  let slideIds: number[] = [];
  let stateToken: string | null = null;
  const STATE = /^(active|current|present|visible|is-active|is-current|show|shown)$/;
  // Editing needs every object visible: build steps / fragments that the deck reveals one by one are shown while editing (live view only, never saved).
  let revealStyle: HTMLStyleElement | null = null;
  const BUILD = '[data-step],[data-fragment-index],.fragment,.step,.build';
  const revealBuilds = (root: Element): void => {
    if (!revealStyle) {
      revealStyle = doc.createElement('style');
      revealStyle.textContent = '[data-deckhand-reveal]{opacity:1!important;visibility:visible!important;transform:none!important}[data-deckhand-future]{opacity:.2!important}';
      (doc.head ?? doc.documentElement).appendChild(revealStyle);
    }
    for (const e of N.qsaOf(root, BUILD) as Element[]) {
      const cs = N.getComputedStyle(e);
      if (cs.opacity === '0' || cs.visibility === 'hidden') N.setAttribute.call(e, 'data-deckhand-reveal', '');
    }
  };
  // Step preview: objects that only appear after step n are dimmed (still selectable), so the author sees the slide as it looks at that action.
  const stepNo = (e: Element): number | null => {
    const v = N.getAttribute.call(e, 'data-step') ?? N.getAttribute.call(e, 'data-fragment-index');
    return v !== null && /^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : null;
  };
  const previewStep = (index: number, n: number | null): void => {
    for (const e of N.qsaOf(doc.documentElement, '[data-deckhand-future]') as Element[]) N.removeAttribute.call(e, 'data-deckhand-future');
    const target = slideIds.map(byId)[index];
    if (n === null || !target) return;
    for (const e of N.qsaOf(target, BUILD) as Element[]) {
      const s = stepNo(e);
      if (s !== null && s > n) N.setAttribute.call(e, 'data-deckhand-future', '');
    }
  };
  const showSlide = (index: number): void => {
    const els = slideIds.map(byId);
    const target = els[index];
    if (!target) return;
    revealBuilds(target);
    if (stateToken === null) {
      const holders = els.filter((e): e is HTMLElement => !!e && N.from(e.classList).some((c) => STATE.test(c as string)));
      if (holders.length === 1) stateToken = (N.from(holders[0]!.classList) as string[]).find((c) => STATE.test(c)) ?? '';
      else stateToken = '';
    }
    if (stateToken) {
      for (const e of els) if (e) e.classList.toggle(stateToken, e === target);
      // groups of slides (reveal.js vertical stacks) carry the state class too: the stack of the shown slide must show
      if (groupAnc === null) {
        groupAnc = [];
        for (const e of els) {
          for (let a = e?.parentElement ?? null; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
            const peers = a.parentElement ? (N.from(a.parentElement.children) as Element[]).filter((x) => x.tagName === a!.tagName) : [];
            if (peers.length >= 2 && peers.some((x) => x.classList.contains(stateToken!)) && !groupAnc.includes(a)) groupAnc.push(a);
          }
        }
      }
      for (const g of groupAnc) g.classList.toggle(stateToken, g.contains(target));
    } else {
      // no class mechanism: if slides are hidden via display/visibility/opacity, force the target visible and others hidden
      const hidden = els.filter((e) => e && e !== target && N.getComputedStyle(e).display === 'none').length;
      if (hidden >= els.length - 2 && els.length > 1) {
        for (const e of els) if (e) e.style.display = e === target ? '' : 'none';
        if (N.getComputedStyle(target).display === 'none') target.style.display = 'block';
      } else {
        target.scrollIntoView({ block: 'start', inline: 'start' });
        pinScroll(target);
      }
    }
    bringIntoView(target);
  };
  // Free-form decks (impress.js, carousels) move a camera or a track to show a slide; the editor has no camera, so a slide that is
  // off screen is brought in by shifting its container (live view only; restored on the next call).
  // scroll-snap containers can snap back to the slide that was snapped before right after a programmatic scroll: hold the position for half a second
  let pin = 0;
  const pinScroll = (target: HTMLElement): void => {
    const mine = ++pin;
    for (const ms of [60, 200, 500]) {
      N.setTimeout(() => {
        if (pin !== mine) return;
        const r = N.gbcr.call(target) as DOMRect;
        if (Math.abs(r.top) > 2 || Math.abs(r.left) > 2) target.scrollIntoView({ block: 'start', inline: 'start' });
      }, ms);
    }
  };
  let groupAnc: Element[] | null = null;
  let shifted: { host: HTMLElement; transform: string; translate: string } | null = null;
  const inView = (e: Element): boolean => {
    const r = N.gbcr.call(e) as DOMRect;
    return r.width > 0 && r.height > 0 && r.right > 1 && r.left < win.innerWidth - 1 && r.bottom > 1 && r.top < win.innerHeight - 1;
  };
  const bringIntoView = (target: HTMLElement): void => {
    if (shifted) { shifted.host.style.transform = shifted.transform; shifted.host.style.translate = shifted.translate; shifted = null; }
    const host = target.parentElement;
    if (!host || host === doc.body || N.getComputedStyle(target).display === 'none' || inView(target)) return;
    shifted = { host, transform: host.style.transform, translate: host.style.translate };
    host.style.transform = 'none';
    host.style.translate = '';
    const r = N.gbcr.call(target) as DOMRect;
    host.style.translate = `${win.innerWidth / 2 - (r.left + r.width / 2)}px ${win.innerHeight / 2 - (r.top + r.height / 2)}px`;
  };

  // --- text editing ---------------------------------------------------------------------------------
  let editing: HTMLElement | null = null;
  let editDirty = false;
  let keyedSinceEdit = false;
  let editStartedAt = 0;
  let lastRange: Range | null = null;
  let lastSelected: Range | null = null; // last non-collapsed selection: the link dialog takes focus away and the selection collapses
  let savedRange: Range | null = null;
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

  let editQuirk = false;
  const liveTags = (el: Element): string[] => {
    const out: string[] = [];
    const w = (n: Element): void => { for (const c of N.from(n.children) as Element[]) { out.push(c.tagName.toLowerCase()); w(c); } };
    w(el);
    return out;
  };
  const startEdit = (id: number, expectedText: string, at?: { x: number; y: number; mode: string }, srcTags?: string[]): void => {
    const el = byId(id);
    if (!el) return send({ t: 'edit-refused', id, why: 'missing' });
    // TXT-04: live content must match the source text, otherwise scripts have transformed it
    if (norm(el.textContent || '') !== norm(expectedText)) return send({ t: 'edit-refused', id, why: 'transformed' });
    // Same check for structure: the HTML parser (malformed markup) or deck scripts may have added/moved elements. Then only plain text is
    // safe to write back, and only if the source had no inline tags of its own.
    const live = liveTags(el);
    const src = Array.isArray(srcTags) ? srcTags.map((t) => String(t).toLowerCase()) : null;
    editQuirk = src !== null && (src.length !== live.length || src.some((t, i) => t !== live[i]));
    if (editQuirk && src!.length > 0) return send({ t: 'edit-refused', id, why: 'structure' });
    // A double-click starts the edit twice: on mouse-up (caret) and again on dblclick (word), the latter after a hit-test round
    // trip. The second start must only place the word selection, and only while the user has not typed or selected since.
    const again = editing === el;
    if (again && (keyedSinceEdit || editDirty || !at || at.mode !== 'word')) {
      // The second mouse-down of the double-click moved keyboard focus to the editor page: ask the UI to hand it back.
      if (!keyedSinceEdit) send({ t: 'edit-started', id });
      return;
    }
    editing = el;
    if (!again) { editDirty = false; keyedSinceEdit = false; editStartedAt = Date.now(); lastRange = null; lastSelected = null; }
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-deckhand-editing', '');
    win.focus();
    el.focus();
    const sel = win.getSelection();
    if (sel) {
      const pt = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : null;
      const caret = pt ? (doc.caretRangeFromPoint ? doc.caretRangeFromPoint(pt.x, pt.y) : null) : null;
      if (caret && el.contains(caret.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(caret);
        if (pt && pt.mode === 'word') { sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word'); } // TXT-02: double-click selects the word
      } else {
        const r = doc.createRange();
        r.selectNodeContents(el);
        r.collapse(false); // F2/Enter: caret at the end
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    send({ t: 'edit-started', id });
  };

  const stopEdit = (commit: boolean): void => {
    const el = editing;
    if (!el) return;
    editing = null;
    const id = idOf(el);
    const html = el.innerHTML;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    el.removeAttribute('data-deckhand-editing');
    const text = el.textContent || '';
    send({ t: 'edit-end', id, dirty: editDirty && commit, html: editDirty && commit && !editQuirk ? html.slice(0, MAX_HTML) : null, text: editDirty && commit && editQuirk ? text.slice(0, MAX_HTML) : null, quirk: editQuirk });
    editQuirk = false;
  };

  const wrapSelection = (tag: string, css?: [string, string], attr?: [string, string]): void => {
    if (editQuirk) return; // formatting would be written on top of parser-generated structure
    const sel = win.getSelection();
    if (!editing || !sel) return;
    const live = sel.rangeCount > 0 && !sel.isCollapsed;
    if (!live && !(attr && lastSelected)) return;
    const range = live ? sel.getRangeAt(0) : lastSelected!;
    if (!editing.contains(range.commonAncestorContainer)) return;
    if (attr) {
      // links: an existing link around the selection is retargeted instead of nested or removed
      for (let n: Node | null = range.commonAncestorContainer; n && n !== editing; n = n.parentNode) {
        if (n.nodeType === 1 && (n as Element).tagName.toLowerCase() === tag) { (n as Element).setAttribute(attr[0], attr[1]); editDirty = true; return; }
      }
    }
    if (!css && !attr) {
      // toggle off if selection sits inside the same tag
      let n: Node | null = range.commonAncestorContainer;
      while (n && n !== editing) {
        if (n.nodeType === 1 && (n as Element).tagName.toLowerCase() === tag) {
          const e = n as Element;
          while (e.firstChild) e.parentNode!.insertBefore(e.firstChild, e);
          e.remove();
          editDirty = true;
          return;
        }
        n = n.parentNode;
      }
    }
    const w = doc.createElement(tag);
    if (css) w.style.setProperty(css[0], css[1]);
    if (attr) w.setAttribute(attr[0], attr[1]);
    w.appendChild(range.extractContents());
    range.insertNode(w);
    sel.removeAllRanges();
    const r = doc.createRange();
    r.selectNodeContents(w);
    sel.addRange(r);
    editDirty = true;
  };

  // Edit-key handling must be registered BEFORE the suppress listeners: they call stopImmediatePropagation().
  N.addEventListener('keydown', (e) => {
    if (!editing) return;
    keyedSinceEdit = true;
    const k = e as KeyboardEvent;
    if (k.key === 'Escape') { stopEdit(true); return; }
    if (k.key === 'Enter') { // TXT-08 (simplified): <br>
      k.preventDefault();
      const sel = win.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const br = doc.createElement('br');
        r.insertNode(br);
        r.setStartAfter(br); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        editDirty = true;
      }
    }
    if ((k.ctrlKey || k.metaKey) && !k.altKey) {
      const key = k.key.toLowerCase();
      if (key === 'b') { k.preventDefault(); wrapSelection('strong'); }
      else if (key === 'i') { k.preventDefault(); wrapSelection('em'); }
      else if (key === 'u') { k.preventDefault(); wrapSelection('u'); }
    }
  }, true);

  // --- frames: a deck whose slide is built by timers (typed prompts, chat lines…) is expanded into steps ---------
  // Only in a live view opened with #deckhand-frames. Timers set by the deck after the editor arms this are queued on a virtual clock and
  // fired one at a time, so every frame can be looked at and its text edited. Nothing here touches the saved file.
  const FRAMES = win.location.hash === '#deckhand-frames';
  interface VTimer { id: number; at: number; seq: number; fn: (...a: unknown[]) => void; args: unknown[] }
  let virtual = false;
  let vq: VTimer[] = [];
  let vnow = 0;
  let vseq = 0;
  let vframe = 0;
  let passDeck = false;
  if (FRAMES) {
    win.setTimeout = ((fn: unknown, ms?: unknown, ...args: unknown[]): number => {
      if (!virtual || typeof fn !== 'function') return N.setTimeout(fn as TimerHandler, Number(ms) || 0, ...args);
      const id = 1_000_000_000 + vseq;
      vq.push({ id, at: vnow + Math.max(0, Number(ms) || 0), seq: vseq++, fn: fn as VTimer['fn'], args });
      return id;
    }) as typeof win.setTimeout;
    win.clearTimeout = ((id?: number): void => {
      if (typeof id === 'number' && id >= 1_000_000_000) vq = vq.filter((t) => t.id !== id);
      else N.clearTimeout(id);
    }) as typeof win.clearTimeout;
  }
  const fireNext = (): boolean => {
    if (vq.length === 0) return false;
    let k = 0;
    for (let i = 1; i < vq.length; i++) if (vq[i]!.at < vq[k]!.at || (vq[i]!.at === vq[k]!.at && vq[i]!.seq < vq[k]!.seq)) k = i;
    const t = vq.splice(k, 1)[0]!;
    vnow = t.at;
    vframe++;
    passDeck = true;
    try { t.fn(...t.args); } catch { /* a deck error in one frame must not stop the others */ }
    passDeck = false;
    return true;
  };
  const frameState = (): unknown => ({ t: 'frame', n: vframe, total: vframe + vq.length, time: Math.round(vnow), reset: false });

  // suppress the deck's own handlers in design mode (RND-03): capture phase, stop before deck listeners see events
  const suppress = (e: Event): void => {
    if (passDeck) return;
    if (editing && e.target instanceof Node && editing.contains(e.target)) {
      // typing must not trigger deck navigation, but default editing must work; editor shortcuts are forwarded
      const k = e as KeyboardEvent;
      if (e.type === 'keydown' && (k.ctrlKey || k.metaKey) && /^[szy]$/i.test(k.key)) {
        if (k.key.toLowerCase() === 's') { e.preventDefault(); send({ t: 'key', key: 's' }); }
        else { e.preventDefault(); send({ t: 'key', key: k.key.toLowerCase(), shift: k.shiftKey }); }
      }
      e.stopImmediatePropagation();
      return;
    }
    if (editing && (e.type === 'mousedown' || e.type === 'click')) send({ t: 'edit-outside' });
    if (e.type === 'keydown') {
      // focus can sit in the live view after editing: forward the key to the editor so shortcuts (save, undo, arrows…) still work
      const k = e as KeyboardEvent;
      send({ t: 'key', key: String(k.key).slice(0, 20), ctrl: k.ctrlKey, shift: k.shiftKey, alt: k.altKey, meta: k.metaKey, fwd: true });
    }
    e.stopImmediatePropagation();
    if (e.type !== 'scroll' && e.type !== 'resize') e.preventDefault();
  };
  for (const t of ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'wheel', 'touchstart', 'touchend', 'contextmenu', 'dragstart', 'submit', 'auxclick']) {
    N.addEventListener(t, suppress, { capture: true, passive: false } as AddEventListenerOptions);
  }
  N.addEventListener('input', () => { if (editing) editDirty = true; }, true);
  // Handing the iframe keyboard focus is asynchronous in the browser process, and on some platforms it blurs the focused element a
  // moment after we focused it. During the first instants of an edit (before any key), put focus and caret straight back.
  N.addEventListener('selectionchange', () => {
    const s = editing ? win.getSelection() : null;
    if (editing && s && s.rangeCount && s.anchorNode && editing.contains(s.anchorNode)) {
      lastRange = s.getRangeAt(0).cloneRange();
      if (!s.isCollapsed) lastSelected = lastRange;
    }
  }, true);
  N.addEventListener('focusout', (e) => {
    const el = editing;
    if (!el || e.target !== el || (e as FocusEvent).relatedTarget || keyedSinceEdit || Date.now() - editStartedAt > 1500) return;
    N.setTimeout(() => {
      if (editing !== el || doc.activeElement === el) return;
      el.focus({ preventScroll: true });
      const s = win.getSelection();
      if (s && lastRange) { s.removeAllRanges(); s.addRange(lastRange); }
    }, 0);
  }, true);
  N.addEventListener('paste', (e) => {
    // Pasting is handled as plain text only; the editor sanitizes anything richer (TXT-09/11)
    if (!editing) return;
    e.preventDefault();
    const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    const sel = win.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(doc.createTextNode(text.slice(0, 100000)));
      r.collapse(false);
      editDirty = true;
    }
  }, true);
  N.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);

  // --- command channel ---------------------------------------------------------------------------------
  const safeStyle = (s: string): boolean => s.length < 20000 && !/[<>]/.test(s);

  const handle = (m: any): void => {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'rects': {
        const ids: unknown = m.ids;
        if (!Array.isArray(ids) || ids.length > 500) return;
        send({ t: 'rects', req: m.req, rects: ids.map((i) => (Number.isInteger(i) ? rectOf(i) : null)) });
        break;
      }
      case 'hit': send({ t: 'hit', req: m.req, ids: hit(Number(m.x), Number(m.y)) }); break;
      case 'children': {
        const el = byId(Number(m.id));
        send({ t: 'children', req: m.req, ids: el ? (N.from(el.children) as Element[]).map(idOf).filter((x): x is number => x !== null) : [] });
        break;
      }
      case 'style': {
        const el = byId(Number(m.id));
        if (el && typeof m.style === 'string' && safeStyle(m.style)) {
          if (m.style === '') N.removeAttribute.call(el, 'style'); else N.setAttribute.call(el, 'style', m.style);
        }
        break;
      }
      case 'html': {
        const el = byId(Number(m.id));
        if (el && typeof m.html === 'string' && m.html.length < MAX_HTML && el !== editing) {
          const tpl = doc.createElement('template');
          tpl.innerHTML = m.html; // html is produced by the editor's own sanitizer
          el.replaceChildren(tpl.content);
        }
        break;
      }
      case 'slides': {
        if (Array.isArray(m.ids) && m.ids.length < 5000) { slideIds = m.ids.filter(Number.isInteger); stateToken = null; groupAnc = null; }
        break;
      }
      case 'frames-start': {
        if (!FRAMES) break;
        virtual = true; vq = []; vnow = 0; vframe = 0;
        const el = Number.isInteger(m.trigger) ? byId(m.trigger) : null;
        if (el) { passDeck = true; try { (el as HTMLElement).click(); } catch { /* the deck's handler failed */ } passDeck = false; }
        send(frameState());
        break;
      }
      case 'frames-goto': {
        if (!FRAMES || !virtual) break;
        const to = Math.max(0, Math.min(100000, Number(m.n)));
        if (to < vframe) { send({ ...(frameState() as object), reset: true }); break; }
        while (vframe < to && fireNext()) { /* advance */ }
        send(frameState());
        break;
      }
      case 'texts': {
        const root = slideIds.map(byId)[Number(m.index)] ?? doc.body;
        const out: { text: string; gen: boolean }[] = [];
        const seen = new Set<string>();
        const w = doc.createTreeWalker(root, 4);
        for (let n = w.nextNode(); n && out.length < 300; n = w.nextNode()) {
          const text = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
          const par = n.parentElement;
          if (text.length < 2 || text.length > 2000 || !par || seen.has(text) || ['SCRIPT', 'STYLE'].includes(par.tagName)) continue;
          seen.add(text);
          out.push({ text, gen: N.getAttribute.call(par, ID) === null });
        }
        send({ t: 'texts', req: m.req, items: out });
        break;
      }
      case 'show': showSlide(Number(m.index)); send({ t: 'shown', index: m.index }); break;
      case 'step': previewStep(Number(m.index), m.n === null ? null : Number(m.n)); break;
      case 'edit': startEdit(Number(m.id), String(m.text ?? ''), m.at && typeof m.at === 'object' ? { x: Number(m.at.x), y: Number(m.at.y), mode: String(m.at.mode) } : undefined, Array.isArray(m.tags) ? m.tags.slice(0, 5000) : undefined); break;
      case 'edit-end': stopEdit(m.commit !== false); break;
      case 'refocus': {
        // The editor moved focus to this frame; put the caret/selection back inside the edited element.
        if (editing) {
          editing.focus({ preventScroll: true });
          const sel = win.getSelection();
          // One-shot: a double-click starts the edit twice (mouse-up, then dblclick), so a second refocus must not
          // overwrite what the user has already selected or typed since.
          if (sel && savedRange && !keyedSinceEdit) { sel.removeAllRanges(); sel.addRange(savedRange); savedRange = null; }
          send({ t: 'edit-ready', id: idOf(editing) }); // keyboard focus is now inside the element: safe to type
        }
        break;
      }
      case 'fmt': {
        if (m.cmd === 'bold') wrapSelection('strong');
        else if (m.cmd === 'italic') wrapSelection('em');
        else if (m.cmd === 'underline') wrapSelection('u');
        else if (m.cmd === 'color' && typeof m.value === 'string') wrapSelection('span', ['color', m.value]);
        else if (m.cmd === 'link' && typeof m.value === 'string' && /^(https?:|mailto:|#)/i.test(m.value.trim())) wrapSelection('a', undefined, ['href', m.value.trim()]);
        else if (m.cmd === 'size' && typeof m.value === 'string') wrapSelection('span', ['font-size', m.value]);
        break;
      }
      case 'viewport': send({ t: 'viewport', w: win.innerWidth, h: win.innerHeight, sw: doc.documentElement.scrollWidth, sh: doc.documentElement.scrollHeight }); break;
      case 'ping': send({ t: 'pong' }); break;
    }
  };

  // Handshake: the editor posts one init message carrying the port. We claim it in the capture phase
  // before deck listeners run, and hide it from them.
  N.addEventListener('message', (e) => {
    const ev = e as MessageEvent;
    if (port || ev.source !== win.parent) return;
    const d = ev.data;
    if (!d || d.t !== 'deckhand:init' || d.token !== TOKEN || !ev.ports[0]) return;
    ev.stopImmediatePropagation();
    port = ev.ports[0];
    port.onmessage = (me) => handle(me.data);
    // decks that size their stage from innerWidth/innerHeight when their script first runs can be left at scale(0) if the frame had no size yet; one resize makes them fit again
    requestAnimationFrame(() => { if (win.innerWidth > 0) win.dispatchEvent(new Event('resize')); });
    send({ t: 'ready', title: doc.title.slice(0, 200), url: String(location.pathname).slice(0, 500) });
  }, true);

  // Heartbeat (REL-02)
  N.setInterval(() => send({ t: 'hb' }), 1000);
  // Layout change notifications
  let pending = false;
  const notify = (): void => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; send({ t: 'changed' }); }); };
  N.addEventListener('resize', notify);
  N.addEventListener('load', notify);
  if (document.fonts) document.fonts.ready.then(notify);
  new MutationObserver(notify).observe(doc.documentElement, { attributes: true, childList: true, subtree: true });

  // Hide this script element and token from deck code
  if (me) me.remove();
})();
