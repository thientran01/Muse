# E2E gesture suite

**Date:** 2026-07-21
**Branch:** `feature/e2e-gesture-suite`
**Lens:** engineering call — test infrastructure whose entire value is trustworthiness. A flaky suite is worse than no suite.

## Problem

All 312 tests sit on `server/` and pure client modules. The three largest client files —
`CanvasMode.tsx` (1797 lines, 20 `useEffect`s), `PropertiesPanel.tsx` (1224), `ReorderOverlay.tsx`
(954) — are ~4,000 lines of gesture and pointer logic with no component or integration coverage.

That is also where the regression history lives. Every one of these was found by hand and fixed by
hand: the four reorder stuck-drag root causes, the transition-snap on reorder, the Fast Refresh line
offset, the ScrubField value clip (#135), color-picker duplicate commits (#146), the ephemeral-undo
toolbar bug (#124–#128), and the still-open reorder-then-gap revert (2026-06-27).

The engine cannot regress silently — it has byte-exact fixtures on two operating systems. The client
can, and repeatedly has.

## Scope

Six gesture specs, one per distinct risk class. Not a coverage-maximizing suite — the 312 engine
tests already own the five styling strategies exhaustively, so E2E's job is strictly the client half
of the chain: **gesture → request → write.**

| Spec | Justification |
|---|---|
| scrub a numeric | ScrubField value-clip regressed in #135 |
| pick a color | duplicate commits + `#rrggbbaa` alpha regressed in #146 |
| double-click text edit | distinct path shape; weakest by regression history, kept for path coverage |
| reorder drag | four documented root causes; the flakiest surface in the product |
| reorder → gap edit | the open HIGH bug from 2026-06-27; lands as `test.fail()` |
| undo reverts source | ephemeral-undo regressed in #124–#128 |

**Explicitly out of scope.** This suite says nothing about host portability (Next / Turbopack /
React 19 / Tailwind v4). That is `/muse-host-doctor`'s job and stays there. It must not be cited as
evidence of host compatibility.

## Architecture

**Runner.** A Playwright project separate from vitest. `npm run test:e2e`, config at
`playwright.config.ts`, specs under `e2e/`. Vitest keeps its node-environment engine harness
untouched; the two never share a runner, a config, or a process. Vitest stays constrained to `^2.x`
— the 4.x rolldown win32 binding is broken and this change must not disturb that.

**Target app.** A dedicated fixture at `e2e/fixture/` — a minimal React app of roughly 150 lines
built purely for testing: one Tailwind-classed box (scrub and color targets), one plain text node, a
sibling list for reorder, and a gap-bearing flex container for the reorder-then-gap case.

The docs site was considered and rejected. It is the better dogfood surface, but tests driving it
would break on every copy or layout tweak, and edits would mutate real repo source. The fixture is
deliberately single-strategy (Tailwind only) because multi-strategy coverage is the engine harness's
job, not this suite's.

**Isolation.** `e2e/fixture/` is copied to `e2e/.tmp/<spec-name>/` **once per spec file**, before its
first test, and the Vite dev server is pointed at the copy. Per-spec rather than per-test: a spec's
tests share one mutation timeline, which keeps the dev server and its HMR channel stable across a
file, while no spec can ever observe another spec's writes. The repo's `e2e/fixture/` is read-only at
runtime.

The copy lives *inside* the repo, not in `os.tmpdir()`, so Node's `node_modules` resolution still
walks up to the repo root. `e2e/.tmp/` is gitignored.

`git checkout -- e2e/fixture` as a reset mechanism was rejected: it is a destructive git operation
running inside a test, and it would silently discard a developer's in-progress fixture edits.

Tests run **serially**. Parallel workers would contend over a single dev server and its HMR channel.

**Assertion.** `expect.poll()` over `fs.readFileSync(fixtureFile, 'utf8')`, asserting exact expected
source content — the same byte-level contract the engine harness uses.

- **No screenshots, anywhere.** Screenshot compositing has produced false readings three separate
  times in this project (translucent `/95` surfaces render as white; the preview renderer wedges its
  animation clock). Computed style and file bytes are the only trusted signals.
- **No fixed delays.** Polling only. The repaint-gating fix (`waitForParentRepaint` replacing
  `setTimeout(200)`) is the precedent: a baked delay encodes an assumption about the host that
  silently rots.

**Test hooks.** The controls under test have no stable selectors today. The full existing set is
`data-muse-ui`, `data-muse-loc`, `data-muse-panel`, `data-muse-dock`, `data-muse-canvas-host`,
`data-muse-pin-hover` — nothing identifies a scrub field, a color swatch, or a reorder handle.

This effort therefore includes adding `data-muse-*` attributes to the specific controls the suite
drives. Scraping generated CSS classes instead was rejected as a guaranteed source of future breakage.

**Environment.** The dev server launches with `VITE_MUSE_EPHEMERAL=0` and `VITE_MUSE_MOCK=0`
explicitly set. A local `.env.development.local` puts dev into MOCK + EPHEMERAL, where canvas edits
never reach the server and no file is ever written.

Without a guard the suite would fail with a confusing "file unchanged" message. So a preflight spec
performs one trivial edit and asserts the file moved, failing with a message that names
`.env.development.local` as the likely cause.

## The known bug

The reorder-then-gap spec lands as Playwright `test.fail()`: reorder calls `selectElement()`, the
selection-change effect leaves the edit-preview ref holding stale/detached nodes, and the following
gap commit's before/after `cssText` comparison finds no change and no-ops.

`test.fail()` inverts the result — the spec goes **red when the bug is fixed**. That is intended: it
is a tripwire announcing that the spec should be promoted to a normal test. Combined with a blocking
CI job, an incidental fix will break `main` exactly once, deliberately and legibly.

## CI

A new `e2e` job: `ubuntu-latest` only, blocking, **`retries: 0`**, Playwright browsers cached on the
lockfile hash.

Retries are omitted on purpose. The drag affordance is documented as unreliably mounted at press time
(decision #61 — the unified-selection rework churns the async reorder probe on every click). A retry
would convert exactly that known flakiness into a green check, which is the valid-but-wrong-signal
failure family this project already watches for.

Windows is skipped. The CRLF concern that justifies the engine matrix lives entirely in the engine
harness, which continues to run on both operating systems.

## Risks

**The drag test is the real risk.** Mitigation is web-first assertions only: wait for the reorder
affordance to be genuinely visible before pressing, and wait on a settle signal rather than a
duration.

If the drag spec still flakes after that, the honest reading is that it is surfacing a real product
bug rather than a test defect, and it should stay red until the product is fixed. Adding retries to
silence it is explicitly not an option under this design.

**Playwright and the shadow root.** The overlay renders in an `open` shadow root
(`useShadowHost.ts:36` — `attachShadow({ mode: 'open' })`), chosen partly so automation can reach
inside; the Session-26 Playwright probes and the screen-demo recordings both already drive the
overlay through it. The mechanism is proven in practice.

## How we will know it worked

1. The suite fails when the client half breaks. Validated by construction on the reorder-then-gap
   spec, which fails today against a real, documented bug.
2. The preflight spec fails loudly and legibly under MOCK/EPHEMERAL rather than passing vacuously.
3. The job stays green on `main` across a normal working week with zero retries. If it does not, the
   suite has found something — either a product bug or a test defect — and that finding is the point.

## Sequencing

Two PRs:

1. **Harness** — Playwright config, fixture app, tmp-copy isolation, `data-muse-*` test hooks,
   preflight spec, and the three stable specs (scrub, color, text edit). Green in CI.
2. **The risky half** — reorder drag and reorder-then-gap, where the flake risk actually lives.

If PR 2 goes badly, PR 1 stands on its own and the suite still guards three previously-uncovered
regression sites.
