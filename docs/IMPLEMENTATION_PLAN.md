# Implementation plan and status

Scope agreed with the owner for this iteration: **M0–M2 plus security hardening**, spec defaults for Q1–Q8 (ADR-001), development on Windows (macOS/Linux covered by CI configuration only).

Legend: ✅ done and tested · 🟡 partly done · ⬜ not started

## M0 — Foundations
| Item | Status | Notes |
|---|---|---|
| Monorepo (core/agent/ui/i18n/desktop), TS strict, Vitest, Playwright | ✅ | |
| Electron shell with SEC-01 hardening, fuses | ✅ | fuse state verified from the shipped binary |
| React + Fluent skeleton, light/dark (system) | 🟡 | native title bar; ribbon is a compact 4-tab strip (File/Home/Insert/View), not the full Office ribbon |
| i18n scaffolding (i18next, `en.json`) | ✅ | only main labels externalised so far |
| CI workflow for Windows/macOS/Linux | ✅ | typecheck, unit, e2e (xvfb on Linux, 2 retries on CI), installers; green on all three |
| SPIKE-1 process isolation | ✅ | ADR-002 |
| Installers | 🟡 | unpacked Windows app built and tested; NSIS/DMG/AppImage/deb configured |

## M1 — Open, render, round-trip
| Item | Status | Notes |
|---|---|---|
| Source model + patch engine (SPIKE-2), RT-01/02/05 | ✅ | byte-identical no-op save on all 10 corpus decks incl. windows-1252+CRLF, BOM, malformed |
| Document protocol, sandboxed live view, agent | ✅ | |
| Generic + reveal.js + page adapters (SPIKE-4) | 🟡 | 11/11 corpus decks detected correctly; Marp/impress/Shower ⬜ |
| Define Slides wizard | ✅ | Design > Define Slides…: proposals from the selection and its parents, live match count, selector subset (tag, class, id, attribute, > and descendant); stored as <meta name="deckhand:slides">; Reset restores the file byte-exactly |
| Thumbnails (RND-09) | 🟡 | hidden-window JPEGs, refreshed ≤ ~1 s after an edit; slides reached by pressing → (vertical reveal stacks and non-key decks may show the wrong slide) |
| Design viewport presets, zoom | 🟡 | zoom/fit ✅; fixed 1920×1080 viewport, presets ⬜ |
| Atomic save, external-change detection | ✅ | |
| AutoRecover | 🟡 | snapshots written every 60 s to app data; Document Recovery list on the welcome screen ✅ |

## M2 — Core editing
| Item | Status | Notes |
|---|---|---|
| Selection (deepest, Esc parent, multi, marquee, Alt-cycle) | ✅ | |
| Move / resize with the positioning model (Free → left/top|right/bottom, In layout → `translate`), units, scaled stages | ✅ | rotation ⬜, Make Free / Put back ⬜ |
| Smart guides, snapping, nudge | 🟡 | edges/centres ✅; equal-spacing markers ⬜ |
| Text editing (dbl-click word, click caret, F2/Enter, Esc, IME-safe default editing), B/I/U | ✅ | range-level font/size/colour via agent `fmt` exists; UI exposes B/I/U |
| Undo/redo with coalescing | ✅ | |
| Clipboard (object copy/paste/cut/duplicate) | 🟡 | within one deck; cross-deck/Paste Options ⬜ |
| Format pane: size & position, fill, border, effects, text | ✅ | |
| Theme colours (THM-01), slide dup/delete/reorder, insert text box | ✅ | |
| Context menu, status-bar element path | ✅ | |

## Not started (M3/M4, per scope)
Full ribbon & Backstage, layout gallery, pictures (insert/change), links dialog, Format Background, Slide Show & browser preview, PDF/PNG export, Code view, Selection Pane, group/distribute, shapes/tables/icons, spell-check, Protected View, Options/Trust Center UI, auto-update, signing, Marp/impress/Shower adapters.

## Risks / open questions
- macOS/Linux: e2e passes in CI; Wayland, GPU and AppImage FUSE not tried by hand.
- Q1: sample decks from the owner would tune slide detection (currently verified on generated decks only).
- Decks whose JS rewrites text or builds content at runtime are intentionally read-only (ADR-008); a source-level "edit text in a dialog" fallback (TXT-04) is not built yet.
- Large decks (30 MB+) are untested beyond the 100-slide corpus deck.

## M4 — AI Assistant (status as of spec v1.1)
| Item | Status | Notes |
|---|---|---|
| `packages/ai`: AI view (AIX-03), deck tools §10.6 (all but `insert_picture`, `generate_image`), stale-write guard, sanitising (AIT-03), per-turn limits (AIT-04), Ask/Edit (AIE-01), one undo step per turn (AIE-03), checkpoints (AIE-06), change summary | ✅ | 22 unit tests with a mock provider (TST-09) |
| Providers: OpenAI-compatible + Anthropic over fetch, streaming, friendly errors (AIC-02, AIC-11) | ✅ | contract-tested against local HTTP servers; **not run against real accounts** |
| Connections UI, safeStorage keys in main only (AIC-08, AIS-07), https-only addresses | ✅ | one connection form; no OAuth |
| Pane: connection picker, Ask/Edit, streamed text, steps, change card with Keep / Undo all, Stop, context chip | 🟡 | no history list (AIP-07), prompt gallery (AIQ-02), attachments (AIX-05), cost estimate (AIP-08), @-mentions |
| Quick actions in mini toolbar / context menu (AIQ-01) | ⬜ | |
| Continue with ChatGPT (AIC-04), GitHub Copilot SDK (AIC-05), ACP external agents (AIC-06), Azure Entra (AIC-03), MCP server mode (AIM) | ⬜ | each depends on provider terms re-check (AIG-02) |
| Ask-before-applying (AIE-05), per-slide undo on the card (AIE-04), manual editing paused during a turn with Stop bar (AIE-02) | ✅ | e2e-tested with the mock model. Per-slide undo only when every change is to an existing slide and that slide is still as the AI left it |
| Admin policy (AIS-06), TST-10, TST-11 evaluation set, SPIKE-5 token/cost measurement | ⬜ | needs real accounts |

