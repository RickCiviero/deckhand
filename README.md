# Deckhand

Open an HTML presentation, edit it the way you would in PowerPoint — click, drag, type — and save it back as the **same HTML file, changed only where you changed it**.

> Status: early version (milestones M0–M2 of `docs/SPEC.md`). CI (typecheck, unit, e2e, installers) is green on Windows, macOS and Linux; developed and manually exercised on Windows.

## What works today
- Opens AI-generated single-file decks, reveal.js-style decks, scroll-snap decks and plain pages; detects slides automatically.
- Click to select, drag/resize with smart guides, arrow-key nudge, marquee, Esc for parent, right-click menu.
- Double-click to edit text; bold/italic/underline; Format pane for position, size, fill, border, opacity, text; theme colours from CSS variables; text boxes; duplicate/delete/reorder slides; undo/redo; copy/paste.
- Saving a deck you did not change is **byte-identical**; edits touch only the element you edited (encoding, BOM, line endings, comments, entities and indentation are preserved).
- External-change detection, AutoRecover snapshots, atomic saves.

## Security in one paragraph
A deck is treated as hostile code. It runs in a sandboxed iframe on its own origin, cannot reach the editor, files outside its folder, the network (if you switch that off), permissions, popups or navigation, and a deck stuck in an infinite loop cannot freeze the editor. See `docs/SECURITY.md` for the threat model and how each control is tested.

## Develop
```
npm install
npm run dev            # run the app
npm test               # unit tests
npm run e2e            # end-to-end tests (launches the real app)
npm run dist           # installer for the current OS
```
More in `CLAUDE.md`, `docs/DECISIONS.md` and `docs/IMPLEMENTATION_PLAN.md`.
