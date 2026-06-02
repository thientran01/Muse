# Muse — unified selection interaction

How Canvas (direct manipulation) and the agent (chat) share one selection, so
neither reads as secondary. Replaces the old model where Canvas was a separate
mode you entered on top of the agent.

## The model

One activation: the Muse FAB. While Muse is on, the page is selectable and the
**gesture decides the surface**:

| Gesture | Surface | Cost | State it touches |
|---|---|---|---|
| Hover | shared highlight | — | — |
| **Plain click** | Canvas (knobs by the element) | free, deterministic | `selected` (live) |
| **Shift-click** | Agent (panel, bottom-right) | fires observe | `agentTarget` + `selected` |
| Alt-click | step to parent (composes with both) | — | — |
| Double-click | edit text in place | free | — |
| Esc | deselect, then exit Muse | — | — |

- **Agent = fixed bottom-right** (it's a conversation; it shouldn't chase the cursor).
- **Canvas panel = floats by the element** (it's about that element; your eye is there).
- **Observe can only fire on Shift-click** — intentional by construction. Plain
  clicks never reach the agent and never spend a token.

### Two selection channels (deliberate)

- `selected` — canvas, **live**, set on every click. Drives the canvas chrome.
- `agentTarget` (the agent's `selection`) — **sticky**, set only on Shift-click.
  Survives plain clicks, so you can canvas element B while the agent still holds
  element A. The agent panel's target chip is the legibility anchor for this.

## Why the change is small

The observe machinery already fires on the agent's selection-change effect
(`openObservation`). We don't rebuild it — we change *what feeds it*. Before,
chat select-mode fed `selection`; now only Shift-click does. Heuristic-instant +
LLM-swap + per-key cache + concurrent-dedup + handoff bubbles all survive.

## Phasing (stacked PRs, self-review + /quick-review each)

| PR | Scope | Status |
|---|---|---|
| **1** | Unify selection: one always-on source, Shift→agent escalation; retire `useSelection` + chat select-mode + the separate Canvas mode/pill/L-key. | in progress |
| **2** | Banner rewrite + Shift-held hover affordance (manta + "Ask Muse"). Legibility. | planned |
| **3** | Stripped home (keep history + DESIGN.md, drop composer/observation) + lazy canvas panel (defer the floating knobs on Shift-originated selections). | planned |
| **4** | Polish: target-chip click-to-reselect, undo/redo into the panel header, motion, edge cases. | planned |

Cohesion rule for every PR: any new interaction or motion uses the existing
design-system tokens (`EASE`/`DUR`, overlay CSS vars, the `animate-muse-*`
keyframes) — no one-off curves or colors.

## PR1 notes

- One activation state replaces both the chat `active` (select-mode) and the
  `canvas` boolean. Opening the panel (FAB) makes the page selectable; closing it
  (X / Done / Esc-at-home) turns Muse off.
- `useCanvasMode` is the single selection source. It gains an `onEscalate`
  callback fired on Shift-click; `MuseOverlay` wires it to `setSelection`.
- `MuseHome.onSelect` and `ActiveTargetStrip.onSwapTarget` become optional so the
  `MuseGallery` state showcase keeps compiling; the real overlay drops the
  separate-select-mode affordances (you select by clicking the page now).
- Banner gets a minimal honest update (mentions Shift-click); the full
  manta-marked rewrite + Shift-held hover affordance is PR2.
