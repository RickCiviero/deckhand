# Deckhand — Visual Editor for HTML Presentations

**Product & technical specification · v1.1 (draft for implementation)**
30 October 2026 · Working title: *Deckhand* (rename freely) · Implementer: Claude Code · v1.1 adds the AI Assistant (§10)

> **In one sentence:** Deckhand lets anyone open an HTML presentation, edit it the way they would in PowerPoint — click, drag, type — and save it back as the same HTML file, changed only where they changed it, on **Windows, macOS and Linux**.

> **For the owner — how to use this file:** create an empty folder (ideally a Git repository), save this file in it as `docs/SPEC.md`, start Claude Code in that folder and say: *"Read docs/SPEC.md and follow section 0."* Answer its questions (section 16) and give it a few of your real HTML decks if you can.

---

## Contents

0. Instructions for Claude Code
1. Product overview
2. Inspiration
3. Glossary
4. Platforms, installation and distribution
5. Supported decks
6. Architecture and core technical requirements
7. User interface (Office-inspired)
8. Editing features
9. Files, saving, slide show and export
10. AI Assistant
11. Options and Trust Center
12. Help and onboarding
13. Testing and quality
14. Later (P2) ideas
15. Milestones
16. Open questions and default assumptions
- Appendix A — Editor metadata stored in files
- Appendix B — Generic slide detection
- Appendix C — References

---

## 0. Instructions for Claude Code

1. Keep this file at `docs/SPEC.md` and read it fully before writing any code.
2. Write `docs/IMPLEMENTATION_PLAN.md`: break the milestones (§15) into tasks and list risks and questions. Ask the owner the open questions in §16 before Milestone 1. For any other ambiguity, choose what best fits the design principles (§1.6) and record it in `docs/DECISIONS.md` (one short ADR per decision).
3. Create and maintain `CLAUDE.md` with build/test/package commands, an architecture summary and conventions.
4. Run the technical spikes (§6.12) first — they validate the riskiest assumptions.
5. Work milestone by milestone. After each milestone the app must build, launch and pass its tests on Windows, macOS **and** Linux (CI).
6. **MUST / SHOULD / MAY** follow RFC 2119. Priorities: **P0** = needed for the first usable release (MVP), **P1** = needed for v1.0, **P2** = later.
7. Every requirement has an ID (e.g. `POS-04`). Reference IDs in commits, tests and PR descriptions.
8. When requirements conflict: **security → file fidelity → Office familiarity → feature breadth**. Record trade-offs in `DECISIONS.md`.

---

## 1. Product overview

### 1.1 Problem
More and more presentations are delivered as `.html` files: AI assistants (Claude, ChatGPT, Gemini…) generate them, and frameworks such as reveal.js or Marp export them. Small changes — a typo, a misplaced logo, a wrong color, an outdated picture — currently mean editing code or regenerating the whole deck. Most people can't do that, and shouldn't have to.

### 1.2 Vision
"PowerPoint for HTML decks." Open any HTML presentation, click, drag, type, save. The result is still a normal HTML file that works exactly as before, plus the intended changes — nothing else.

### 1.3 Goals

| ID | Goal |
|---|---|
| G1 | Anyone who has used PowerPoint can make common edits within minutes, without training or HTML knowledge. |
| G2 | Non-destructive: saving changes only what the user changed; the deck keeps working in any browser. |
| G3 | Works with as many HTML decks as possible, including unknown custom formats produced by AI. |
| G4 | **Installs and behaves the same on Windows, macOS and Linux.** |
| G5 | Safe: opening an untrusted HTML file can't harm the computer or leak the user's files. |
| G6 | Users can change a deck by chatting with an AI model, through an AI account they already have (§10). |

