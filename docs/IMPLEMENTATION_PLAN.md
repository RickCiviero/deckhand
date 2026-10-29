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
| CI workflow for Windows/macOS/Linux | 🟡 | written, **not executed** here; macOS/Linux unverified |
| SPIKE-1 process isolation | ✅ | ADR-002 |
| Installers | 🟡 | unpacked Windows app built and tested; NSIS/DMG/AppImage/deb configured |

## M1 — Open, render, round-trip
| Item | Status | Notes |
|---|---|---|
| Source model + patch engine (SPIKE-2), RT-01/02/05 | ✅ | byte-identical no-op save on all 10 corpus decks incl. windows-1252+CRLF, BOM, malformed |
| Document protocol, sandboxed live view, agent | ✅ | |
| Generic + reveal.js + page adapters (SPIKE-4) | 🟡 | 11/11 corpus decks detected correctly; Marp/impress/Shower ⬜ |
| Define Slides wizard | ⬜ | low-confidence decks show a warning bar only |
| Thumbnails (RND-09) | ⬜ | slide pane shows numbered title cards |
| Design viewport presets, zoom | 🟡 | zoom/fit ✅; fixed 1920×1080 viewport, presets ⬜ |
| Atomic save, external-change detection | ✅ | |
| AutoRecover | 🟡 | snapshots written every 60 s to app data; Document Recovery UI ⬜ (IPC exists) |

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
- macOS/Linux behaviour (Wayland, GPU, AppImage FUSE) unverified.
- Q1: sample decks from the owner would tune slide detection (currently verified on generated decks only).
- Decks whose JS rewrites text or builds content at runtime are intentionally read-only (ADR-008); a source-level "edit text in a dialog" fallback (TXT-04) is not built yet.
- Large decks (30 MB+) are untested beyond the 100-slide corpus deck.
