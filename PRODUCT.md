# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: the Office user. Comfortable with PowerPoint, knows no HTML, receives HTML decks from AI assistants (Claude, ChatGPT, Gemini) or colleagues. Secondary: the power user who knows HTML/CSS and wants quick visual tweaks plus direct Code view access. Decks travel by email, shared drives and Git; several colleagues may edit the same deck at different times.

## Product Purpose
Deckhand is a local desktop visual editor for HTML presentations ("PowerPoint for HTML decks"). Open any HTML deck, click, drag and type, save back to the same HTML file changed only where the user changed it, on Windows, macOS and Linux. Success: a PowerPoint user makes common edits within minutes, and the saved file still works in any browser.

## Positioning
Edits are source-text patches, never a serialized live DOM, so a no-op save is byte-identical and untouched markup is never rewritten. Other editors rewrite or convert the deck; Deckhand respects the file.

## Operating Context
Electron desktop app, offline-first. The deck is untrusted code and runs in a sandboxed live view driven by an injected bridge over a private MessagePort. Supports generic, reveal.js and page-style decks. An optional AI Assistant talks directly to the user's own AI provider; there is no Deckhand server or account.

## Capabilities and Constraints
- Select, move, resize, rotate, group, align; table row/column editing; picture styles and crop; embedded and linked web fonts; Version History; PNG and single-file export; Protected View; spell-check; Help and tour; page mode.
- Non-goals for v1: real-time co-editing, accounts, editable .pptx conversion, general website building, editing runtime-drawn content (e.g. Chart.js canvases).
- Conflict priority: security, then file fidelity, then Office familiarity, then feature breadth.
- Honest limits: if something cannot be edited visually, say why and offer the next best way; never fail silently.
- Progressive disclosure: simple controls first, HTML/CSS detail in Advanced sections and Code view.

## Brand Commitments
Working title "Deckhand". Current build uses soft neutrals, an indigo accent and a dark theme with Fluent v9 and icons. Office-style layout, command names, icons and shortcuts are binding where PowerPoint has a convention.

## Evidence on Hand
Spec in `docs/SPEC.md`, decisions in `docs/DECISIONS.md`, threat model in `docs/SECURITY.md`, fixture decks in `test-decks/`, benchmark decks in `test-decks/decks/bench`. No testimonials, customers or usage data exist; do not fabricate any.

## Product Principles
1. Familiar first: when in doubt, do what PowerPoint does.
2. Respect the file: never rewrite what the user did not touch.
3. Progressive disclosure: simple first, HTML/CSS detail out of the way.
4. Honest limits: explain what cannot be edited and offer an alternative.
5. Safe by default: a deck is untrusted code.

## Accessibility & Inclusion
Target WCAG 2.2 AA; the app ships an a11y audit and scrollable panes are keyboard-reachable. Windows, macOS and Linux must look and behave the same. Light and dark themes must both stay supported.