### 1.4 Non-goals for v1
- Real-time co-editing, user accounts, or any cloud service or server run by Deckhand — it is a local desktop app. (The AI Assistant talks directly to the user's own AI provider, §10.)
- Editable conversion to or from `.pptx`.
- General website building (multi-page sites, responsive breakpoint authoring).
- Visual editing of content drawn at runtime by JavaScript (e.g., Chart.js canvases, compiled single-page-app decks) beyond §5.
- Generating a whole new deck from a prompt (P2, AIQ-03).

### 1.5 Users
- **Primary — the Office user.** Comfortable with PowerPoint, knows no HTML. Receives decks from AI tools or colleagues.
- **Secondary — the power user.** Knows HTML/CSS; wants quick visual tweaks plus direct access to the code.
- Decks travel by email, shared drives and Git; several colleagues may edit the same deck at different times.

### 1.6 Design principles
1. **Familiar first.** When in doubt, do what PowerPoint does — layout, command names, icons, shortcuts, behaviors.
2. **Respect the file.** Never rewrite what the user didn't touch.
3. **Progressive disclosure.** Simple controls first; HTML/CSS detail is available but out of the way (Advanced sections, Code view).
4. **Honest limits.** If something can't be edited visually, say why and offer the next best way. Never fail silently.
5. **Safe by default.** A deck is untrusted code.
6. **Offline-first.** Everything works without internet, except remote resources the deck itself references and the AI Assistant (unless it uses a local model).

---

## 2. Inspiration

Functionality comes from existing visual HTML editors; the user experience comes from Microsoft Office, mainly PowerPoint.

### 2.1 Functionality — what existing HTML editors do well

| Product | What it is | What Deckhand borrows |
|---|---|---|
| **Decktly** | Free, proprietary visual editor for existing HTML presentations (web, Windows, Mac): edit on the page and save back to HTML; move/resize/align, charts, tables, shapes, images, slide masters, comments stored in the HTML, presentation mode. | The open → edit → save loop on real HTML files; "slide masters" (→ layouts derived from the deck, ADP-07); comments in the file (P2). Deckhand differs by being Office-like, fidelity-first and available on Linux too. |
| **HTML Deck** (MIT) | Browser-based editor for HTML decks, reports and pages written by people or AI agents. Patches the file only where something changed, so saving without edits is byte-identical. Lets users pin notes on elements for an AI coding agent to apply. | Patch-based saving and the byte-identical guarantee (§6.3); "agent notes" for AI-assisted changes (P2, §14). |
| **slides-grab** (MIT) | Editor for AI-generated HTML slides where each slide is its own HTML file; select a region with a bounding box, edit text directly; PDF export. | Region (marquee) selection; folder-of-slides decks (P2); export flows. |
| **B6+ slide editor** (W3C) | Electron app for HTML slides: WYSIWYG + HTML source toggle, slide management, thumbnails, play mode, slides isolated in an iframe, opening from the command line. | Iframe isolation, visual/source toggle, thumbnails, CLI opening. |
| **GrapesJS** (BSD-3) | Open-source web-builder framework with Blocks, Style Manager, Layer Manager, Code Viewer and Asset Manager. | Grouped style properties (→ Format pane), layer tree (→ Selection Pane), asset handling (→ Pictures), blocks (→ Insert galleries). |
| **Onlook** (open source) | Visual editor for React apps that writes visual changes back into the source code, linking elements to code through an ID attribute. | Element ↔ source mapping through IDs (never persisted here, ARCH-03); two-way visual/code sync (CODE-02). |
| **Pinegrow, Dreamweaver** | Desktop HTML editors that edit real files. | Design / Code / Split views; clickable tag-path breadcrumb in the status bar. |
| **Webflow, Figma** | Visual design tools. | Hover outlines with labels, Esc selects the parent, layers panel, insertion line when reordering inside a layout. |
| **Chrome DevTools** | Browser inspector. | Element picking, box overlay, CSS rules view (P2), eyedropper. |

### 2.2 User experience — what to copy from Microsoft Office
- **Ribbon** with tabs and groups; **contextual tabs** that appear with the selection (e.g., *Picture Format*); collapsible.
- **Backstage** behind the File tab (Home, Open, Recent, Info, Save As, Export, Options).
- **Quick Access Toolbar** in the title bar (Save, Undo with history list, Redo, Start Slide Show).
- PowerPoint's **Normal view**: slide thumbnails left, slide canvas center, Notes below, **Format pane** right, **status bar** with slide counter, view buttons and zoom slider.
- **Mini toolbar** on text selection and right-click; context menus with **Paste Options**.
- **Live Preview**: hovering over a font, color or style previews it on the slide.
- **Smart guides**, **Format Painter**, **Selection Pane**, Align/Distribute, Group, Bring to Front.
- **Message bars** — the yellow strip under the ribbon — for security notices and file status (like Protected View).
- **AutoRecover / Document Recovery**, Version History, "Do you want to save changes?".
- Office **keyboard shortcuts**, enhanced tooltips (name + shortcut + description), the **Search** box (Alt+Q), KeyTips, an **Options** dialog with a **Trust Center**.
- Fluent design language; light and dark themes.

### 2.3 AI assistant — what to borrow (§10)

| Product | What Deckhand borrows |
|---|---|
| **Copilot in PowerPoint and Word** | The assistant as a task pane on the right, opened from the end of the Home tab; prompt suggestions and a prompt library; results the user keeps or discards |
| **Claude, ChatGPT and Gemini apps** | Composer with a + menu for attachments, model picker, conversation history, regenerate, edit a sent message, streamed answers |
| **GitHub Copilot in VS Code, Cursor** | Ask vs Edit (agent) modes; @-mentions for context; changes applied live with Keep/Undo; checkpoints to restore an earlier state |
| **Zed** | Running AI providers' own agents through ACP, so people can use subscriptions they already have; forwarding MCP tools to those agents |
| **HTML Deck** | Notes pinned on elements for an AI agent to apply (P2, §14) |

---

## 3. Glossary

| Term | Meaning |
|---|---|
| Deck | An HTML document containing a presentation. |
| Slide | The element (or element group) that represents one slide, as identified by an adapter. |
| Object | A selectable visual item on a slide (text, picture, shape, table, group…). Always maps to exactly one source element. |
| Source text | The file's exact original content. |
| Source model | The source text parsed with exact offsets for every node and attribute — the single source of truth while editing. |
| Live view | The deck rendered inside the canvas. Disposable; never saved. |
| Bridge script | Editor script injected only into the live view: reports geometry, applies live changes, hosts text editing. Never saved. (Not to be confused with AI agents, §10.) |
| Adapter | A module that understands one deck format (generic, reveal.js, Marp…). |
| Design viewport | The virtual screen size (e.g., 1920×1080) at which the deck is rendered for editing, then scaled to fit. |
| Editor ID | Temporary ID of a source element (`data-deckhand-id`), present only in the live view. |
| Patch | A text replacement on the source text (offset, length, new text). |
| Command | A user action (e.g., "Move object") that produces patches plus a live-view update; undoable. |
| Free / In layout | Positioning categories of an object: absolutely positioned vs. part of the normal page flow (§8.2). |
| Deck chrome | The deck's own controls: navigation buttons, progress bars, slide counters. |
| AI Assistant | The optional chat pane on the right (§10). |
| Connection | A configured way to reach AI models: an API key, an account sign-in or an external agent. |
| External agent | An AI agent program from a provider (e.g. Codex, Claude Agent) that Deckhand runs and talks to through ACP. |
| Deck tools | The operations the AI can call to read and change the deck (§10.6). |
| AI view | The HTML projection the model sees: object references, asset placeholders, elided libraries (AIX-03). |
| ACP | Agent Client Protocol: an open JSON-RPC protocol between an application and an AI agent. |
| MCP | Model Context Protocol: an open protocol through which AI apps call tools offered by other programs. |

---

## 4. Platforms, installation and distribution

**PLT-01 (P0) — Supported operating systems.** The app MUST install and run on:
- **Windows** 10 (22H2) and 11 — x64 (P0), arm64 (P1).
- **macOS** — every version supported by the chosen Electron release (expected: macOS 12 or later), on Apple Silicon and Intel.
- **Linux** — x64 (P0), arm64 (P1); tested on Ubuntu 22.04/24.04 LTS, Debian 12 and current Fedora, under X11 and Wayland.

**PLT-02 (P0) — Packages.**

| OS | Formats | Notes |
|---|---|---|
| Windows | `.exe` installer (NSIS) — P0 · `.msi` — P1 (IT deployment) · portable `.zip` — P1 | Per-user install by default (no admin rights), Start-menu entry, clean uninstaller. |
| macOS | `.dmg` — P0 · `.zip` — P0 (needed for auto-update) | Universal binary, or separate arm64 and x64 builds. |
| Linux | `.AppImage` — P0 · `.deb` — P0 · `.rpm` — P1 · Flatpak — P2 | `.desktop` entry and icons in all sizes; README documents AppImage's FUSE requirement. |

**PLT-03 (P0)** No extra runtime to install (no separate Node, Java, Python or .NET). Installation works offline.

**PLT-04 (P0)** `npm run dist` builds the packages for the current OS. CI (GitHub Actions or equivalent) builds, tests and packages on Windows, macOS and Linux runners and attaches all installers to each tagged release.

**PLT-05 (P1)** Code signing — Windows Authenticode, macOS Developer ID + notarization — configured through CI secrets. Unsigned builds MUST remain possible for internal testing; the README explains the resulting SmartScreen/Gatekeeper warnings and how to open the app anyway.

**PLT-06 (P1)** Auto-update from GitHub Releases or a configurable HTTPS location. Options › Updates: Automatic / Notify only / Off; administrators can disable it with a policy file. `.deb`/`.rpm`: notify only.

**PLT-07 (P0) — Parity and OS conventions.** Same features on every OS, while following local conventions:
- macOS: ⌘ replaces Ctrl; a native menu bar (Deckhand, File, Edit, Insert, Format, Arrange, Slide Show, View, Window, Help) mirrors the ribbon.
- Windows/Linux: custom title bar hosting the Quick Access Toolbar (Linux: user-switchable fallback to the native title bar).
- Native file dialogs, system light/dark theme, crisp HiDPI rendering, per-monitor scaling.

**PLT-08 (P1)** "Open with" integration as an *optional* handler for `.html`/`.htm` (Windows "Open with" list; macOS document type with role *Editor*, rank *Alternate*; Linux `.desktop` MimeType). Deckhand MUST NOT make itself the default `.html` handler. P2: "Edit with Deckhand" in the Explorer/Finder/file-manager context menu.

**PLT-09 (P0)** One window per document (PowerPoint model). Single instance: opening a file while running opens a new window; opening an already-open file focuses its window. CLI: `deckhand <file.html> [--slide N]`.

**PLT-10 (P1)** Uses the system proxy settings (corporate networks).

---

## 5. Supported decks

**FMT-01 — Support matrix.**

| Deck type | Detected by (summary) | Target |
|---|---|---|
| **Generic single-file decks** — typical AI output: sibling `section`/`div.slide` elements, JS navigation or scroll-snap | Heuristics (Appendix B) | **P0 — primary target** |
| reveal.js | `.reveal .slides > section` | P0: horizontal + vertical slides, `aside.notes`, `data-visibility="hidden"`, `data-background-*`. P2: fragments, transitions |
| Marp / Marpit HTML export | `svg[data-marpit-svg] > foreignObject > section` | P1 |
| impress.js | `#impress` with `.step` children | P1 (step position/rotation as properties; no 3D overview editing) |
| Shower, b6+ | `.shower` + `section.slide` | P1 |
| Any HTML page without slides | No slides found | P1: edit as a single page ("Page mode") |
| Folder with one HTML file per slide (e.g., slides-grab) | "Open folder as deck" | P2 |
| Remark (Markdown inside `<textarea>`) | `textarea#source` | P2: edit the Markdown in Code view |
| Compiled single-page-app decks (Slidev, Spectacle, MDX builds) | Slide content absent from the HTML source | Not visually editable: open read-only with a clear explanation; Code view still available |

**FMT-02 (P0)** Detect the encoding (BOM, `<meta charset>`, fallback UTF-8) and preserve encoding, BOM, line endings (LF, CRLF or mixed), indentation and trailing newline.

**FMT-03 (P0)** Resolve relative URLs (images, CSS, JS, fonts, media) against the file's folder; support `data:` URIs and remote `http(s)` resources (subject to SEC-05).

**FMT-04 (P1)** Linked local stylesheets: by default only the HTML file is edited (inline styles and `<style>` blocks). Theme edits (THM-01/03) and "Apply to all similar" (STY-08) MAY change a linked `.css` file, only after an explicit notice ("This also changes theme.css"), with the same fidelity guarantees. Linked JavaScript is never modified.

**FMT-05 (P0)** Malformed HTML opens normally (HTML5 parsing rules); saving never "fixes" untouched markup.

**FMT-06 (P0)** Files up to 50 MB (embedded images) open without crashing; slower performance is acceptable.

---

## 6. Architecture and core technical requirements

### 6.1 Overview

```
┌──────────────────────── Electron main process ─────────────────────────┐
│ files & watchers · AutoRecover · versions · document protocol          │
│ export windows (PDF/PNG) · menus · updates · logs · AI host            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ typed, validated IPC (contextBridge)
┌───────────────────────────────────┴────────────────────────────────────┐
│ EDITOR WINDOW (renderer, React)                                        │
│ Ribbon · Slides · Canvas · Format pane · Selection · AI pane · Code    │
│           │ user actions → commands                                    │
│ ┌─────────▼──── packages/core (framework-agnostic TypeScript) ───────┐ │
│ │ source model (parse5 + offsets) · patch engine · undo history      │ │
│ │ adapters · CSS utilities · serializer · commands                   │ │
│ └─────────┬──────────────────────────────────────────────────────────┘ │
│           │ live-view operations (postMessage, schema-validated)       │
│ ┌─────────▼──────────────────────────┐  ┌────────────────────────────┐ │
│ │ LIVE VIEW: sandboxed iframe        │  │ OVERLAY (editor UI layer)  │ │
│ │ own origin + own process           │  │ selection & handles        │ │
│ │ deck HTML · CSS · scripts          │  │ smart guides · rulers      │ │
│ │ + bridge script (never saved)      │  │ drop indicators            │ │
│ └────────────────────────────────────┘  └────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Source model and commands
- **ARCH-01 (P0)** The **source model** — the source text parsed with exact offsets for every node, tag and attribute (parse5 with location info, or equivalent) — is the single source of truth. The live view is a disposable projection. The live DOM MUST NEVER be serialized to disk: deck scripts mutate it (runtime classes, injected `<style>` tags, generated elements).
- **ARCH-02 (P0)** Every edit is a **command** producing (a) patches on the source text and (b) the equivalent live-view operation. Commands are invertible (undo) and can be grouped into transactions (a multi-object edit is one undo step).
- **ARCH-03 (P0)** **Editor IDs:** every source element gets an ID at parse time. The HTML served to the live view carries it as `data-deckhand-id`; saved HTML never does. An ID stays stable for the node's lifetime across edits, so selection, undo and the live view stay in sync.
- **ARCH-04 (P0)** Live-view elements without an editor ID were created by scripts (**generated content**). They can be shown and measured but are never written to disk, and Deckhand never edits their contents.
- **ARCH-05 (P0)** `packages/core` has no dependency on React, Electron or a browser DOM and runs under Node for tests. Anything that needs a real layout engine lives in the bridge script.
- **ARCH-06 (P0)** CSS inside `style` attributes and `<style>` blocks is edited with a position-preserving parser (e.g., postcss): untouched declarations, comments and formatting stay as they are.

### 6.3 Round-trip fidelity (all P0 — the most important quality attribute)
- **RT-01** Open → Save with no edits produces a **byte-identical** file.
- **RT-02** Edits produce **minimal diffs.** Editing a word changes only that text; moving an object changes only that element's `style` attribute (adding one if missing). Everything else stays byte-identical: indentation, comments, attribute order and quoting, entities (`&nbsp;` stays `&nbsp;`), `<script>` and `<style>` contents, SVG, custom elements, unknown attributes.
- **RT-03** Inline-style edits touch only the declarations that changed; the others keep their order and formatting.
- **RT-04** New markup (objects, slides) matches the surrounding indentation, quote style and line endings.
- **RT-05** Editor artifacts NEVER reach the saved file: editor IDs, the bridge script, AI-view references and asset placeholders (AIX-03), editor stylesheets, `contenteditable`, `spellcheck`, selection/hover classes, temporary visibility or animation overrides. A check runs on every save in tests and as an assertion in development builds.
- **RT-06** Persistent editor metadata (object names, locks, manual slide definition, guides) is written only when the user uses those features, as namespaced `data-deckhand-*` attributes or `<meta name="deckhand:*">` (Appendix A). P1 option: keep it in a sidecar file `<deck>.deckhand.json` instead.
- **RT-07** Saving is atomic (write a temp file, flush, rename; keep permissions). On network drives and synced folders (OneDrive, Dropbox, Google Drive) where rename can fail, fall back to a safe in-place write after making a backup.
- **RT-08** Golden-diff tests (TST-02) prove RT-01 … RT-05 on every deck in the test corpus.

### 6.4 Live view and bridge script
- **RND-01 (P0)** The live view is an `<iframe>` served from a privileged custom protocol (e.g., `deckhand-doc://<random-token>/…`) so each open document has **its own origin, distinct from the editor UI's origin**. With scripts on it uses `sandbox="allow-scripts allow-same-origin"` (safe only because the origins differ); with scripts off, `sandbox=""`. No top-navigation, popups, downloads, form submission or device permissions.
- **RND-02 (P0)** The protocol handler serves (a) HTML generated from the source model plus editor IDs, with the bridge `<script>` as the first child of `<head>`, and (b) files from the document's folder (SEC-03), with correct MIME types, CORS headers where needed (fonts) and range requests (video).
- **RND-03 (P0)** The **bridge script** (`packages/bridge`, bundled as one script) MUST:
  - capture references to the native DOM APIs it uses before any deck script runs;
  - report element geometry — border box, full transform matrix to the viewport, containing-block box, relevant computed styles — on request and on change (ResizeObserver, MutationObserver, `document.fonts.ready`, image loads);
  - hit-test points (`elementsFromPoint`) and return candidate objects (editor IDs) following the SEL rules;
  - apply live operations instantly (style, attribute, text, insert/remove node);
  - host text-editing sessions (§8.3);
  - suppress the deck's keyboard, mouse and wheel handlers in design mode (capture-phase listeners) so clicks and typing never trigger deck navigation, and restore them in Slide Show;
  - navigate slides in design mode through the adapter (ADP-05);
  - send a heartbeat every second (REL-02);
  - treat duplicate editor IDs (nodes cloned by scripts) as generated content;
  - provide in-memory fallbacks if deck scripts fail on storage APIs.
- **RND-04 (P0)** Per-document **Run deck scripts while editing**: On (default) / Off — View tab and Trust Center (SEC-06). Many decks need scripts just to render (e.g., the Tailwind Play CDN generates CSS at runtime; JS decides which slide is visible). Off gives a static view for decks whose scripts get in the way.
- **RND-05 (P0)** **Design viewport.** The iframe is rendered at a virtual size — the deck's native slide size when fixed (e.g., 1280×720, 1920×1080), otherwise 1920×1080 — and scaled to fit the canvas. View › Viewport presets (1920×1080, 1366×768, 1280×800, 1024×768, custom) let users check responsive decks. Preview only; never saved.
- **RND-06 (P0)** The canvas shows one slide at a time, like PowerPoint's Normal view.
- **RND-07 (P0)** Animations: design mode shows objects in their **final state** (CSS animations/transitions forced to their end by the editor stylesheet; script-driven entrance effects neutralized where detectable). View › Play animations turns this off. Objects invisible in the current state (opacity 0, `visibility: hidden`) are listed in the Selection Pane and can be revealed temporarily (Show hidden objects).
- **RND-08 (P0)** Style, text and attribute changes update the live view incrementally through the bridge script. Structural changes may reload the live view; a reload preserves the current slide, selection, zoom and scroll, and SHOULD finish in < 500 ms without flicker (render into a second hidden iframe, then swap).
- **RND-09 (P0)** Thumbnails come from a hidden offscreen window (same protocol and sandbox): one cached bitmap per slide, refreshed ≤ 1 s after the slide's last edit; visible thumbnails first.
- **RND-10 (P0)** **Deck chrome** found by the adapter (navigation buttons, progress bars, slide counters, "press → to continue" hints) is hidden in design mode by default (View › Show deck controls) and never removed from the file.
- **RND-11 (P1)** Fonts the deck uses but can't load (not installed, offline) are listed in File › Info.
- **RND-12 (P0)** Input routing: in design mode the editor overlay captures pointer input and resolves targets through bridge hit-testing; during text editing, input inside the edited element goes to the live view. Editor shortcuts (save, undo, slide show…) work wherever focus is (forwarded by the bridge script or handled as application accelerators).

### 6.5 Deck adapters and slide detection
- **ADP-01 (P0)** Adapter interface (sketch):

```ts
interface DeckAdapter {
  id: string;                    // 'generic' | 'revealjs' | 'marp' | 'impress' | 'shower' | 'page' …
  label: string;                 // shown in File › Info
  detect(doc: SourceDoc, live?: LiveProbe): Promise<{ confidence: number }>; // 0..1
  listSlides(doc: SourceDoc): SlideRef[];                  // ordered; may nest (vertical stacks)
  slideSize(doc: SourceDoc, live: LiveProbe): Size | 'viewport';
  showSlide(live: LiveHandle, slide: SlideRef): Promise<void>;  // design-mode navigation only
  deckChrome?(doc: SourceDoc): ElementRef[];               // hidden while editing (RND-10)
  createSlide(doc: SourceDoc, at: number, layout?: SlideRef): Patch[];
  capabilities: {
    notes: boolean; hiddenSlides: boolean; verticalStacks: boolean;
    fragments: boolean; transitions: boolean;
    deepLink?(slide: SlideRef): string;                     // e.g. '#/3' for reveal.js
  };
  notes?:  { read(s: SlideRef): string;  write(s: SlideRef, text: string): Patch[] };
  hidden?: { get(s: SlideRef): boolean;  set(s: SlideRef, hidden: boolean): Patch[] };
}
```

- **ADP-02 (P0)** On open, every adapter scores the document; the best score above a threshold wins. On a file's first open Deckhand shows "Found 12 slides. [Looks right] [Define slides…]". Low confidence or a tie opens the **Define Slides** wizard. File › Info shows the detected format and lets the user change it.
- **ADP-03 (P0)** The **generic adapter** (Appendix B) is the most important one: most AI-generated decks follow no framework.
- **ADP-04 (P0)** **Define Slides wizard:** the user clicks one slide in a preview; Deckhand proposes a CSS selector matching it and its siblings, outlines every match and shows the count; the user can widen/narrow (parent/child) or edit the selector. The result is saved in the file (Appendix A) so the next open is automatic.
- **ADP-05 (P0)** Showing slide N in design mode uses, in order: the framework's API (e.g., `Reveal.slide(h, v)`); the deck's own active-state mechanism detected per Appendix B.3 (applied in the live DOM only); or an editor stylesheet that shows only that slide.
- **ADP-06 (P0)** Slide operations respect each format's structure: reveal.js vertical stacks; Marp's whole `svg[data-marpit-svg]` wrapper is the slide unit; impress.js `data-*` positions.
- **ADP-07 (P0)** **Layouts from the deck.** New Slide offers a gallery of layouts derived from the deck itself: slides clustered by structural skeleton (tags + classes), named heuristically ("Title", "Two columns", "Picture + text"…), previewed as thumbnails. Creating from a layout clones that slide's markup, replacing text with placeholders ("Click to add title") and pictures with a placeholder graphic. "Blank" = an empty slide container with the deck's slide classes. "Duplicate Slide" copies exactly.
- **ADP-08 (P1)** Static slide numbers inside slide content (e.g., "3 / 12"): detect the pattern and offer "Update slide numbers" after slides are added, deleted or reordered.

### 6.6 Geometry
- **GEO-01 (P0)** Screen ↔ design viewport ↔ element containing-block conversions use the full transform matrices reported by the bridge script, accounting for canvas zoom, decks that scale a fixed stage to the window (CSS `transform` or `zoom`) and nested transforms. Dragging must track the pointer exactly at any zoom.
- **GEO-02 (P0)** Rotated or transformed objects get oriented handles; resizing follows the object's own axes.
- **GEO-03 (P0)** Overlays stay in sync (≤ 1 frame lag) while dragging, scrolling, zooming and resizing the window, and after asynchronous layout changes (fonts, images).

### 6.7 Security (all P0 unless noted)
- **SEC-01** Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; a minimal typed preload API via `contextBridge`; schema-validated IPC; Electron's security checklist followed; Electron fuses set (e.g., disable RunAsNode, enable ASAR integrity where supported).
- **SEC-02** Deck content runs only in sandboxed frames/windows whose origin differs from the editor UI; it can't reach the editor DOM, IPC, Node or the file system.
- **SEC-03** The document protocol serves only files inside the document's folder and its subfolders. Anything else (`../`, absolute `file://` paths) is blocked unless the user allows it for that document via a message bar ("This presentation uses files outside its folder. [Allow] [Keep blocked]"); the choice can be remembered per file.
- **SEC-04** Deck content can't navigate the top window, open windows, download files or request permissions (camera, microphone, location, notifications, clipboard read). In design mode links never navigate. In Slide Show, external links open in the default browser after confirmation.
- **SEC-05** Remote resources (fonts, images, CDN scripts/styles): Allow (default) / Ask / Block, set in the Trust Center. When blocked, a message bar offers "Load external content". File › Info lists every external domain the deck uses.
- **SEC-06** Deck scripts: On (default, always sandboxed) / Off. P1 — **Protected View** for files downloaded from the internet (Windows Mark-of-the-Web, macOS quarantine attribute): open with scripts and remote content off and a yellow bar "This file came from the internet. [Enable content]". P2 — Trusted Locations.
- **SEC-07** The editor UI loads no remote code; strict Content-Security-Policy; no `eval`.
- **SEC-08** Messages from the bridge script are untrusted (deck scripts share its context): schema validation and size limits; they never trigger code execution, file access or IPC beyond the documented operations.
- **SEC-09** Pasted HTML is sanitized (TXT-11). Custom HTML the user inserts deliberately (INS-05) is exempt.
- **SEC-10** Privacy: no telemetry. P2: opt-in crash reports. Deckhand's own network traffic is limited to update checks (if enabled); everything else is requested by the deck itself or by AI Assistant features the user set up (§10).
- **SEC-11 (P1)** AI-specific security and privacy requirements are in §10.10.

### 6.8 Performance
Reference machine: 4-core laptop from 2021, 8 GB RAM, SSD.

| ID | Metric | Target |
|---|---|---|
| PERF-01 | Open a 30-slide, 2 MB deck → first slide editable | < 2 s |
| PERF-02 | All 30 thumbnails rendered | < 5 s |
| PERF-03 | Drag / resize / smart guides | 60 fps |
| PERF-04 | Typing latency while editing text | < 50 ms |
| PERF-05 | Save a 10 MB deck | < 500 ms |
| PERF-06 | Memory with a 100-slide, 20 MB deck | < 1 GB total |
| PERF-07 | Cold start to Backstage | < 3 s |

### 6.9 Reliability
- **REL-01 (P0)** A crashing or hung deck never freezes or crashes the editor UI: the live view runs in a separate process (see SPIKE-1).
- **REL-02 (P0)** If the bridge script's heartbeat stops for 5 s: message bar "The presentation's scripts aren't responding. [Reload] [Reload with scripts off]".
- **REL-03 (P0)** UI errors are caught by error boundaries, shown as non-blocking notices, and trigger an immediate AutoRecover snapshot.
- **REL-04 (P1)** Rotating log files in the OS app-data folder; Help › Open Log Folder and Copy Diagnostic Info.

### 6.10 Recommended stack
Claude Code MAY propose alternatives, justified in `DECISIONS.md`.

| Concern | Recommendation | Reason |
|---|---|---|
| Desktop shell | **Electron** (latest stable) | Bundles the same Chromium on every OS, so a deck renders identically for every colleague and matches Chrome, where most decks are created and checked; mature `printToPDF`, `capturePage`, spell-checker and packaging. Tauri renders with each OS's own web engine (WebView2 on Windows, WebKit on macOS/Linux), so the same deck can look different per OS, and its bundled-Chromium (CEF) runtime is still alpha. The larger download (roughly 100 MB+) is accepted. |
| Language | TypeScript, `strict` | |
| UI | React + **Fluent UI React v9** + Fluent UI System Icons | Microsoft's own open-source design system: authentic Office look, accessible components. The ribbon is a custom component built from Fluent primitives (TabList, Toolbar, Button, SplitButton, Menu, Popover, Tooltip). |
| Build | Vite (e.g., electron-vite) | |
| Packaging | electron-builder (or Electron Forge) | NSIS, MSI, DMG, AppImage, deb, rpm, auto-update |
| HTML parsing | parse5 with source locations | Spec-compliant, exact offsets |
| CSS parsing | postcss (or css-tree) | Keeps positions and formatting |
| UI state | Zustand (or Redux Toolkit) | |
| Code editor | CodeMirror 6 | Lightweight, handles large files |
| Message/IPC schemas | zod | |
| i18n | i18next with ICU messages | |
| Tests | Vitest; Playwright for Electron | |
| PDF assembly | pdf-lib (image-based PDFs) | |
| PPTX export (P2) | PptxGenJS | |
| Icon set for Insert › Icons | Lucide (ISC) or Fluent icons, bundled offline | |
| AI providers | Vercel AI SDK (`ai` + `@ai-sdk/*` provider packages) | One API for streaming and tool calling across Anthropic, OpenAI, Google, Azure, Bedrock, Vertex and OpenAI-compatible endpoints (§10.11) |
| AI agents and tools | `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk`, GitHub Copilot SDK | External agents, MCP server mode, Copilot connection |
| Credentials | Electron `safeStorage` | OS keychain on every platform (AIC-08) |

- **TECH-01 (P0)** Avoid native Node modules; any unavoidable one must ship prebuilt binaries for every target.
- **TECH-02 (P0)** Only permissive licenses (MIT, BSD, Apache-2.0, ISC; OFL for fonts). Generate a third-party notices file shown in About.
- **TECH-03 (P0)** Use the latest stable versions at implementation time; lock dependencies.

### 6.11 Repository layout

```
deckhand/
├── apps/desktop/        Electron main + preload, packaging config, icons
│   ├── src/main/        windows, menus, IPC, document protocol, files, export, updates,
│   │                    ai/ (connections, credentials, AI host, ACP client, MCP server)
│   └── src/preload/     typed contextBridge API
├── packages/core/       source model, patches, commands, history, adapters, CSS utilities
├── packages/bridge/     script injected into the live view (single bundle)
├── packages/ai/         AI Assistant runtime: context, AI view, deck tools, agent loop
├── packages/ui/         React editor UI: ribbon, panes, canvas overlay, dialogs
├── packages/i18n/       translation files (en.json, …)
├── test-decks/          test corpus (TST-01)
├── e2e/                 Playwright tests
└── docs/                SPEC.md, IMPLEMENTATION_PLAN.md, DECISIONS.md,
                         USER_GUIDE.md, QA_CHECKLIST.md, AI_EVALS.md
```

### 6.12 Technical spikes (do these first; record results in DECISIONS.md)
- **SPIKE-1 — Process isolation.** Confirm that a cross-origin sandboxed iframe served from the custom protocol runs in its own renderer process in Electron, so a deck running `while (true) {}` doesn't freeze the UI. If that can't be achieved, host the live view in a separate `WebContentsView` and draw the overlay inside it (bridge-owned closed shadow root) or in a transparent view on top.
- **SPIKE-2 — Fidelity.** Prototype offset-based patching; prove RT-01/RT-02 on five corpus decks, including windows-1252 + CRLF.
- **SPIKE-3 — Positioning.** Prototype move/resize on (a) Free objects inside a JS-scaled 1920×1080 stage and (b) flex/grid children in a responsive Tailwind deck using the `translate` property; verify at three viewport sizes.
- **SPIKE-4 — Detection.** Run the Appendix B heuristics on the corpus and the owner's sample decks; target ≥ 90 % correct automatic detection.
- **SPIKE-5 — AI editing** (run at the start of M4, not first). Prototype the agent loop (§10.11) with one provider, a handful of deck tools and three corpus decks — fix spelling, add a slide from an attachment, restyle with a darker theme; confirm minimal diffs and measure tokens and cost per request.

---

## 7. User interface (Office-inspired)

### 7.1 Main window

```
┌────────────────────────────────────────────────────────────────────┐
│ Title bar · Quick Access Toolbar · file name · Search (Alt+Q)      │
├────────────────────────────────────────────────────────────────────┤
│ Ribbon: File · Home · Insert · Design · Slide Show · Review · View │
│         + contextual tabs: Shape Format · Picture Format · Table   │
├────────────────────────────────────────────────────────────────────┤
│ Message bar (only when needed: security, file changed, recovery)   │
├──────────┬──────────────────────────────────────┬──────────────────┤
│ Slide    │                                      │ Task panes:      │
│ pane     │             Slide canvas             │ · Format         │
│ (thumb-  │  (gray workspace, one slide shown)   │ · AI Assistant   │
│ nails)   │                                      │ · Selection      │
│          │                                      │ (tabs)           │
│          ├──────────────────────────────────────┤                  │
│          │ Notes pane (collapsible)             │                  │
├──────────┴──────────────────────────────────────┴──────────────────┤
│ Status bar: Slide 3 of 12 · element path · views · zoom slider     │
└────────────────────────────────────────────────────────────────────┘
```

- **UI-01 (P0)** Panes are resizable and collapsible; the layout is remembered per user.
- **UI-02 (P0)** Minimum supported window size: 1024×640 (the ribbon adapts, RIB-04).
- **UI-03 (P0)** The right dock holds task panes as tabs: Format pane (P0), Selection Pane (P1) and AI Assistant (P1, §10.4).

### 7.2 Title bar and Quick Access Toolbar
- **QAT-01 (P0)** Save, Undo (with history dropdown, UND-03), Redo, Start Slide Show. P2: customizable, optionally shown below the ribbon.
- **QAT-02 (P0)** Document name with save status ("Saved", "Saving…", "Unsaved changes"); macOS also shows the standard edited dot.
- **QAT-03 (P1)** **Search** box (Alt+Q): finds commands (with their shortcuts), settings, recent files and help topics, and runs them.

### 7.3 Ribbon
- **RIB-01 (P0)** Tabs: File, Home, Insert, Design, Slide Show, Review, View. Contextual tabs — Shape Format, Picture Format, Table Design, Table Layout — appear, highlighted, when the selection needs them. An Animations tab appears only for formats that support it (P2).
- **RIB-02 (P0)** Commands that don't apply are **disabled, not hidden**, with a tooltip saying why (e.g., "Hide Slide isn't available for this presentation format").
- **RIB-03 (P0)** Enhanced tooltips: name, shortcut, one-line description.
- **RIB-04 (P1)** Adaptive layout: as the window narrows, groups shrink (large → small → icon-only → collapsed into a dropdown), as in Office.
- **RIB-05 (P1)** Collapse/expand (Ctrl+F1, double-click a tab). P2: single-line "simplified ribbon".
- **RIB-06 (P1)** Galleries (fonts, colors, shapes, styles, layouts) support Live Preview (STY-05).
- **RIB-07 (P2)** KeyTips: pressing Alt shows letters over tabs and commands (Windows/Linux).
- **RIB-08 (P0)** Every ribbon command is also reachable from the macOS menu bar and, once it exists (P1), the Search box.

Tab content (priority per command):

**Home**

| Group | Commands |
|---|---|
| Clipboard | Paste ▾ (Paste, Keep Text Only, Paste Special…), Cut, Copy — P0 · Format Painter — P1 |
| Slides | New Slide ▾ (layout gallery), Duplicate Slide, Delete Slide — P0 · Hide Slide — P1 |
| Font | Font family (Live Preview), Font size, Grow/Shrink Font, Bold, Italic, Underline, Font Color ▾ — P0 · Strikethrough, Superscript/Subscript, Change Case, Highlight ▾, Clear Formatting — P1 |
| Paragraph | Align Left/Center/Right/Justify — P0 · Bullets, Numbering, List level ±, Line Spacing ▾ — P1 |
| Drawing | Arrange ▾ (order, align — P0; distribute, group, rotate, Selection Pane — P1) · Shape Fill, Shape Outline, Shape Effects — P1 |
| Editing | Select ▾ (Select All — P0, Selection Pane — P1) · Find, Replace ▾ (Replace, Replace Fonts) — P1 |
| AI | AI Assistant ▾ — opens the pane; quick actions (AIQ-01) — P1 |

**Insert**

| Group | Commands |
|---|---|
| Slides | New Slide ▾ — P0 |
| Images | Pictures (from file) — P0 · Icons — P1 |
| Illustrations | Shapes ▾, Table ▾ — P1 · Chart — P2 |
| Text | Text Box — P0 · Custom HTML — P1 · Symbol/Emoji — P2 |
| Links | Link (web, email) — P0 · Link to slide — P1 |
| Media | Video, Audio, Web embed — P2 |

**Design**

| Group | Commands |
|---|---|
| Theme | Colors ▾ (theme colors, THM-01) — P0 · Fonts ▾ — P1 · Presets — P2 |
| Customize | Format Background — P0 · Viewport preview — P1 · Slide Size (fixed-size decks) — P2 |
| Presentation | Detected format, Define Slides… — P0 |

**Slide Show**

| Group | Commands |
|---|---|
| Start | From Beginning, From Current Slide, Preview in Browser — P0 · Presenter View — P2 |
| Set Up | Hide Slide, Monitor ▾ — P1 |

**Review**

| Group | Commands |
|---|---|
| Proofing | Spelling, Language — P1 |
| Accessibility | Alt Text — P1 · Check Accessibility — P2 |
| Compare | Compare with file on disk — P2 |
| Comments | P2 (§14) |

**View**

| Group | Commands |
|---|---|
| Presentation Views | Normal — P0 · Slide Sorter, Code, Split — P1 |
| Show | Smart Guides, Hover Outlines — P0 · Ruler, Gridlines, Guides, Notes, Selection Pane, AI Assistant, Show hidden objects, Show deck controls — P1 |
| Zoom | Zoom…, Fit to Window — P0 |
| Preview | Run deck scripts, Play animations — P0 · Viewport ▾ — P1 |
| Window | App theme (System/Light/Dark) — P1 · New Window — P2 |

**Shape Format** (contextual: any selected object except pictures)

| Group | Commands |
|---|---|
| Shape Styles | Fill ▾, Outline ▾, Effects ▾ — P1 · Quick Styles — P2 |
| Arrange | Bring Forward/to Front, Send Backward/to Back, Align ▾ — P0 · Group ▾, Rotate ▾ — P1 |
| Size | Height, Width, Lock aspect ratio — P0 |
| Position | In layout ⇄ Free, Reset Position — P0 · Reorder in layout — P1 |
| HTML | Edit HTML…, Classes…, Attributes… — P1 |

**Picture Format** (contextual)

| Group | Commands |
|---|---|
| Adjust | Change Picture ▾ — P0 · Compress Pictures — P1 · Reset Picture, Corrections, Color — P2 |
| Picture Styles | Border, Rounded corners, Shadow, Opacity — P1 |
| Accessibility | Alt Text — P1 |
| Arrange / Size | As in Shape Format — P0 · Crop ▾ — P1 |

**Table Design / Table Layout** (contextual, P1): table styles from theme colors, header row, banded rows, borders; insert/delete rows and columns, cell padding, alignment. Merge/split cells — P2.

### 7.4 Backstage (File tab)
- **BKS-01 (P0)** Full-window view (Esc returns): Home, Open, Save, Save As, Export, Close, Options, About.
- **BKS-02 (P0)** Home shows recent files (pinnable, with path and relative time) and "Try a sample deck" (bundled). Files can be dropped anywhere on the window to open them.
- **BKS-03 (P1)** **Info** page: path (Open file location), size, detected format (Change… → Define Slides), slide count and size, scripts present, external domains, fonts (installed / loaded / missing), embedded media size. Actions: Compress Pictures, Embed External Resources, Version History, Check Accessibility (P2).
- **BKS-04 (P2)** New from templates.

### 7.5 Slide pane
- **SLP-01 (P0)** Numbered thumbnails; current slide highlighted; hidden slides dimmed with a struck-through number.
- **SLP-02 (P0)** Up/Down/Page Up/Page Down navigate; Enter inserts a slide after the current one; Delete deletes (undoable); Ctrl+D duplicates.
- **SLP-03 (P0)** Drag-and-drop reordering with an insertion line; Shift/Ctrl multi-select.
- **SLP-04 (P0)** Context menu: New Slide, Duplicate Slide, Delete Slide, Hide Slide, Cut/Copy/Paste, Format Background.
- **SLP-05 (P1)** reveal.js vertical stacks shown as indented groups.
- **SLP-06 (P2)** Drag slides between windows to copy them to another deck.

### 7.6 Canvas
- **CAN-01 (P0)** Gray workspace with the slide centered (PowerPoint look).
- **CAN-02 (P0)** Zoom 10–400 %: Ctrl+wheel/pinch (around the pointer), Ctrl+= / Ctrl+−, status-bar slider, Fit to Window. Pan with scroll bars, wheel, Space+drag or middle-drag.
- **CAN-03 (P0)** Selection: accent outline, eight round white handles, rotation handle; while dragging, a tooltip shows X/Y, W/H or the angle.
- **CAN-04 (P0)** Hover outline with a small label (object name, or tag + class); can be turned off.
- **CAN-05 (P0)** Text editing shows a dashed outline and a caret.
- **CAN-06 (P0)** Badges on the selected object: "Free" or "In layout" (the tooltip explains what moving will do), a padlock when locked, a hatched overlay on generated content ("Created by the presentation's scripts — can't be edited here. Why?").
- **CAN-07 (P0)** Smart guides (POS-07).
- **CAN-08 (P1)** Rulers, draggable guides, gridlines.
- **CAN-09 (P1)** Text-overflow warning badge (TXT-10).
- **CAN-10 (P0)** Dropping image files inserts pictures at the drop point (dropping on a picture placeholder replaces it); dropping an `.html` file opens it.

### 7.7 Format pane
- **FMP-01 (P0)** Task pane on the right, opened with Ctrl+1, right-click › Format…, or group dialog launchers. Its title follows the selection (Format Shape / Picture / Text / Background / Table); collapsible sections (§8.6).
- **FMP-02 (P0)** Multiple selection shows shared values; mixed values appear blank/indeterminate; edits apply to every selected object.
- **FMP-03 (P0)** Numeric fields: arrow keys step (Shift ×10), unit suffixes accepted ("12px", "2rem", "10%"). P2: arithmetic ("=100+20").

### 7.8 Selection Pane, Notes pane, status bar
- **SEP-01 (P1)** Selection Pane (Alt+F10): tree of the current slide's objects, topmost first. Names are custom or derived ("Heading: Quarterly…", "Picture: logo.png"); rename (double-click), show/hide (eye), lock (padlock), drag to reorder, Show All / Hide All. Generated and hidden objects are marked.
- **NOT-01 (P1)** Notes pane below the canvas ("Click to add notes") where the adapter supports notes (SLD-04).
- **STB-01 (P0)** Status bar: "Slide 3 of 12" (click → Go to Slide); clickable element path, e.g. `section.slide › div.hero › h1` (click selects that ancestor); detected-format chip (→ Info); spell-check language (P1); Notes toggle (P1); view buttons (Normal, Slide Sorter, Slide Show); zoom slider with % (click → Zoom dialog) and Fit to Window.

### 7.9 Mini toolbar and context menus
- **MIN-01 (P1)** Mini toolbar near a text selection and above context menus: font, size, grow/shrink, B/I/U, color, highlight, align, bullets, Format Painter, AI ▸ (AIQ-01).
- **CTX-01 (P0)** Context menus (right-click, Shift+F10, Menu key):
  - *Object:* Cut, Copy, Paste Options, Edit Text, Group ▸, Bring to Front ▸, Send to Back ▸, Align ▸, Position ▸ (In layout / Free / Reset), Lock, Hide, Edit HTML…, Format…, Ask AI… (P1)
  - *Picture:* adds Change Picture ▸ (from file / clipboard), Crop, Alt Text…
  - *Slide background:* Paste, New Slide, Format Background…, Grid and Guides… (P1)
  - *Text being edited:* spelling suggestions, Cut/Copy/Paste Options, Font…, Paragraph…, Link…, AI ▸ (P1, AIQ-01)

### 7.10 Message bars and dialogs
- **MSG-01 (P0)** Non-modal message bars under the ribbon (info / warning / error) with action buttons and a close button. Used for: Protected View; external content blocked; files outside the folder blocked; file changed on disk; scripts not responding; recovered changes; slide-detection confirmation; read-only or unsupported deck.
- **DLG-01 (P0)** Office-style dialogs: Save changes? ([Save] [Don't Save] [Cancel]), Zoom, Go to Slide, Insert Hyperlink, Define Slides, Export, Options. P1: Find & Replace, Insert Table, Replace Fonts, Compress Pictures, Edit HTML, Grid and Guides.

### 7.11 Views
- **VIEW-01 (P0)** Normal view.
- **VIEW-02 (P1)** Slide Sorter: zoomable thumbnail grid; reorder, hide, delete, duplicate.
- **VIEW-03 (P1)** Code and Split views (§8.12).
- **VIEW-04 (P0)** Slide Show and Preview in Browser (§9.3).

### 7.12 Keyboard shortcuts (P0 unless noted)
macOS follows PowerPoint for Mac where it differs. P2: user-customizable.

| Action | Windows / Linux | macOS |
|---|---|---|
| Open / Save | Ctrl+O / Ctrl+S | ⌘O / ⌘S |
| Save As | F12 or Ctrl+Shift+S | ⌘⇧S |
| Close window | Ctrl+W | ⌘W |
| Undo / Redo | Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z) | ⌘Z / ⌘⇧Z (also ⌘Y) |
| Cut / Copy / Paste | Ctrl+X / C / V | ⌘X / C / V |
| Paste Special | Ctrl+Alt+V | ⌃⌘V |
| Copy / paste formatting (P1) | Ctrl+Shift+C / Ctrl+Shift+V | ⌘⇧C / ⌘⇧V |
| Duplicate object or slide | Ctrl+D | ⌘D |
| Select all | Ctrl+A | ⌘A |
| New slide | Ctrl+M | ⌘⇧N |
| Bold / Italic / Underline | Ctrl+B / I / U | ⌘B / I / U |
| Grow / shrink font | Ctrl+Shift+> / Ctrl+Shift+< | ⌘⇧> / ⌘⇧< |
| Align left / center / right / justify | Ctrl+L / E / R / J | ⌘L / E / R / J |
| Insert link | Ctrl+K | ⌘K |
| Find / Replace (P1) | Ctrl+F / Ctrl+H | ⌘F / ⌃H |
| Group / Ungroup (P1) | Ctrl+G / Ctrl+Shift+G | ⌘⌥G / ⌘⌥⇧G |
| Bring to front / send to back | Ctrl+Shift+] / Ctrl+Shift+[ | ⌘⌥⇧F / ⌘⌥⇧B |
| Format pane | Ctrl+1 | ⌘1 |
| Edit text ⇄ select object | F2 or Enter | F2 or Return |
| Exit text editing → select parent → deselect | Esc | Esc |
| Nudge 1 px / 10 px | Arrow / Shift+Arrow | Arrow / ⇧Arrow |
| Constrain move · keep aspect ratio | Shift+drag | ⇧drag |
| Resize from center | Ctrl+drag handle | ⌥drag handle |
| Duplicate while dragging | Ctrl+drag | ⌥drag |
| Suspend snapping while dragging | hold Alt | hold ⌘ |
| Rotate in 15° steps | Shift+drag rotation handle | ⇧drag rotation handle |
| Select object behind | Alt+click | ⌥click |
| Add to / remove from selection | Shift+click or Ctrl+click | ⇧click or ⌘click |
| Zoom in / out / fit | Ctrl+= / Ctrl+− / Ctrl+0 | ⌘= / ⌘− / ⌘0 |
| Previous / next slide (editor) | Page Up / Page Down | Page Up / Page Down |
| Slide show from beginning / current | F5 / Shift+F5 | ⌘⇧Return / ⌘Return |
| Search commands (P1) | Alt+Q | ⌘⇧P |
| Spelling (P1) | F7 | ⌥⌘L |
| Selection Pane (P1) | Alt+F10 | via menu |
| AI Assistant pane (P1) | Ctrl+Alt+I | ⌃⌘I |
| Collapse ribbon (P1) | Ctrl+F1 | ⌘⌥R |
| Move between window regions | F6 / Shift+F6 | F6 / ⇧F6 |
| Help (P1) | F1 | ⌘? |

### 7.13 Look and feel, accessibility, languages
- **VIS-01 (P0)** Fluent 2 design tokens; the system UI font (Segoe UI on Windows, SF on macOS, the desktop's UI font on Linux); Office-like compact density; configurable accent color (default: a warm orange-red reminiscent of PowerPoint, e.g. `#C43E1C`).
- **VIS-02 (P0)** Light and dark themes, following the system by default. P1: Windows high-contrast (forced colors) respected.
- **VIS-03 (P0)** Don't copy Microsoft logos or product icons, and don't use Microsoft trademarks in the product name. Fluent UI System Icons (MIT) are fine.
- **A11Y-01 (P1)** Everything operable by keyboard: F6 cycles regions (ribbon, slide pane, canvas, notes, Format pane, status bar); arrow keys inside the ribbon; Tab inside panes.
- **A11Y-02 (P1)** Accessible names and roles for every control; announcements for selection changes ("Picture selected: Logo").
- **A11Y-03 (P1)** WCAG 2.1 AA contrast in both themes; visible focus; respects reduced motion.
- **I18N-01 (P0)** All UI strings externalized from day one (i18next/ICU); locale-aware numbers and dates; English at launch; adding a language = adding one translation file. P2: right-to-left UI.
- **I18N-02 (P0)** Document text in any language edits correctly: IME composition, right-to-left text, emoji.

---

## 8. Editing features

### 8.1 Selection
- **SEL-01 (P0)** An **object** is a source element inside the current slide that is visible and isn't inline text formatting (`b`, `strong`, `i`, `em`, `u`, `s`, `span`, `a`, `sup`, `sub`, `mark`, `small`, `code`, `br`… inside text). The slide root is the "slide background".
- **SEL-02 (P0)** A click selects the **deepest object** under the pointer — so a heading wrapped in invisible layout `div`s is selected directly. Wrappers with no visual styling whose box equals their only child's box are skipped.
- **SEL-03 (P0)** Esc selects the parent object (when editing text, Esc first leaves editing with the object selected); Esc on a top-level object deselects. The status-bar path selects any ancestor.
- **SEL-04 (P0)** Shift+click or Ctrl/⌘+click toggles objects in a multi-selection; Alt/⌥+click cycles to the next object behind the pointer.
- **SEL-05 (P0)** Marquee: dragging from the slide background selects every object entirely inside the rectangle (outermost only — if a container and its children are inside, the container).
- **SEL-06 (P0)** Ctrl+A (outside text editing) selects all top-level objects on the slide.
- **SEL-07 (P0)** Embedded frames, videos, canvases and script-generated areas inside an element with an editor ID can be selected, moved and resized as a whole; their insides aren't editable (badge + explanation).
- **SEL-08 (P1)** Locked objects can be selected but not moved, resized or deleted (as in PowerPoint).
- **SEL-09 (P0)** Changing slides clears the selection; undo/redo restore it.

### 8.2 Moving, resizing and rotating — the positioning model
This is the heart of "change positions": HTML has several layout systems, and the editor must move things the way users expect without breaking the rest of the slide.

- **POS-01 (P0)** Each object is classified:

| Category | Typical examples | Move writes | Resize writes |
|---|---|---|---|
| **Free** — `position: absolute/fixed` | Logos, decorative shapes, AI decks laid out with absolute coordinates | `left`/`top` (or `right`/`bottom` if those anchor the element) | `width`/`height` (plus position when dragging the top/left handles) |
| **In layout** — normal flow, flex or grid item | Headings, paragraphs, cards in a grid | A visual offset with the CSS `translate` property, e.g. `translate: 24px -12px` | `width`/`height`; for flex/grid items also whatever makes the size take effect (e.g. `flex-shrink: 0`), with a hint "Size is now fixed" |
| Inline text formatting | `strong`, `span`, links inside text | Not movable — it's text formatting | — |

- **POS-02 (P0)** Why `translate`: it doesn't disturb the surrounding layout (moving one object doesn't move others, as in PowerPoint), it combines with an existing `transform` or CSS animation instead of overwriting it, and it's fully reversible. Rotation uses the `rotate` property and flipping uses `scale`, for the same reasons.
- **POS-03 (P0)** Position commands (contextual tab, context menu, Format pane):
  - **Reset Position** — removes the offset.
  - **Make Free** — converts an In-layout object to `position: absolute`, with left/top/width/height computed from its current visual box relative to its containing block; adds `position: relative` to the slide root only if no positioning context exists. One-time warning: "Other objects may move to fill the space."
  - **Put Back in Layout** — reverses Make Free when possible.
  - **Reorder in Layout** (P1) — drag an In-layout object with Ctrl/⌘ held (or in Reorder mode): an insertion line between its siblings shows where it will go; dropping changes the order in the HTML. P2: move into another container.
- **POS-04 (P0) — Units** (Options › Editing › Units: Auto / px / %). Auto means:
  1. keep the unit the property already uses on that element;
  2. otherwise **px** if the slides have a fixed pixel design size (including stages scaled by JS/CSS);
  3. otherwise **%** of the containing block for left/top/width/height and **vw/vh** for `translate`, so responsive decks stay proportionally correct at any screen size;
  4. round to 0.1 px / 0.01 %.

  *Acceptance:* after moving an object in a responsive deck, previewing at three viewport sizes keeps it in the same relative position.
- **POS-05 (P0)** Styles are written to the element's inline `style` attribute. If a value doesn't take effect (computed value unchanged, e.g. because of a stylesheet rule with `!important`), the Format pane explains it and offers "Apply anyway (adds !important)" or "Edit the CSS rule (affects N objects)". Never fail silently.
- **POS-06 (P0)** Movement is computed in the element's containing-block coordinates (GEO-01) — correct inside scaled stages and rotated parents.
- **POS-07 (P0) — Smart guides and snapping.** Snap to slide edges and center, other objects' edges and centers, equal spacing (with distance markers), and grid/guides when enabled; threshold 6 screen px; red dashed guide lines like PowerPoint; hold Alt (⌘ on macOS) to suspend snapping.
- **POS-08 (P0)** Modifiers: Shift constrains movement to horizontal/vertical and keeps the aspect ratio when resizing (corner handles of pictures keep it by default); Ctrl/⌥ resizes from the center; Ctrl/⌥+drag duplicates; Shift snaps rotation to 15°.
- **POS-09 (P0)** Nudge: arrow 1 px, Shift+arrow 10 px (design-viewport px, written per POS-04); consecutive nudges within 1 s form one undo step.
- **POS-10 (P0)** Bring Forward/to Front and Send Backward/to Back set `z-index` relative to overlapping siblings in the same stacking context (adding `position: relative` to static elements when needed). If stacking contexts make it impossible, explain and offer "Move in document order" (P1).
- **POS-11 (P0)** A multi-selection moves, resizes and aligns together; each object is written according to its own category.
- **POS-12 (P0)** Format pane › Size & Position shows X, Y, W, H (visual, relative to the slide's top-left corner whatever the underlying CSS), rotation, Lock aspect ratio, position mode and Reset buttons.

### 8.3 Text
- **TXT-01 (P0)** Text objects: objects whose content is text plus inline formatting (h1–h6, p, li, td/th, blockquote, figcaption, button, label, `div`/`span` containing only text…).
- **TXT-02 (P0)** Start editing by double-click (selects the word), clicking an already-selected text object (caret at the click), or F2/Enter. Typing while a text object is selected replaces its text, as in PowerPoint (Options toggle, default on).
- **TXT-03 (P0)** Editing session: `contenteditable` only on that element inside the live view; deck handlers suppressed (RND-03); Esc or clicking elsewhere commits. Undo/redo inside the session use Deckhand's history, not the browser's native undo.
- **TXT-04 (P0)** Before editing, check that the live content matches the source (same text and element structure). If scripts transformed it (e.g., letters split into spans for an animation), don't edit live: offer "Edit text in a dialog" (source-level) or "Turn off deck scripts".
- **TXT-05 (P0)** Formatting: bold, italic, underline, font family, size, grow/shrink, color, alignment, link. P1: strikethrough, superscript/subscript, highlight, change case, letter and line spacing, bullets/numbering, list levels, clear formatting. P2: text shadow.
- **TXT-06 (P0)** Clean, semantic markup: `<strong>`, `<em>`, `<u>`, `<s>`, `<sup>`, `<sub>`, `<a href>`; any other inline formatting as `<span style>`; merge identical adjacent spans and drop empty ones; never `<font>`. Formatting is implemented with the editor's own range-based code, not `document.execCommand` (its output is inconsistent). When the whole text — or the object itself — is formatted, set the style on the element instead of wrapping it in spans.
- **TXT-07 (P0)** Font size is written in the unit the element already uses (px, rem, em, vw, `clamp()`…), with the computed px shown as a hint. Grow/Shrink multiply the value, which works for any unit (inside `clamp()`, scale each argument).
- **TXT-08 (P0)** Enter in a `li` creates a new `li`; in a `p` among sibling paragraphs, a new `p` with the same class; elsewhere it inserts `<br>`. Shift+Enter always inserts `<br>`.
- **TXT-09 (P0)** Pasting into text defaults to Keep Text Only (line breaks per TXT-08). A Paste Options button then offers Keep Text Only / Keep Source Formatting (sanitized) / Use Destination Formatting.
- **TXT-10 (P1)** Warn when text overflows its box or the slide. P2: "Shrink text on overflow".
- **TXT-11 (P0)** Pasted HTML is sanitized: remove scripts, event-handler attributes, `javascript:` URLs, `<style>`, Office/Word leftovers (`mso-*`, `o:p`) and comments; keep inline semantic tags, `<br>` and links (http, https, mailto, #).
- **TXT-12 (P1)** Spell-check while typing (Chromium spell-checker; languages selectable; suggestions and Add to Dictionary in the context menu); Review › Spelling (F7) walks through all slides. It must work offline (bundle dictionaries wherever Electron would otherwise download them).
- **TXT-13 (P0)** IME composition, right-to-left text, emoji and non-breaking spaces behave correctly.
- **TXT-14 (P2)** Edit text inside inline SVG `<text>`.

### 8.4 Pictures
- **IMG-01 (P0)** Insert PNG, JPEG, GIF, WebP, SVG and AVIF from the file dialog, drag-and-drop or the clipboard.
- **IMG-02 (P0)** Storage follows the deck's convention: if it already uses local image files, copy the new picture next to them (e.g., `assets/`) and link it relatively; otherwise embed it as a `data:` URI to keep single-file decks portable. Overridable in Options. Warn when an embedded picture exceeds 2 MB.
- **IMG-03 (P1)** On insert, offer to downscale pictures much larger than needed (> 2× slide size). Compress Pictures dialog for the selection or all pictures (maximum resolution, JPEG/WebP quality, shows the saving).
- **IMG-04 (P0)** **Change Picture** keeps size, position and styles. Works for `<img>` (`src`; `srcset`/`<picture>` sources updated or removed, with a notice), CSS `background-image` and SVG `<image>`.
- **IMG-05 (P1)** Crop mode with PowerPoint-style crop handles, non-destructive (`object-fit: cover` + `object-position` + element size, or `background-size/position`); presets 1:1, 4:3, 16:9 and circle.
- **IMG-06 (P1)** Picture styles: border, rounded corners, shadow, opacity. P2: brightness, contrast and grayscale presets (CSS filters).
- **IMG-07 (P1)** Alt Text editor.
- **IMG-08 (P1)** Inline SVG icons can be recolored (`color` when they use `currentColor`, otherwise fill/stroke). Insert › Icons offers a bundled, searchable, offline icon set.
- **IMG-09 (P2)** Video and audio: insert (copied to assets or embedded by URL), poster image, autoplay/loop/controls.

### 8.5 Inserting objects
- **INS-01 (P0)** **Text Box**: click to place or drag to draw. Creates a Free `<div>` inside the slide that inherits the deck's body-text style, then enters editing.
- **INS-02 (P1)** **Shapes**: rectangle, rounded rectangle, ellipse, triangle, line, arrow, callout and similar. Simple shapes are styled `<div>`s that can hold text; lines, arrows and complex shapes are inline SVG (`vector-effect: non-scaling-stroke`). The default fill uses the theme accent variable when there is one.
- **INS-03 (P1)** **Table**: Office-style grid picker (hover to choose rows × columns) plus a dialog; styled from theme colors. Table Design/Layout tabs: add/delete rows and columns, header row, banded rows, borders, cell padding, alignment. Tab moves to the next cell; Tab in the last cell adds a row. P2: merge/split.
- **INS-04 (P0)** **Link** (Ctrl+K): web address or email. P1: link to another slide (adapter deep link, e.g. `#/3` in reveal.js) with "Test link".
- **INS-05 (P1)** **Custom HTML**: insert a snippet through a small code editor with preview.
- **INS-06 (P2)** Simple charts (bar, line, pie) as SVG generated from an editable data grid.
- **INS-07 (P0)** New objects appear at the canvas center (or the click/drop point), on top, selected.

### 8.6 Formatting and styles
- **STY-01 (P0)** Format pane sections:

| Section | Controls | Priority |
|---|---|---|
| Size & Position | X, Y, W, H, rotation, lock aspect ratio, position mode, Reset | P0 |
| Fill | None; solid (color + transparency); gradient (linear/radial, stops, angle); picture | P0 solid · P1 rest |
| Border | None/solid/dashed/dotted, color, width, corner radius (all or per corner) | P0 · per-side P1 |
| Effects | Opacity · shadow (presets + custom), blur | P0 opacity · P1 rest |
| Text | Font, size, weight, style, color, alignment, line height · vertical alignment, letter spacing, case, internal margins (padding), text shadow | P0 first group · P1 rest |
| Layout (advanced) | display, flex direction/justify/align/gap, grid columns, padding, margin | P1 |
| Advanced | Inline CSS declarations (with autocomplete), class list (autocomplete from the document), attributes (id, title, `data-*`, `aria-*`), Edit HTML… | P1 |

- **STY-02 (P0)** Office-style color picker: **Theme Colors** (from CSS variables, THM-01) with a tint/shade grid, Standard Colors, Recent Colors, More Colors… (HSV, hex, RGB, alpha). P1: Eyedropper picking from the canvas.
- **STY-03 (P0)** Choosing a theme color writes `var(--name)`, not the hex value, so the object follows later theme changes. P1: tints/shades as `color-mix(in srgb, var(--name) N%, white|black)`.
- **STY-04 (P1)** **Format Painter**: single click applies once, double-click stays on until Esc; copies visual properties (font, colors, fill, border, radius, shadow, opacity, text styles), not size or position.
- **STY-05 (P1)** **Live Preview**: hovering over gallery items (fonts, colors, shadows, layouts, theme presets) applies them temporarily in the live view; moving away reverts; nothing enters the undo history until clicked.
- **STY-06 (P1)** Clear inline formatting (by category or all) on the selected objects.
- **STY-07 (P2)** CSS Rules panel (DevTools-like): rules matching the selection, editable, with specificity hints.
- **STY-08 (P1)** **Apply to all similar** (like Word's "Update style to match selection"): after changing an object styled by a class, offer "Apply to all `.card` objects (8 on 5 slides)". This edits the matching rule in the deck's `<style>` (or, if no single rule fits, writes inline on each match). Matches are highlighted and counted before applying.

### 8.7 Theme
- **THM-01 (P0)** **Theme Colors**: CSS custom properties holding colors on `:root`, `html`, `body` or the slide root appear as named swatches (`--brand-primary` → "Brand primary"). Editing a swatch updates the variable in place and the whole deck follows. These swatches head every color picker.
- **THM-02 (P1)** **Document Colors**, when there are no variables: colors used in the deck, by frequency; "Replace color everywhere" (CSS, inline styles, SVG fill/stroke) with a preview count. P2: "Create theme colors" extracts repeated colors into variables.
- **THM-03 (P1)** **Fonts**: detect font variables or the most-used families (headings vs body); Replace Fonts dialog. The font list combines installed fonts (Local Font Access API), fonts the deck already loads and a curated web-font list (online). A web font can be linked or embedded (woff2 as `data:` URI) for offline use, showing its license. Warn when a chosen font is installed locally but probably missing on other computers.
- **THM-04 (P0)** **Format Background**: color, gradient or picture (fill/fit/tile) with transparency, for the current slide; **Apply to All** writes a rule for the slide selector in the deck's `<style>` (or per slide when there's no common selector).
- **THM-05 (P2)** Theme presets (palette + fonts set through variables); slide-size change for fixed-size decks.

### 8.8 Arrange and align
- **ARR-01 (P0)** Align left/center/right/top/middle/bottom — to the slide (one object, or "Align to Slide") or to the selection (two or more, "Align Selected Objects").
- **ARR-02 (P1)** Distribute horizontally/vertically (three or more).
- **ARR-03 (P1)** **Group/Ungroup**: wraps selected siblings (same parent) in a `<div>`. Free objects → the group becomes Free with their bounding box and the children are repositioned inside it; In-layout objects → the wrapper stays in layout (warn that the layout may change). Ungroup unwraps and keeps visual positions. Objects with different parents → disabled, with an explanation.
- **ARR-04 (P0)** Order (POS-10).
- **ARR-05 (P1)** Rotate 90° left/right; flip horizontal/vertical (`scale: -1 1` / `scale: 1 -1`).
- **ARR-06 (P1)** Grid and Guides dialog: grid spacing, snap to grid, snap to objects, smart guides on/off, guides list; guides saved per deck (Appendix A).
- **ARR-07 (P1)** Lock/unlock objects (Selection Pane, context menu).
- **ARR-08 (P1)** Hide object (Selection Pane eye): inline `display: none` — hidden in the slide show too, as in PowerPoint; unhiding removes it.

### 8.9 Slides
- **SLD-01 (P0)** New Slide (layout gallery, ADP-07), Duplicate, Delete, Reorder (drag, cut/paste), on one or several slides.
- **SLD-02 (P1)** Hide Slide where the adapter supports it (reveal.js `data-visibility="hidden"`); otherwise disabled with an explanation.
- **SLD-03 (P1)** Copy/paste slides between decks with Paste Options: Use Destination Theme (keep markup and classes) or Keep Source Formatting (bring the CSS the slide needs, scoped to avoid collisions).
- **SLD-04 (P1)** Speaker notes in the Notes pane where the adapter supports them (reveal.js `aside.notes`). P2: notes for generic decks, stored in an inert `<template data-deckhand-notes>` inside the slide.
- **SLD-05 (P2)** Sections (named slide groups) in the slide pane and sorter.

### 8.10 Undo, redo and clipboard
- **UND-01 (P0)** Unlimited undo/redo (at least 500 steps) for every command, including slide operations, theme changes and code edits.
- **UND-02 (P0)** Grouping: typing by word/pause; one drag = one step; nudges within 1 s = one step; slider/spinner drags = one step; multi-object operations = one step.
- **UND-03 (P1)** Undo dropdown with readable action names ("Move 'Logo'", "Change font color"); undo several steps at once.
- **UND-04 (P0)** Undo/redo jump to the affected slide and restore the selection.
- **UND-05 (P0)** Saving keeps the history; reloading from disk clears it (after confirmation).
- **UND-06 (P2)** Repeat last action (F4).
- **CLP-01 (P0)** Copying an object puts on the clipboard a private format (HTML fragment, CSS context, source deck), sanitized `text/html` and `text/plain`. P2: a PNG of the object.
- **CLP-02 (P0)** Pasting onto another slide keeps the position; on the same slide, it's offset by 20 px (as in PowerPoint). Plain text → new text box (or into the text being edited); image → new picture; HTML from other apps → sanitized; between decks → Paste Options (Use Destination Theme / Keep Source Formatting).

### 8.11 Find, replace, spelling
- **FND-01 (P1)** Find (Ctrl+F) and Replace (Ctrl+H) across all slides' text (not markup): match case, whole words, result count; each result opens its slide and selects the object; Replace All is one undo step.
- **FND-02 (P1)** Replace Fonts (THM-03) and Spelling (TXT-12).

### 8.12 Code view (power users)
- **CODE-01 (P1)** View › Code (full source) and Split (canvas + code), using CodeMirror 6 with highlighting, search, folding and line numbers; long `data:` URIs folded as `data:image/png;base64,… (1.2 MB)`.
- **CODE-02 (P1)** Two-way selection sync: selecting an object reveals and highlights its source; moving the caret in the code selects the matching object.
- **CODE-03 (P1)** Code edits apply as one undo step on Apply or after 1 s idle, if the HTML parses without structural errors; errors are highlighted; editor IDs are re-associated.
- **CODE-04 (P1)** **Edit HTML…** on an object: a small dialog editing its outer HTML with live preview.

---

## 9. Files, saving, slide show and export

### 9.1 Opening and saving
- **FILE-01 (P0)** Open with Ctrl+O, Recent, drag-and-drop (window, dock/taskbar icon), the OS "Open with" menu or the CLI; `.html`/`.htm`.
- **FILE-02 (P0)** Save in place with the guarantees of §6.3. **Save As** to another folder, when the deck uses relative files, asks: Copy linked files / Embed everything in the HTML / Keep links (may break).
- **FILE-03 (P0)** Closing or quitting with unsaved changes: "Do you want to save changes to 'X'?" [Save] [Don't Save] [Cancel].
- **FILE-04 (P0)** **External changes** (watcher + hash) — e.g., the deck was regenerated by an AI tool while open. Without local edits: message bar "Updated by another program. [Reload]" (Options: reload automatically). With local edits: [Reload and discard my changes] [Keep my version] [Compare] (P1: side-by-side diff). Saving over a file that changed on disk asks first (Overwrite / Save as copy).
- **FILE-05 (P1)** Read-only files open read-only with a message bar and Save As.
- **FILE-06 (P2)** Lock file for shared folders (like Office's owner file): a hidden `~$<name>.deckhand-lock` with user name and time; a second user sees "In use by X — open read-only / open anyway". Removed on close; stale locks detected.

### 9.2 AutoRecover and versions
- **AUTO-01 (P0)** AutoRecover snapshots of unsaved changes every 60 s (configurable) and when the window loses focus, stored in the app-data folder — never next to the user's file.
- **AUTO-02 (P0)** After a crash, the next launch shows a **Document Recovery** pane listing recoverable documents (time, original path): Open, Save As, Discard.
- **AUTO-03 (P1)** **Version History**: the last 20 saved versions of each file kept in app data (configurable); File › Info › Version History to preview (read-only) and restore.
- **AUTO-04 (P2)** AutoSave switch in the QAT (saves to the file a few seconds after each change; off by default).

### 9.3 Slide show and preview
- **SHOW-01 (P0)** **Slide Show** (F5 / Shift+F5): a full-screen window rendering the **current in-memory state** (no save needed) with deck scripts on, so the deck behaves exactly as in a browser. It starts at the chosen slide through the adapter (API or deep link); decks without their own navigation get a minimal navigator (arrows, space, click, Esc). Esc returns to the editor at the last slide shown.
- **SHOW-02 (P1)** Choose the monitor (multi-monitor setups).
- **SHOW-03 (P0)** **Preview in Browser**: opens the current state in the default browser — via a temporary server on 127.0.0.1 (random port + token, serving only the deck's folder) or a temporary copy with `<base href>`; pick the more robust option and document it.
- **SHOW-04 (P2)** Presenter view (current/next slide, notes, timer) for decks without their own.

### 9.4 Export (never modifies the document)
- **EXP-01 (P0)** **PDF**: one page per slide, page size = slide size (CSS `@page` + `preferCSSPageSize`), backgrounds printed, animations in their final state; range (all / current / custom) and "include hidden slides". Two modes: **Vector** (default; `printToPDF` per slide; selectable text) and **Image-based** (exact screen appearance; 2× captures assembled with pdf-lib) for decks whose print rendering differs.
- **EXP-02 (P1)** **Images**: PNG or JPEG per slide at 1×/2×/4×, named `<deck>-01.png`, `<deck>-02.png`…
- **EXP-03 (P1)** **Single-file HTML**: inline stylesheets, scripts, images and fonts (including `url()` inside CSS) and, optionally, remote resources, so the file works offline anywhere; shows the resulting size.
- **EXP-04 (P2)** Folder package: HTML + `assets/` with every resource stored locally and paths rewritten.
- **EXP-05 (P2)** PowerPoint "slides as pictures": one full-slide image per slide plus notes; clearly labeled as not editable.
- **EXP-06 (P2)** Print through the system dialog.

---

## 10. AI Assistant

An optional task pane on the right where the user chats with an AI model **through an AI account they already have** — Claude, ChatGPT, Gemini, Copilot and others. The open presentation is the conversation's context. The assistant can answer questions about the deck or change it, from fixing one word to adding slides or restyling the whole deck. Every change goes through the same command system as manual edits (ARCH-02): it keeps the fidelity guarantees (§6.3), appears in undo and can be reviewed.

### 10.1 Principles
- **AIG-01 (P1) Bring your own AI.** Deckhand runs no AI service of its own. Requests go from the user's computer straight to the provider the user chose — or through that provider's own app or agent — and are paid by the user's account: API credits or plan allowance. Deckhand never proxies, stores or resells AI traffic.
- **AIG-02 (P1) Official access only.** Use only access methods a provider documents for third-party apps. Never scrape web chat sessions, reuse tokens taken from other apps, or impersonate an official client. Provider rules change often: before each release, re-check every connection type against the provider's current terms, record the result in `DECISIONS.md`, and keep connection types that depend on a provider's approval behind build-time flags.
- **AIG-03 (P1) The user stays in control.** The AI changes the deck only in Edit mode; each turn's changes can be reviewed and undone in one step; nothing reaches the disk until the user saves.
- **AIG-04 (P1) Least privilege.** The AI can only use the deck tools of §10.6 — no shell, no file system, no settings, no saving or exporting.
- **AIG-05 (P1) Transparency.** The user always sees which connection and model are in use, what context is sent, which account pays and, where known, tokens and estimated cost.
- **AIG-06 (P1) Optional.** AI features stay inactive until the user adds a connection, and can be switched off by the user or by an administrator policy (AIS-06).

### 10.2 Using the AI accounts people already have
AI access comes in two kinds, and providers treat them differently:

| Kind | Examples | Usable from a third-party app such as Deckhand? |
|---|---|---|
| **API credits** — pay-as-you-go developer accounts | Claude Console, OpenAI Platform, Google AI Studio, Azure, AWS, Google Cloud, OpenRouter | Yes — the standard route, through an API key or a cloud sign-in |
| **Plan allowance** — chat subscriptions | Claude Pro/Max/Team, ChatGPT Plus/Pro, Google AI Pro/Ultra, GitHub Copilot, Microsoft 365 Copilot | Only through a route the provider offers to third-party apps (below); otherwise only inside the provider's own apps |

Status as researched on 30 October 2026 — re-check at implementation time (AIG-02):

| Provider | With API credits | With the plan the user already pays for |
|---|---|---|
| **Claude** (Anthropic) | API key from the Claude Console. Since 7 October 2026, Max and Team plans (not Pro) include monthly API credits, claimed into a Console organization and spent through such a key. Also Amazon Bedrock, Google Vertex AI, Microsoft Foundry. | Anthropic's Agent SDK documentation says that, unless previously approved, third-party developers may not offer claude.ai login in their products — so Deckhand never handles Claude account credentials. Two routes remain: an **external agent** (AIC-06), where Claude's own agent software runs on the user's computer and signs in by itself (enabled only if Anthropic's terms allow this use at release time), and **MCP server mode** (§10.9), where the user chats in Claude's own apps and they edit the deck open in Deckhand. |
| **ChatGPT** (OpenAI) | OpenAI API key; Azure OpenAI / Microsoft Foundry | **Continue with ChatGPT** (AIC-04): OpenAI's "Sign in with ChatGPT" plan usage (preview, Plus and Pro plans). OpenAI offers it to open-source and local personal apps; other private or paid apps must join its waitlist (Q3). Also Codex, OpenAI's agent, as an external agent (AIC-06). |
| **Gemini** (Google) | Gemini API key from Google AI Studio (free tier available, with lower limits); Vertex AI | No sanctioned route for third-party apps found. Google's Gemini CLI terms say that accessing the services behind it through third-party software violates its terms. Use API keys; MCP server mode (§10.9) works with Google's own agent apps that support local MCP servers. |
| **GitHub Copilot** | — (the SDK can also use the user's own API keys) | **GitHub Copilot SDK** (AIC-05), generally available: the user signs in with GitHub, each prompt counts toward their Copilot allowance, and apps can add their own tools. |
| **Microsoft 365 Copilot** | Microsoft-based companies usually provide Azure OpenAI / Microsoft Foundry instead (AIC-03) | **Microsoft 365 Copilot Chat API** (AIC-09), in preview: needs a Microsoft 365 Copilot licence, a work account and broad Microsoft Graph permissions (typically with administrator consent); it answers in text only and offers no custom tools. |
| **Others** | OpenAI-compatible endpoints (company gateways such as LiteLLM), OpenRouter (one account for many providers' models), local models through Ollama or LM Studio — free, offline and private | OpenRouter sign-in (AIC-07) returns a key billed to the user's own OpenRouter credits |

### 10.3 Connections
- **AIC-01 (P1)** Options › AI › Connections, also reachable from the pane's connection menu: add, test, rename, set as default, sign out, remove. Several connections can coexist (e.g. a personal Claude key and the company's Azure OpenAI). Each shows provider, account (when known), status and who pays ("API credits", "ChatGPT plan", "Copilot plan"…).
- **AIC-02 (P1) API keys:** Anthropic, OpenAI, Google Gemini, and OpenAI-compatible endpoints (base URL plus optional key — company gateways, OpenRouter, Ollama, LM Studio). A "Get a key" link opens the provider's key page; "Test" lists the available models.
- **AIC-03 (P1) Cloud accounts:** Azure OpenAI / Microsoft Foundry (key or Microsoft Entra ID sign-in). P2: Amazon Bedrock (AWS profile or SSO) and Google Vertex AI (gcloud credentials).
- **AIC-04 (P1) Continue with ChatGPT** — only if Deckhand is eligible (AIG-02, Q3). Follow OpenAI's "Sign in with ChatGPT" plan-usage documentation:
  - OpenID Connect with PKCE in the system browser, with a loopback callback on `127.0.0.1` (not `localhost`), requesting `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, and a persistent `ext_agent_host_id` per installation;
  - model requests to the Responses API with `store: false` and `stream: true`, the needed history sent every turn (no `previous_response_id`), Deckhand's instructions in `instructions` rather than system-role messages; function tools, images and files work when the model supports them;
  - OpenAI's UI guidelines: a "Continue with ChatGPT" button, a one-time "You're using your ChatGPT plan" notice, "Using ChatGPT plan · Manage usage" near the composer, and **Manage usage** as the main action when the plan's limit is reached (`subscription_sharing_usage_limit_exceeded`, `subscription_sharing_usage_unavailable`).
- **AIC-05 (P1) GitHub Copilot** through the official GitHub Copilot SDK (its Node package bundles the Copilot CLI): Sign in with GitHub through Deckhand's own GitHub OAuth app; models listed by the SDK; Deckhand's deck tools registered as custom tools; the SDK's built-in shell and file tools disabled.
- **AIC-06 (P1) External agents (ACP).** Deckhand is an Agent Client Protocol client: it can run agent programs from AI providers — e.g. Claude Agent, Codex, Copilot, Google's agents — which handle their own sign-in, models and billing. Offer agents found on the computer and in the ACP Registry (`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`), and install one only after the user confirms. When running an agent, Deckhand:
  - starts it in an empty working folder managed by Deckhand (never the deck's folder) and passes its deck tools as an MCP server in `session/new` (the `deckhand mcp` stdio command for agents that only support stdio, AIM-01);
  - advertises no client file-system or terminal capabilities, refuses every `session/request_permission` except calls to its deck tools, and picks the agent's most restrictive mode that still allows them;
  - shows the agent's messages, reasoning, tool calls and plans in the pane; maps its session config options (model, mode, reasoning level) to the pane's pickers; shows `usage_update` in the context meter; Stop sends `session/cancel`;
  - enables each agent only where its vendor's terms allow this use (AIG-02).
- **AIC-07 (P2) OpenRouter sign-in** (OAuth PKCE with a localhost callback) returns a key billed to the user's OpenRouter credits.
- **AIC-08 (P1) Credentials** (keys, refresh tokens) are stored with Electron `safeStorage` — Keychain on macOS, DPAPI on Windows, Secret Service or KWallet on Linux — never in settings files, logs or crash reports, and never sent to the renderer. Without a Linux secret store, warn and offer "Remember for this session only". Rotate refresh tokens as each provider requires.
- **AIC-09 (P2) Microsoft 365 Copilot** through the Microsoft 365 Copilot Chat API (Entra ID sign-in, delegated permissions): Ask mode, plus proposals in the edit-block format (AIT-06) that the user applies with a button.
- **AIC-10 (P1) Models:** list each connection's models from the provider's models API, the SDK or the agent's config options; capability flags (tool calling, vision, PDF input, reasoning, context size) come from the API or a bundled, updatable table. Models without tool calling are offered for Ask mode only (P2: also the edit-block format, AIT-06). No model names are hard-coded beyond replaceable defaults; the last model used per connection is remembered.
- **AIC-11 (P1) Networking:** system proxy (PLT-10); streaming; retry with backoff on rate limits and server errors; clear messages for an invalid key, exhausted credits or plan limit (with a link to the provider's billing or usage page), an unavailable model, no internet, and a request that is too large.

### 10.4 The AI Assistant pane

```
┌─ AI Assistant ──────────────────────────┐
│ Connection ▾   Model ▾    New   History │
├─────────────────────────────────────────┤
│ Suggested prompts (empty chat)          │
│ Messages · steps · change cards         │
│                                         │
├─────────────────────────────────────────┤
│ Context: Deck · Slide 3 · "Logo" (x)    │
│ ┌─────────────────────────────────────┐ │
│ │ Ask a question or describe a change │ │
│ └─────────────────────────────────────┘ │
│ +   @   Edit ▾   Web   Thinking ▾  Send │
│ API credits · 12k / 200k tokens         │
└─────────────────────────────────────────┘
```

- **AIP-01 (P1)** Open it from Home › AI Assistant (the rightmost ribbon button, where Office puts its assistant), View › Show › AI Assistant, Ctrl+Alt+I (⌃⌘I), or right-click › Ask AI…. It docks on the right as a tab beside the Format pane (UI-03). P2: side by side with it, or undocked into its own window.
- **AIP-02 (P1) Header:** connection and model picker (models grouped by connection, with capability icons, and "Manage connections…"); New chat; History; a menu with Rename, Export as Markdown, Delete and AI settings.
- **AIP-03 (P1) Composer:** multi-line input (Enter sends, Shift+Enter adds a line, Esc or Stop cancels a running turn); a **+** menu — Attach files…, Add current slide, Add selected objects, Add all slides, Add slide picture, Paste image; drag and drop of files and images; **@** mentions of slides and objects (`@slide 3`, `@Logo`, `@selection`) with autocomplete; **/** for saved prompts (AIQ-02); the **Ask / Edit** mode switch; a Web search toggle when the connection supports it; a reasoning level when the model supports it.
- **AIP-04 (P1) Context chips** above the input list exactly what the next message will send, each removable, with a context meter (tokens used / limit) and the billing line ("API credits", "Using ChatGPT plan · Manage usage", "Copilot plan").
- **AIP-05 (P1) Messages:** streamed Markdown (lists, tables, code, links — opened in the default browser after confirmation) and images; reasoning summaries, collapsed, when the provider returns them; tool activity as compact steps ("Changed the title on slide 3") that jump to the slide and select the object when clicked. Actions: Copy; Retry (optionally with another model); Edit and resend on the user's messages; Restore to before this message (AIE-06).
- **AIP-06 (P1) Empty chat:** prompt suggestions based on the deck ("Summarize this deck", "Fix spelling on all slides", "Make slide 3 more visual", "Translate into Italian", "Give the deck a darker theme") and one line on what the assistant can do.
- **AIP-07 (P1) Conversations** belong to the deck: stored locally in app data (never in the deck file), listed in History with title and date, searchable, renamable and deletable. Options set the retention and can clear all history.
- **AIP-08 (P1) Usage:** tokens per message; estimated cost for API-key connections from an updatable price table, labelled as an estimate; optional warnings above a cost per turn or per month.
- **AIP-09 (P1) Accessibility:** F6 reaches the pane; streamed text is announced politely in chunks; every control works from the keyboard (A11Y-01…03).

### 10.5 Context and instructions
- **AIX-01 (P1)** Each turn's context is built fresh from the current document, including the user's manual edits since the last message.
- **AIX-02 (P1)** A request contains: (1) Deckhand's instructions (AIX-07); (2) deck facts — detected format and slide selector, slide size, theme variables, fonts, available layouts (ADP-07) and the deck's conventions (classes, units, indentation); (3) an outline with each slide's number, title, layout, hidden state and a short text summary; (4) the current slide's HTML and, for vision-capable models, a picture of it; (5) the selected objects; (6) the user's attachments and @-mentions; (7) the conversation so far, with older tool results shortened; (8) a summary of manual edits since the previous turn ("The user moved 'Logo' on slide 2"), so the model doesn't undo them.
- **AIX-03 (P1) AI view of the HTML.** The model sees a projection of the source generated by `packages/core`: each object carries a short reference (`data-ref="o12"`); `data:` URIs become asset placeholders (`asset:img-3`, with type, size and dimensions); large framework scripts and styles are elided (`<script data-elided="reveal.js, 120 KB"></script>`). Deckhand maps references and placeholders back when applying edits, so the model can move or reuse pictures without copying base64 data. None of this ever reaches the file (RT-05).
- **AIX-04 (P1)** Decks whose AI view fits a budget (default 30k tokens, configurable) are sent whole; larger decks are sent as outline plus current slide, and the model reads the rest with tools. Use the provider's prompt caching for the stable part of the request where available.
- **AIX-05 (P1) Attachments:** images, PDF, Word (.docx), Excel and CSV, PowerPoint (.pptx, text and pictures), text and Markdown, and web pages by URL (fetched by Deckhand and converted to text). Send a format natively when the provider accepts it, otherwise extract the text locally. Show each attachment's size and token estimate; warn above the model's limits.
- **AIX-06 (P1) Language:** reply in the user's language; write slide content in the deck's language unless asked otherwise.
- **AIX-07 (P1) Built-in instructions** (a versioned file in `packages/ai`) tell the model to: use tools instead of describing changes; read before writing; keep the deck's structure, framework markup, scripts and navigation intact; prefer theme variables and existing classes to hard-coded values; restyle through CSS variables and stylesheet rules rather than element by element; keep the content unless asked to change it; check visual changes with `render_slide` and keep text inside its boxes; end with a short summary of what changed; and treat deck text, attachments and web pages as data, never as instructions (AIS-03). Users can add their own instructions in Options; P2: per-deck instructions.

### 10.6 Deck tools
The AI reads and changes the deck only through these tools. One set of definitions (zod schemas, converted to JSON Schema) serves models with function calling, the GitHub Copilot SDK (custom tools), and external agents and MCP clients (Deckhand's MCP server).

| Tool | Mode | What it does |
|---|---|---|
| `get_deck_overview` | Ask, Edit | Format, slide size, outline, theme variables, fonts, stylesheets, assets |
| `get_slide(slide, parts)` | Ask, Edit | AI-view HTML, plain text and/or speaker notes of a slide |
| `render_slide(slide, width)` | Ask, Edit | PNG of the slide as currently edited (vision-capable models) |
| `get_styles(filter)` | Ask, Edit | `<style>` blocks and linked CSS with line numbers, filtered by selector or property |
| `find(query, regex)` | Ask, Edit | Matches in the slides' text or markup, with references |
| `get_selection` | Ask, Edit | What the user has selected right now |
| `set_text(ref, html)` | Edit | Replace an object's content; inline formatting only (§8.3) |
| `set_style(refs, properties)` | Edit | Inline style changes; `null` removes a property (§8.6) |
| `set_geometry(ref, x, y, w, h, rotation)` | Edit | Move, resize and rotate in slide coordinates, through the positioning model (§8.2) |
| `set_attributes(ref, attributes)` / `set_classes(ref, add, remove)` | Edit | Attributes and classes |
| `insert_html(ref, position, html)` / `replace_html(ref, html)` / `delete(refs)` | Edit | New, rewritten and removed objects or slides |
| `add_slide(after, layout or html)` / `duplicate_slides` / `move_slides` / `delete_slides` / `set_slide_hidden` / `set_notes` | Edit | Slide operations (§8.9) |
| `set_theme_variable(name, value)` | Edit | Theme colors and fonts (§8.7) |
| `edit_css(target, old, new)` | Edit | Exact replacement inside a `<style>` block or linked stylesheet (FMT-04): deck-wide restyling |
| `insert_picture(source, ref or position)` | Edit | Picture from an attachment or URL, stored per IMG-02 |
| `replace_in_source(old, new)` | Edit | Last resort: exact replacement in the HTML source; must match exactly once |

- **AIT-01 (P1)** Write tools validate their input — references exist and lie inside slides, aren't deck chrome or generated content, HTML and CSS parse — then run as ordinary commands (ARCH-02) and return a short result, or an error the model can act on ("Reference o12 no longer exists — call get_slide(3)").
- **AIT-02 (P1) Stale-write protection:** reads return a version per slide; a write carrying an outdated version (the user or another tool changed the slide since) is rejected with a request to read again.
- **AIT-03 (P1)** HTML written by the AI is sanitized like pasted HTML (TXT-11) — no `<script>`, event handlers, `javascript:` URLs or new external resources unless allowed (AIS-04) — and re-indented to match its surroundings (RT-04).
- **AIT-04 (P1) Limits per turn,** all configurable: tool calls (default 40); changed slides before asking ("This changes 18 slides — continue?"); size of HTML written.
- **AIT-05 (P2)** `generate_image(prompt, size)` when the connection offers an image model; the picture is inserted per IMG-02.
- **AIT-06 (P2) Edit-block format** for models or connections without tool calling (AIC-09, some local models): the model writes its changes as fenced `deckhand-edit` blocks containing the same operations as JSON; Deckhand validates each block and shows it with an **Apply** button.

### 10.7 Applying, reviewing and undoing AI changes
- **AIE-01 (P1) Modes:** Ask offers only the read tools; Edit offers all of them. The mode is shown in the composer and remembered per conversation.
- **AIE-02 (P1)** Changes apply live while the model works, and the affected slides are marked in the slide pane. During a turn, manual editing pauses (navigation, zoom and selection still work) under a bar "AI Assistant is editing… [Stop]". Stop cancels the request and keeps the changes made so far, which remain undoable.
- **AIE-03 (P1)** All changes from one turn form **one undo step**, named after the request ("AI: Translate the slides into Italian").
- **AIE-04 (P1) Change card:** each Edit turn ends with a card in the chat listing the changes by slide, with thumbnails, and three actions: **Keep** (closes the review), **Undo all**, and **Undo** per slide when no later change depends on it. Changed slides keep a badge in the slide pane until reviewed. P2: before/after comparison on the canvas.
- **AIE-05 (P1) Ask before applying** (Options): the turn runs against a copy of the document; Deckhand then previews the changes and applies them only after **Apply**.
- **AIE-06 (P1) Checkpoints:** every user message records the document version; "Restore to before this message" returns the deck to that point as one undoable command and greys out the later messages.
- **AIE-07 (P1)** AI changes follow every fidelity rule (§6.3): the parts of the file the AI didn't change stay byte-identical (TST-09).
- **AIE-08 (P1)** Saving stays manual (AutoRecover still runs): AI changes reach the disk only when the user saves.

### 10.8 Quick actions
- **AIQ-01 (P1) Text actions** in the mini toolbar and context menu — AI ▸ Rewrite, Shorten, Expand, Fix spelling and grammar, More formal, More friendly, Translate to…: one-shot Edit turns on the selected text, previewed in place with **Keep**, **Discard** and **Try again**, without opening the pane.
- **AIQ-02 (P1) Prompt gallery**, like Office's prompt library: built-in and user-saved prompts, available in the pane and through `/` in the composer.
- **AIQ-03 (P2)** Slide pane context menu: Write speaker notes, Suggest a better layout, Split into two slides, Merge into one slide. Also P2: File › New › From a prompt (generate a whole deck).

### 10.9 MCP server mode
For people who would rather chat in their AI provider's own app — the most direct way to use a chat plan:
- **AIM-01 (P1)** An optional built-in MCP server, off by default, exposes the deck tools of the presentations open in Deckhand: Streamable HTTP on `127.0.0.1` with a random port and a bearer token (Host and Origin headers checked), plus a `deckhand mcp` stdio command for clients that only support stdio. The first time a client connects, the user approves it ("Allow Claude Desktop to read and edit your open presentations?").
- **AIM-02 (P1)** Options › AI › "Use Deckhand from other AI apps" gives step-by-step setup and copyable configuration for apps that support local MCP servers — e.g. Claude Desktop (P2: a one-click desktop extension), Claude Code, Codex, VS Code with GitHub Copilot, and Google's agent apps.
- **AIM-03 (P1)** Changes arriving through MCP follow §10.7: calls are grouped into one undo step until 5 s pass without a call or the user edits; their change cards appear in the pane under "From other apps"; a status-bar indicator shows connected clients, and one click disconnects them.

### 10.10 Security and privacy
- **AIS-01 (P1)** The first time a connection is used, Deckhand states what is sent and to whom ("Slide content, pictures of slides and your attachments are sent to Anthropic"), linking to the provider's privacy terms. Options can turn off sending slide pictures, attachments or fetched web pages.
- **AIS-02 (P1)** The model can only call deck tools: it can't read or write other files, run commands, change settings, turn on deck scripts or blocked content, save, export or open links.
- **AIS-03 (P1) Prompt injection:** deck text, notes, attachments and web pages may contain instructions written by someone else. They are passed as clearly marked data, and the limited tool set bounds what an injected instruction could do. Web pages are fetched only when the user attaches them; web search runs only when the user turns it on.
- **AIS-04 (P1)** Scripts, event handlers and new external resources in AI-written HTML are removed unless the user turns on "Allow the AI to add scripts and external content" (Trust Center, off by default); when it's on, such additions are flagged in the change card.
- **AIS-05 (P1)** Prompts and responses are never logged unless AI debug logging is on; keys and tokens are always redacted.
- **AIS-06 (P1) Administrator policy** (§11): turn AI off entirely; allow only listed connection types or endpoints (e.g. only the company's Azure OpenAI); turn off attachments, web search, external agents or MCP server mode; set cost warnings.
- **AIS-07 (P1)** Credentials follow AIC-08, and all AI network calls are made from the main process.

### 10.11 Implementation notes
- `packages/ai` (no Electron or React dependency, like `packages/core`): conversation model, context builder and AI-view serializer, tool definitions, agent loop, edit-block parser, token estimates, price table.
- `apps/desktop/src/main/ai`: connections and credentials, provider clients, OAuth loopback helper (PKCE on `127.0.0.1`), ACP client, Copilot SDK host, MCP server.
- The agent loop runs in the **main process**, so credentials never reach the renderer and CORS doesn't apply. Tool calls go over typed IPC to the editor window of the target document — where the source model and commands live (§6.1) — and results come back to the loop. External agents and MCP clients reach the same tool executor. `render_slide` reuses the offscreen renderer of RND-09.
- Libraries (latest stable at implementation, §6.10): the Vercel AI SDK (`ai` with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/azure`, `@ai-sdk/openai-compatible`, and the Bedrock and Vertex providers) for streaming and tool calling; a small dedicated client for the ChatGPT plan route because of its required Responses API settings (AIC-04); the GitHub Copilot SDK; `@agentclientprotocol/sdk` for ACP; `@modelcontextprotocol/sdk` for the MCP server.
- Start with SPIKE-5 (§6.12).

---

## 11. Options and Trust Center

**OPT-01 (P1; settings needed by P0 features ship with them)** Office-style Options dialog:

| Category | Settings |
|---|---|
| General | UI language, app theme, accent color, user name (lock files, comments), start on Backstage Home |
| Editing | Units (POS-04), nudge distances, snapping and smart-guide defaults, "typing replaces selected text" (TXT-02), hover outlines, picture storage and downscaling (IMG-02/03), default paste, undo limit |
| Save | AutoRecover interval, versions kept, metadata in file vs sidecar (RT-06), export defaults, reload on external change |
| Proofing | Spell-check languages, check while typing |
| Trust Center | Deck scripts (SEC-06), external content (SEC-05), files outside the folder (SEC-03), Protected View, Trusted Locations (P2), AI edits that add scripts or external content (AIS-04) |
| AI | Connections (AIC-01); default mode (Ask/Edit) and live apply vs Ask before applying (AIE-05); custom instructions (AIX-07); sending slide pictures, attachments and web pages (AIS-01); limits per turn (AIT-04); cost warnings (AIP-08); conversation retention and Clear AI history (AIP-07); external agents (AIC-06); "Use Deckhand from other AI apps" (AIM-02) |
| Advanced | Default design viewport, thumbnail quality, hardware acceleration (turning it off helps some Linux GPUs), log level, reset all settings |
| Customize (P2) | Quick Access Toolbar, ribbon, keyboard shortcuts |

Settings are stored as JSON in the OS app-data folder. P1: an administrator policy file (system-wide JSON) that can lock Trust Center, update (PLT-06) and AI (AIS-06) settings. P2: portable mode.

---

## 12. Help and onboarding
- **HLP-01 (P1)** First run: Backstage Home with Open, recent files and "Try a sample deck" (a bundled deck containing every typical element), plus a dismissable five-step tour: slide pane → click & drag → double-click to edit text → Format pane → Save.
- **HLP-02 (P1)** Search box (Alt+Q) covering commands, settings, recent files and help topics.
- **HLP-03 (P1)** Offline help (F1): short task-based articles bundled as Markdown — moving things, editing text, changing pictures, theme colors, "Why can't I edit this?", security notices, exporting, connecting an AI account and who pays for it.
- **HLP-04 (P0)** Every limitation message has a "Why?" link to the relevant explanation.
- **HLP-05 (P1)** Help › Keyboard Shortcuts (searchable), Copy Diagnostic Info, Open Log Folder; About shows the version and licenses.

---

## 13. Testing and quality
- **TST-01 (P0) — Test corpus** in `test-decks/`, created by Claude Code, small and freely licensed, with framework files vendored so tests run offline:
  1. reveal.js deck — horizontal and vertical slides, notes, backgrounds, a hidden slide
  2. Marp HTML export
  3. impress.js deck
  4. Shower deck
  5. AI-style deck: fixed 1920×1080 stage scaled by JS, absolutely positioned objects
  6. AI-style responsive deck (vw/vh, flex/grid) using the Tailwind Play CDN (with an offline copy)
  7. Active-class navigation with fade transitions and entrance animations
  8. Scroll-snap vertical deck
  9. Deck with Chart.js charts and inline SVG icons
  10. Deck with base64 images and Google Fonts
  11. Multi-file deck: external CSS/JS, an `assets/` folder, a `../` reference
  12. windows-1252 + CRLF, UTF-8 with BOM, mixed indentation, comments, entities
  13. Malformed HTML (unclosed tags, stray `</div>`)
  14. Large deck: 100 slides, 30 MB
  15. **Hostile deck**: infinite loop, `window.open`, top navigation, `fetch('file:///…')`, `../../` reads, forged messages to the bridge script, hidden text with instructions aimed at the AI Assistant, huge memory allocation
  16. Plain web page without slides
  17. The owner's real sample decks (Q1)
- **TST-02 (P0) — Round-trip and golden diffs.** For every corpus deck: a no-op save is byte-identical; scripted edits (edit text, move, resize, change color, insert a text box, add/delete/reorder slides, change a picture, change a theme color) produce exactly the stored golden diffs; the RT-05 artifact check runs on every save.
- **TST-03 (P0)** Unit tests (Vitest) for `packages/core`: patch engine, serializer, style-attribute editing, adapters and detection, units and coordinate math, text normalization, sanitizer. At least 80 % coverage for core.
- **TST-04 (P0)** End-to-end tests (Playwright for Electron): open → select → drag → save → verify file; double-click → type → bold → undo/redo; new slide from a layout; reorder; insert and change a picture; theme color; PDF export (pages = slides); recovery after a simulated crash; hostile deck contained while the UI stays responsive.
- **TST-05 (P1)** Visual regression: canvas rendering vs headless Chrome for corpus decks, with tolerance.
- **TST-06 (P0)** CI on Windows, macOS and Linux (xvfb): lint, typecheck, unit, E2E, packaging; installers uploaded as artifacts.
- **TST-07 (P1)** `docs/QA_CHECKLIST.md`, run manually on all three OSes before each release: install/uninstall, "Open with", HiDPI, dark mode, multi-monitor slide show, IME input, spell-check, saving to a network drive and a synced folder, offline use.
- **TST-08 (P1)** Benchmarks for the PERF metrics in CI; fail on a regression above 20 %.
- **TST-09 (P1) AI tests** with a mock provider that replays scripted streams and tool calls: golden diffs for every write tool; undo, change cards, checkpoints and cancellation; stale-write rejection; sanitizing of AI-written HTML; injected instructions in the hostile deck can't reach files, network or settings; credentials never appear in settings files, logs or IPC to the renderer.
- **TST-10 (P1)** Integration tests with a sample ACP agent and an MCP client (from the SDKs' examples); provider contract tests, run on demand with real keys.
- **TST-11 (P1) AI evaluation set:** about 25 realistic requests on corpus decks — fix spelling, translate, shorten, add a slide from an attachment, move and resize, restyle with a dark theme, change fonts, make a slide more visual — with a pass/fail rubric, run with at least one model per supported connection type before each release; results in `docs/AI_EVALS.md`.

---

## 14. Later (P2) ideas
- **Agent notes** (as in HTML Deck): pin a note to an object ("make this shorter"), stored in the file, for the AI Assistant or an AI coding agent such as Claude Code to apply later.
- AI Assistant P2 items (§10): Microsoft 365 Copilot, Bedrock and Vertex connections, OpenRouter sign-in, image generation, the edit-block format, whole-deck generation from a prompt, per-deck instructions, before/after comparison.
- Comments stored in the HTML for review rounds (as in Decktly).
- Animations tab for formats that support it (reveal.js fragments and transitions, Animation Pane).
- Presenter view and rehearsed timings.
- Editable charts (data grid → SVG; Chart.js adapter).
- Templates and File › New.
- Folder-of-slides decks; Remark Markdown editing.
- Accessibility checker.
- Customizable ribbon, QAT and shortcuts; KeyTips.
- Touch and pen input (tap, drag, pinch) for Windows tablets.
- Plugin API for adapters and object types.
- Real-time collaboration.
- PowerPoint import.
- A web (PWA) edition reusing `packages/core` and `packages/ui`.

---

## 15. Milestones

| Milestone | Scope | Definition of done |
|---|---|---|
| **M0 — Foundations** | Monorepo; Electron shell with SEC-01; React + Fluent skeleton (title bar, empty ribbon, panes, status bar); light/dark; i18n scaffolding; CI building installers for all three OSes; SPIKE-1 | CI produces Windows, macOS and Linux installers; the app launches on all three; SPIKE-1 documented |
| **M1 — Open, render, round-trip** | Source model + patch engine (SPIKE-2); document protocol; sandboxed live view + bridge script; generic and reveal.js adapters + Define Slides wizard (SPIKE-4); thumbnails; navigation; design viewport and zoom; Save (RT-01); AutoRecover; external-change detection | Every corpus deck opens and renders like Chrome; RT-01 passes for all of them; the hostile deck is contained |
| **M2 — Core editing** | Selection; overlay; move/resize/rotate with the positioning model and units (SPIKE-3); smart guides; nudge; text editing with basic formatting; undo/redo; clipboard; Format pane (Size & Position, Fill, Border, Text); status-bar path; context menus | Golden diffs pass; move/resize/text E2E tests pass on all three OSes |
| **M3 — MVP: the Office experience** | Ribbon with all P0 commands; Backstage; QAT; contextual tabs; tooltips; message bars; shortcuts; slide operations with the layout gallery; pictures (insert/change); text box; links; theme colors; Format Background; Slide Show and browser preview; PDF export; Document Recovery UI | All P0 requirements met → **v0.9 (MVP)** |
| **M4 — AI Assistant** | §10 P1 requirements, starting with SPIKE-5: connections (API keys, Azure OpenAI / Microsoft Foundry, Continue with ChatGPT if eligible, GitHub Copilot, external agents), the pane, context and AI view, deck tools, review and undo, quick actions, MCP server mode, AI security | TST-09 and TST-10 pass on all three OSes; the evaluation set (TST-11) passes with the agreed models |
| **M5 — v1.0** | All remaining P1 requirements: Format Painter, find/replace, Selection Pane, align/distribute/group, shapes, tables, icons, crop, picture styles, fonts, apply-to-all-similar, Code view, spell-check, Version History, PNG and single-file export, Options and Trust Center, Protected View, Marp/impress/Shower adapters, page mode, accessibility, help and onboarding, auto-update, signing | All P1 requirements met; QA checklist passed on all three OSes → **v1.0** |
| **M6+** | P2 items, prioritized with the owner | — |

M4 and M5 can be swapped if the owner wants the rest of v1.0 before the AI Assistant.

---

## 16. Open questions and default assumptions
Claude Code asks these before Milestone 1; if they stay unanswered, it proceeds with the defaults.

| # | Question | Default |
|---|---|---|
| Q1 | Which tools generate your decks? Please share 3–5 real examples — they join the test corpus and tune slide detection. | AI-generated single-file decks, plus reveal.js |
| Q2 | Are decks usually one self-contained file, or a folder with assets? | Both supported; single file most common |
| Q3 | Final name, icon and license (internal tool or open source)? The license also matters for AI: OpenAI currently offers ChatGPT plan usage to open-source and local personal apps, while other apps must apply (AIC-04). | "Deckhand", placeholder icon, private repository |
| Q4 | Internal distribution (unsigned builds acceptable) or public (requires an Apple Developer ID and a Windows code-signing certificate)? | Unsigned internal builds first; signing configured but optional |
| Q5 | UI languages besides English? | English only at launch, i18n-ready |
| Q6 | Do colleagues edit the same files on shared drives (lock files) or through Git? Are comments needed? | Single-user editing; lock files and comments are P2 |
| Q7 | Is PDF export enough, or is PowerPoint export (slides as pictures) needed? | PDF in the MVP; PPTX pictures in P2 |
| Q8 | Corporate constraints: proxy, offline machines, MSI/Intune deployment, locked-down settings? | Per-user installers, system proxy support |
| Q9 | Which AI accounts do the users have — API keys, Claude Max/Team, ChatGPT Plus/Pro, GitHub Copilot, Microsoft 365 Copilot, a company Azure OpenAI / Foundry? Does "Copilot" mean GitHub Copilot or Microsoft 365 Copilot? | API keys (Anthropic, OpenAI, Gemini), Azure OpenAI, Continue with ChatGPT and GitHub Copilot in M4; Microsoft 365 Copilot in P2 |
| Q10 | May presentation content be sent to external AI providers under company policy, and to which ones? | AI stays inactive until a connection is added; administrators can restrict providers (AIS-06) |

---

## Appendix A — Editor metadata stored in files
Written only when the user uses the related feature (RT-06):

| Data | Stored as | Written when |
|---|---|---|
| Object name | `data-deckhand-name="Logo"` | The user renames an object in the Selection Pane |
| Lock | `data-deckhand-locked` | The user locks an object |
| Manual slide definition | `<meta name="deckhand:slides" content="main > section.page">` | The user confirms Define Slides |
| Guides | `<meta name="deckhand:guides" content="v:960;h:540">` | The user adds guides |
| Notes in generic decks (P2) | `<template data-deckhand-notes>…</template>` inside the slide | The user writes notes in a generic deck |

**Never written:** `data-deckhand-id`, the bridge script, AI-view references (`data-ref`) and asset placeholders (AIX-03), editor stylesheets, `contenteditable`, `spellcheck`, selection/hover classes, temporary visibility or animation overrides. With the sidecar option (RT-06), everything above except notes goes to `<deck>.deckhand.json` instead.

## Appendix B — Generic slide detection

**B.1 Candidates.** Groups of two or more sibling elements under one parent, searching `body` and up to four levels of single wrappers (`main`, `#app`, `.deck`, `.slides`, `.presentation`…). Both a static pass (source) and a live pass (after load and layout) feed the scores.

**B.2 Scoring signals** (indicative weights; tune them on the corpus):

| Signal | Weight |
|---|---|
| Shared class token matching `slide`, `page`, `step`, `frame`, `scene` | +4 |
| Every sibling has the same tag (`section`, `div`, `article`) | +2 |
| Attributes such as `data-slide`, `data-index`, `id="slide-3"` | +2 |
| Similar rendered sizes, each ≈ the viewport or a fixed stage; 16:9 or 4:3 | +3 |
| Exactly one visible after load, the others hidden (JS deck) | +3 |
| Stacked vertically, each ≥ 90 % of viewport height, scroll-snap on the container | +3 |
| A script handling arrow/space/Page Down keys | +1 |
| Element is navigation/UI (buttons, progress bar, counter, hints) | −5 → excluded and reported as deck chrome |

**B.3 Active-state detection.** Compare the visible slide with the hidden ones: class tokens present only on the visible one (`active`, `current`, `present`, `visible`, `is-active`…), attributes (`aria-hidden`, `hidden`, `data-state`) and inline `display`/`opacity`/`transform`. The difference tells Deckhand how to show slide N in design mode — applied to the live DOM only, never saved.

**B.4 Confidence.** Normalize the score to 0–1. At 0.8 or above, accept it and show the "Found N slides. [Looks right] [Define slides…]" bar on first open. Below 0.8, open the Define Slides wizard.

## Appendix C — References
- Decktly — https://alternativeto.net/software/decktly/about/
- HTML Deck — https://pypi.org/project/htmldeck/
- slides-grab — https://www.sourcepulse.org/projects/27165882
- B6+ slide editor — https://bert-github.github.io/b6plus-slide-editor/
- GrapesJS — https://github.com/GrapesJS/grapesjs
- Onlook — https://onlook.com/features/visual-editor
- Desktop runtimes compared (Electron, Tauri and others) — https://docs.deno.com/runtime/desktop/comparison/
- Tauri CEF runtime (alpha) — https://docs.rs/crate/tauri-runtime-cef/latest
- Electron security checklist — https://www.electronjs.org/docs/latest/tutorial/security
- Fluent UI React v9 — https://react.fluentui.dev/
- Sign in with ChatGPT, plan usage for apps (OpenAI) — https://developers.openai.com/siwc/token-sharing-open-source
- Sign in with ChatGPT, preview limitations — https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- Sign in with ChatGPT, UI/UX guidelines — https://developers.openai.com/siwc/ui-ux-guidelines
- Use the Claude Agent SDK with your Claude plan (Anthropic) — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Monthly API credits for Max and Team plans (Anthropic) — https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
- Claude Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview
- Gemini CLI terms of service — https://www.geminicli.com/docs/resources/tos-privacy
- Gemini API billing and free tier — https://ai.google.dev/gemini-api/docs/billing
- GitHub Copilot SDK — https://github.com/github/copilot-sdk
- Microsoft 365 Copilot Chat API — https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/overview
- OpenRouter OAuth PKCE — https://openrouter.ai/docs/use-cases/oauth-pkce
- ACP Registry — https://agentclientprotocol.com/registry
- Zed external agents and existing subscriptions — https://zed.dev/docs/ai/external-agents · https://zed.dev/docs/ai/use-an-existing-subscription
