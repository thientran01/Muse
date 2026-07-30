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

**Isolation.** `e2e/fixture/` is copied once per run to `e2e/.tmp-fixture/`, and one Vite dev server
is pointed at the copy for the whole suite. Isolation is then **per file, not per directory**: each
spec owns its own source file in the fixture (`src/ScrubTarget.tsx` and so on) and restores just that
file from the pristine copy before each test.

This replaces the per-spec-directory scheme in the approved design. A directory per spec would need a
dev server per spec, and the server is exactly what we want stable — strategy detection is memoized
per server process, so re-launching it repeatedly would re-derive `tailwind-first` on every spec for
no benefit. The committed `e2e/fixture/` is read-only at runtime either way.

The copy lives *inside* the repo, not in `os.tmpdir()`, so Node's `node_modules` resolution still
walks up to the repo root. It sits at the **same depth** as `e2e/fixture/` so the relative imports
inside it resolve identically in both locations. `e2e/.tmp-fixture/` is gitignored.

The copy is guarded to the main process. Playwright re-imports the config in every worker, and by
then Vite is watching the fixture directory — on Windows the recursive remove fails with `EPERM`, and
re-copying mid-run would wipe the file a spec is asserting on. (Found by running it, not by reasoning.)

`git checkout -- e2e/fixture` as a reset mechanism was rejected: it is a destructive git operation
running inside a test, and it would silently discard a developer's in-progress fixture edits.

**The fixture compiles Tailwind for real.** Skipping PostCSS looked free — the suite asserts on source
bytes, so why render? Because the properties panel seeds its fields from *computed style*. With
inert classes, writing `text-[length:20px]` leaves the element measuring the browser default, and a
second edit to the same element silently restarts from 16px. The first version of the scrub spec
failed exactly this way.

Tests run **serially**. Parallel workers would contend over a single dev server and its HMR channel.

**Assertion.** `expect.poll()` over `fs.readFileSync(fixtureFile, 'utf8')`, asserting exact expected
source content — the same byte-level contract the engine harness uses.

- **No screenshots, anywhere.** Screenshot compositing has produced false readings three separate
  times in this project (translucent `/95` surfaces render as white; the preview renderer wedges its
  animation clock). Computed style and file bytes are the only trusted signals.
- **No fixed delays.** Polling only. The repaint-gating fix (`waitForParentRepaint` replacing
  `setTimeout(200)`) is the precedent: a baked delay encodes an assumption about the host that
  silently rots.

**Test hooks.** Mostly true, with one correction found by mapping the source: `ScrubField` already
carries `data-testid="scrub-${label}"`, the only test id in `src/`. Font size (`scrub-Size`) is
unique, so the scrub spec needs **no source change at all**.

The rest of the claim stands — nothing identifies a color swatch, a reorder handle, or a specific
dock button, and `scrub-All` is emitted by linked padding, linked margin *and* radius with identical
accessible names, so it is a strict-mode collision waiting to happen. Hooks are still required for
the color and reorder specs, and the padding case wants `scrub-Padding`/`scrub-Margin` before it can
be driven at all. Scraping generated CSS classes was rejected as guaranteed future breakage.

**Environment.** The dev server launches with `VITE_MUSE_EPHEMERAL=0` and `VITE_MUSE_MOCK=0`
explicitly set, and a preflight spec asserts the *resolved* values rather than trusting the pin.

The threat model here was wrong in the approved design and is corrected: Vite's `envDir` follows the
root, so a repo-root `.env.development.local` does **not** leak into a fixture served from a
subdirectory, and that file is gitignored so no clone or CI runner has one at all. The real leak
channel is `process.env` — `loadEnv` copies matching shell variables *over* file values, so an
exported `VITE_MUSE_EPHEMERAL=1` beats everything. Hence pinning in `webServer.env`, which wins by the
same rule.

The guard is worth having because it protects the case that actually occurs: the maintainer's main
checkout does carry `.env.development.local` with both flags on, and that is where the suite gets run
by hand. Verified by flipping the pin — the preflight fails naming the cause, rather than leaving
every byte assertion to fail against an unchanged file.

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

Mapping the source turned up a second mitigation that was not known at design time: `CanvasMode`
registers a **keyboard reorder path** (Cmd/Ctrl + arrow on a selected reorderable element) that calls
`commitReorder` directly, bypassing the movement threshold, pointer capture, the ghost-measure step,
the panel fade and the post-drop click swallower entirely. That makes it a far more deterministic
driver for the *reorder-then-gap* spec, whose job is to pin an engine bug — it should not also be
hostage to the flakiest input path in the product. **The pointer drag keeps its own spec**, because
the drag is the actual user gesture and its fragility is the thing worth guarding. Splitting them
means a drag flake cannot mask the bug tripwire.

**A real bug surfaced while mapping, and is deliberately not fixed here.** Three `CanvasMode`
document-level keydown handlers try to bail when the event target is an `INPUT`, but a document
listener sees the event retargeted to the shadow *host* — a `div` — so the bail never fires for
Muse's own panel inputs. Ctrl+Z with a scrub field focused therefore triggers Muse's file undo rather
than text undo, and Ctrl+Arrow triggers a reorder. The correct `composedPath()[0]` pattern already
exists two files away. The suite works around it (plain arrows and Enter only, documented at the
call site); the fix belongs in its own change.

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

1. **Harness** — Playwright config, fixture app, tmp-copy isolation, preflight spec, and the scrub
   spec (which needs no source change, since `scrub-Size` already exists). Green in CI.
2. **Color and text edit** — plus the `data-muse-*` hooks they require.
3. **The risky half** — reorder drag and reorder-then-gap, where the flake risk actually lives.

Split into three rather than two once it was clear the scrub path needed no source modification: the
harness can land and prove itself without touching a line of product code, which makes it a much
smaller thing to review and to revert.

If a later PR goes badly, the earlier ones stand on their own and the suite still guards
previously-uncovered regression sites.
