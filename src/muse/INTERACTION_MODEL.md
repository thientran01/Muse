# Muse — Canvas interaction model

How direct manipulation works once Muse is on: one activation, one selection, and
gestures that map to deterministic source edits.

## The model

One activation: the Muse FAB (or the `R` hotkey). While Muse is on, the page is
selectable and each gesture acts on the element under the cursor:

| Gesture | What it does | Cost |
|---|---|---|
| Hover | highlight the element + show its source crumb | — |
| **Plain click** | select it; the properties card floats by the element | free, deterministic |
| Alt-click | step out to the parent | — |
| Double-click | edit the text in place | free |
| Drag | move the element among its siblings to reorder it | free |
| Esc | deselect, then turn Muse off | — |

- **The properties card floats by the element** — it's about that element, and your
  eye is already there.
- Every edit (spacing, size, type, color, text, reorder, token) is a known
  transform, so Muse applies it **without a model call** — instant, key-free, and
  reversible.

## Selection

A single `selected` channel, set on every click and read by the canvas chrome
(outline, box-model bands, resize knobs, the properties card). Clicking a child
drills in; clicking a sibling or anything else retargets — there's never a
stranded second selection. The breadcrumb in the properties card jumps to any
ancestor directly.

## History

Undo / redo / revert run on one shared stack. Each Canvas commit lands on it, and
`Cmd`/`Ctrl`+`Z` (undo) / `Cmd`/`Ctrl`+`Shift`+`Z` (redo) work anywhere on the
page; the toolbar carries the same controls plus a revert-to-original. In the
ephemeral demo, edits stay in the browser and undo/redo replay DOM snapshots.

## Cohesion rule

Any new interaction or motion uses the existing design-system tokens (`EASE`/`DUR`,
the overlay CSS vars, the `animate-muse-*` keyframes) — no one-off curves or colors.
