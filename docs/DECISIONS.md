# Decisions (ADR log)

Priority when requirements conflict (SPEC §0.8): **security → file fidelity → Office familiarity → feature breadth.**

## ADR-001 — Defaults for open questions (SPEC §15)
Owner has not answered Q1–Q8, so the spec defaults apply: AI-generated single-file decks plus reveal.js; internal tool, private repo; English only (i18n-ready); unsigned builds; single-user editing; PDF later.

## ADR-002 — SPIKE-1 (process isolation): result
The live view is a cross-origin iframe (`deckhand-doc://<random>`) with `sandbox="allow-scripts allow-same-origin"`. The origin differs from the editor (`deckhand-app://ui`), so `allow-same-origin` does not give the deck access to the editor. E2E `hostile.html` runs `while(true){}` for 25 s, allocates hundreds of MB and tries every escape; the editor UI stays responsive (click → slide change < 3 s) and the heartbeat watchdog offers "Reload with scripts off". No fallback to `WebContentsView` was needed.

## ADR-003 — Live page is served once, to one navigation
Custom-protocol requests carry no `sec-fetch-*` headers, so "is this a navigation?" cannot be detected from headers. Instead each load gets a single-use `?k=` key in the iframe URL. Only the request presenting the key receives the bridge-injected page; a deck that `fetch()`es its own URL (or replays the key) receives the plain source. The bridge's handshake token is baked into the script text, never an attribute, and the script element removes itself.

## ADR-004 — `../` never reaches the protocol handler
Chromium normalises `/../x` and `%2e%2e` before `protocol.handle` runs, so traversal degrades to a 404 inside the folder. The handler still enforces containment (decoded-path sanitising + `realpath` + prefix check; covers symlinks/junctions, UNC, drive letters, ADS, reserved device names). Because the browser hides the intent, the editor scans the source for outside references (`findOutsideRefs`) to show the "uses files outside its folder" message bar (SEC-03). The "Allow" choice is not implemented: outside files are always blocked.

## ADR-005 — CSP is attached in the protocol handler
`webRequest.onHeadersReceived` does not run for `protocol.handle` responses, so the editor UI's strict CSP (`default-src 'none'; script-src 'self'; object-src 'none'; frame-src deckhand-doc:` …) is set on the `deckhand-app://` response itself. A test asserts the header and that injected inline scripts do not run.

## ADR-006 — Deck-request detection by frame, not referrer
Decks are served with `Referrer-Policy: no-referrer`, so the remote-content policy (SEC-05) and the `file:` block identify deck traffic by `details.frame.url`. (A first version used the referrer and silently never blocked anything; caught by the e2e policy test.)

## ADR-007 — Layout class never goes on the Fluent provider
Fluent copies the provider's `className` onto every portal (tooltips). Putting layout CSS on the provider produced ~15 full-viewport opaque layers over the UI. Layout lives on a wrapper `div`.

## ADR-008 — Text editing is structure-aware
Committing `innerHTML` from the live DOM would silently change files in two cases: (a) the HTML parser restructures malformed markup (a stray unclosed `<b>` is re-opened in later slides); (b) scripts rewrite content. At edit start the bridge compares text *and* element sequence with the source. Mismatch → refuse; "quirk" (parser-made structure over a tag-free source) → write back plain text only. Committed markup keeps `class`/`id`/`data-*`/`aria-*`, cleaned `style`/`href`; original `<b>`/`<i>` are not renamed; named entities from the source (`&mdash;`, `&nbsp;`) are restored; characters the file's encoding cannot hold become numeric references.

## ADR-009 — Element ids are document-order ordinals
`data-deckhand-id` = index in source order. Style/attribute edits keep ids stable and update the live view in place; structural edits (text with new inline tags, slide add/delete/reorder, paste) reload the live view and re-detect slides. Cost: reload on structure change (RND-08 allows it); benefit: no id bookkeeping.

## ADR-010 — Production build cannot be driven by Playwright
The fuse `EnableNodeCliInspectArguments=false` (security) blocks Playwright's inspector attach. E2E runs against `out/` and against a *test variant* of the packaged app that differs only in that fuse (`electron-builder -c.electronFuses.enableNodeCliInspectArguments=true`). A separate test asserts the shipped build's fuses by reading the binary.

## ADR-011 — Spec v1.1 adopted; AI Assistant and `bridge` rename deferred
`docs/SPEC.md` is now v1.1 (adds the AI Assistant, §10, milestone M4). The spec renames the injected script from "agent" to "bridge script" (`packages/bridge`); the code now uses the same name (`packages/bridge`, `data-deckhand-bridge`). The corpus gained Marp, impress.js, Shower, fade/animation, canvas+SVG and remote-resource (Google Fonts, Tailwind CDN) decks plus a hidden AI-injection line in the hostile deck (TST-01 items 2-4, 6-7, 9-10, 15). Third-party framework files are not vendored: the decks reproduce each format's markup only.