## Still not started
M3 (full ribbon, Backstage, layout gallery, pictures, links, Format Background, Slide Show, PDF export, Document Recovery UI), M1 gaps (Define Slides wizard, thumbnails, viewport presets), M5 (everything under "Not started" above), `agent` → `bridge` rename (ADR-011). Marp/impress/Shower are detected (core) but live-view slide navigation for them is not wired.

## M3 progress
Done and e2e-tested: Slide Show (F5 / Shift+F5, Esc exits, link confirmation), PDF export (image-based, pdf-lib), Document Recovery UI, thumbnails, Slide Show tab. Preview in Browser, Backstage, full ribbon, layout gallery, pictures, links, Format Background are still open.

### M3 progress (update)
Added and e2e-tested: New Slide gallery from the deck's own layouts + Blank (ADP-07), Format Background, Insert/Change Picture with alt text (files copied to `images/` next to the deck, never overwritten), Home clipboard buttons, text alignment, font colour, Select All.
Still open in M3: Backstage (Info, Recent, Options), Links dialog, Preview in Browser, Define Slides wizard, contextual tabs (Picture Format etc.), message-bar actions for blocked content.

### M3 progress (update 2)
Added and e2e-tested: Backstage (Open + Recent, Info with format/encoding/external domains, Save, Save As, Export PDF), Insert > Link (http(s)/mailto/# only; retargets an existing link), idempotent end-of-edit so Esc followed by Ctrl+S joins one round trip.
Still open in M3: Preview in Browser, Options / Trust Center UI, Define Slides wizard, contextual tabs, changing the detected format from Info.

### M3 progress (update 3)
Added and tested: Options (Trust Center defaults for scripts and remote content, AI on/off, AI external-content permission, tool-call limit), Define Slides wizard, Design tab. Fixed two real bugs found by the new tests: settings patches reset other settings to defaults, and stale geometry measured before an edit could make a nudge lose a pixel.
Still open in M3: contextual tabs.
Hide Slide (reveal.js data-visibility) and remote-content "Ask" mode: done.
Theme Fonts (THM-03, reduced): Design > Fonts lists the families the deck declares and replaces one everywhere (style blocks, inline styles, font custom properties). No web-font linking or embedding yet.
Administrator policy file (AIS-06): done for the settings that exist. Auto-update switch will join it when updates exist.
Preview in Browser (SHOW-03): done. A temporary server on 127.0.0.1 (random port, 128-bit path token, Host-header check, serves the in-memory deck plus files inside the deck folder only; stops on close, quit or after 30 idle minutes). The deck opens at slide 1: no deep link yet.

## M5 progress
Done and tested: Selection Pane (Alt+F10: topmost-first tree, rename → `data-deckhand-name`, hide → inline `display: none`, lock → `data-deckhand-locked`, Show/Hide All; locked objects cannot be moved, resized, nudged or deleted), Define Slides (see M3), Marp/impress/Shower detection, Insert > Link, Insert/Change Picture.
Not done in the Selection Pane: drag to reorder, "generated" markers.
Not started in M5: find/replace, shapes, tables, icons, crop, picture styles, fonts, apply-to-all-similar, Code view, spell-check, Version History, PNG and single-file export, Protected View, page mode polish, accessibility pass, help and onboarding, auto-update, signing, `agent` → `bridge` rename.
Format Painter (STY-04): done. Copies inline visual declarations (colour, background, border, shadow, opacity, font, text) of the selected object to the next one selected; click once or double-click to keep painting, Esc stops. Not copied: size, position, and character formatting inside text runs.
Distribute horizontally/vertically: done (three or more objects, outer two stay). Group and Ungroup (ARR-03): done for contiguous siblings; Free objects keep their visual position, in-layout groups warn. Objects anchored with right/bottom or transformed cannot be grouped yet.

### M5 progress (update 2)
Done and tested: Find and Replace (Ctrl+F / Ctrl+H; plain-text match across all slides, through entities, match case / whole word, replace one or all as one undo step, replacement always escaped), Code view and Split (CodeMirror 6; edits apply as one undo step after 1 s idle or on Apply; selecting an object puts the caret on its start tag, moving the caret selects the object).
Known limits of the Code view: files over 2 MB of source are refused (no folding of long data: URIs yet); an edit that leaves invalid HTML is applied anyway (HTML5 parsing never rejects), where CODE-03 asks for error highlighting; no Edit HTML… dialog (CODE-04); Ctrl+Z inside the code box is the box's own history, the QAT Undo is the document's.
Find and Replace limits: no regular expressions, no Replace Fonts, searches slide text only (not notes or attributes).
