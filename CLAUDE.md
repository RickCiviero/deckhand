# Deckhand — contributor notes

Visual editor for HTML presentations. Spec: `docs/SPEC.md`. Decisions: `docs/DECISIONS.md`. Threat model: `docs/SECURITY.md`.
Priority on conflicts: **security → file fidelity → Office familiarity → breadth.**

## Commands
```
npm install                 # also downloads the Electron binary (scripts/ensure-electron.mjs)
npm run dev                 # builds the agent, starts electron-vite
npm run build               # agent bundle + electron-vite (out/)
npm run typecheck           # tsc -p tsconfig.json
npm test                    # vitest: packages/**  (core + ui geometry)
npm run test:coverage
npm run e2e                 # builds, then Playwright-on-Electron (e2e/*.spec.ts)
npm run dist                # electron-builder for the current OS (apps/desktop/release)
npm run gen:decks           # regenerate test-decks/ (committed; fixtures are byte-exact, see .gitattributes)
npm run screenshot -- <deck.html> <out.png>   # launches the built app, saves a PNG (Playwright screenshots work too)
```
Run the e2e suite against a packaged test build: `electron-builder --win --dir -c.directories.output=release-test -c.electronFuses.enableNodeCliInspectArguments=true`, then `DECKHAND_EXE=<…/Deckhand.exe> npx playwright test`.

## Architecture
- `packages/core` — pure TS, no DOM/Electron. `source.ts` (parse5 offsets), `patch.ts`, `style.ts` (position-preserving inline CSS), `commands.ts` (`Editor` + undo + commands), `sanitize.ts`, `adapters.ts` (generic/reveal/page detection), `paths.ts` (protocol containment), `encoding.ts` (BOM/windows-1252/EOL), `liveview.ts` (editor ids + agent injection).
- `packages/agent` — script injected into the live view only; talks over a private `MessagePort`. Built by `build.mjs` to `dist/agent.js`, imported into main with `?raw`.
- `packages/ui` — React + Fluent v9. `session.ts` is the brain (Editor ⇄ agent, zod-validated messages); `Canvas.tsx` overlay (select/move/resize/guides); `geometry.ts` pure positioning math; `actions.ts` shortcuts/commands; `FormatPane.tsx`.
- `apps/desktop` — Electron main (`docs.ts` registry + `deckhand-doc://` protocol, `index.ts` windows/IPC/hardening), preload bridge, renderer entry.

## Rules that matter
- The live DOM is **never** serialized. All edits are patches on the source text; saving a no-op is byte-identical. New code that writes to the file goes through `Editor.exec` and must keep that property (add a golden test).
- Never trust the agent or the deck: validate with zod, cap sizes, never derive paths from messages.
- Never put layout CSS on `FluentProvider` (see ADR-007). Don't add `eval`/inline scripts to the UI (CSP).
- Anything written into CSS/attributes goes through `isSafeCssValue`/`escapeAttr`.
- Windows: shell heredocs with quotes are fragile here; write files with the editor tools.

## Testing notes
- e2e helpers (`e2e/helpers.ts`): `launch(deck)` copies `test-decks/` to a temp dir, `ready`, `clickObj` (retries), `dragObj`, `save`.
- Use `app.evaluate(({app}) => app.exit(0))` to close (a normal close blocks on the "Save changes?" dialog).
- Playwright `page.evaluate` bypasses CSP (CDP), so assert CSP via the response header, not via `eval`.
- Cross-platform text editing (learned from CI): Playwright sends literal keys, so use `MOD` (Meta on macOS) not `Control`; enter edit mode with `editAt`/`expectEditing` (retry + settle). The agent must survive a double-click starting the edit twice and the browser blurring the element right after `iframe.focus()` (see `keyedSinceEdit`, the `focusout` guard in `packages/agent`). CI runs e2e with 2 retries; a test that only passes on retry is reported "flaky" — treat that as a bug to chase, not noise.
