# Case-study engine fixes — the five gaps dogfooding Muse on the portfolio surfaced

**Date:** 2026-07-25
**Branch:** `fix/config-import-order` (PR 1 of 4; each later task branches off `main` independently)
**Lens:** engineering. These are correctness, cross-browser and race-hardening items, and four of
the five arrived with measured evidence attached. One embedded design call — what the freeform class
field *does* on conflict — is ruled below.

## Problem

Shipping the Muse case study to `thientrn.com/case-studies/muse` was the first time the overlay ran
against a real, deployed, non-Vite host with a designer driving it. That surfaced five engine gaps
that no amount of local dogfooding had. Each was measured on the live build, logged in the vault
(`Projects/Muse.md` §§ *Muse is LIVE on the public portfolio*, *POST-LAUNCH INCIDENT*, both
2026-07-24), and re-verified against this repo at `ab68b20` before this spec was written.

| # | Gap | Verified at | Severity |
|---|---|---|---|
| 1 | `MOCK`/`EPHEMERAL` resolve once at import, so a host must win an unwinnable script race | `src/muse/config.ts:60,68` | 🔴 caused a live outage |
| 2 | `museReorderable` is the only 1 of 15 `api.ts` functions with no demo-mode short-circuit | `src/muse/api.ts:159` | 🟡 |
| 3 | A non-JSON response body reaches the user as a raw `SyntaxError` | `src/muse/api.ts:40,62` + siblings | 🟡 |
| 4 | The token panel reads empty on **Firefox** — `CSSStyleRule` is also a `CSSGroupingRule` there | `src/muse/api.ts:285` | 🟡 every Firefox host |
| 5 | The freeform class field authors a **dead class** over an inline style — write succeeds, nothing changes | `server/styleEdit.ts:1250` | 🟡 worst failure mode of the five |
| 6 | No `data-muse-active` signal, so a host can't stand down its own cursor/hotkeys | absent repo-wide | 🟡 |
| 7 | Em-dash in the auto-suggested refusal-flag note, visible to anyone on the live page | `CanvasMode.tsx:989,993` | 🟢 |

Two of these deserve their failure mode named, because the severity is not in the size of the bug.

**#1 caused the launch incident.** `DevMuse.tsx` statically imported `MuseOverlay`, which dragged
`@/muse/config` into the Next **layout's** client chunk. Next emits those as `<script async>` at
~byte 433; the case study's inline `window.__MUSE__={ephemeral:true}` sits at ~byte 3801. An async
chunk executes as soon as it downloads, independent of parser position, so over a real network it
ran first — and `EPHEMERAL` is resolved exactly once at import, so losing the race latched the
overlay into real-backend mode for the whole session. 49 failed requests on a single page view.
Never reproduced locally, because localhost parses 3.4KB of HTML faster than a chunk arrives. The
host fixed it with `next/dynamic`, which is correct but is a workaround: **today every host must win
a race that is unwinnable by construction.**

**#5 is the nastiest because it looks like the opposite bug.** Adding `mb-0` through the class field
to an element carrying `style={{ margin: "0 auto 80px" }}` persists the class to source correctly —
and inline styles beat Tailwind classes, so nothing moves. The write *succeeds*, the file *changes*,
and the result is indistinguishable from "Muse isn't saving." It took four attempts to conclude
otherwise. This is exactly the hazard decisions #74/#75 (inline-first routing) were built to prevent
for the normal style path; the freeform field bypasses that guard entirely.

## Rulings

Two decisions were taken before this spec, and neither is re-opened below.

### Scope: the five gaps plus two cheap riders

Items 1–5 are the vault's open list. #6 (`data-muse-active`) and #7 (em-dash) ride along: both are
sub-20-line fixes, and #7 has sat on the board since 2026-06-30 *specifically* because a vendored
copy can only be fixed upstream.

Deliberately **out**: the `composedPath()` shadow-host retarget (Ctrl+Z with a scrub field focused
fires Muse's file undo — `CanvasMode.tsx:834/898/915`) and the gap **drag-band** commit path after a
reorder. Both are real and already spun off; neither came from the case study.

### The class field refuses rather than redirects

When the freeform field adds a class whose property is already owned by the element's inline style,
Muse **does not write the class** and returns a warning naming the reason. Rejected alternatives:

- *Write the class, strip the conflicting inline key.* Symmetric with the inline path (which already
  strips a dueling Tailwind class), but it deletes a value the user never asked to touch —
  `margin: "0 auto 80px"` loses its auto-centering the moment `mb-0` claims `margin`. And it can't
  do this at all when the style is a shared const or a spread, so behavior forks by element shape.
- *Invert the token and write the inline literal.* Most consistent with #75, but inversion only
  works for tokens the scale builders can reverse. `mb-0` and `mb-[3.7rem]` yes; `shadow-lg`,
  `font-display` no. Partial coverage means the field behaves differently token to token, which is
  worse than one clear rule.

Refusing is the fail-closed behavior the case study itself advertises, and it is honest about the
detection limit: a token no family matcher claims proceeds exactly as it does today. No regression,
no false confidence, and the user learns on attempt 1 instead of attempt 4.

## Architecture

Nothing here is new architecture. Four of the seven fixes are one-site changes; the two that are not
are described below.

### Lazy config reads, and why the lint is load-bearing

`MOCK` and `EPHEMERAL` become `isMock()` and `isEphemeral()`, resolved per call through the same
guarded reader chain (`import.meta.env` → `window.__MUSE__` → `process.env`) they use today.
`apiBase` already works this way — `getApiBase()` reads mutable `state` per call — so this makes the
three config values consistent rather than introducing a new pattern.

The refactor's real risk is not the rename. It is that **one surviving module-scope read makes the
overlay half-ephemeral**, which is strictly worse than today's uniformly-wrong behavior: the Share
UI would resolve at import while edits resolve lazily, and the failure no longer has one
explanation. `src/muse/components/MuseToolbar.tsx:30` (`const SHARE_UI = !EPHEMERAL && !MOCK`) is a
known instance; the sweep must prove there are no others and keep proving it.

So this task ships a lint. It matches the house shape established by `scripts/lint-tokens.mjs`
(a plain node script under `scripts/`, a doc block stating scope and exclusions, an npm script, a CI
step beside `npm run lint:tokens` at `.github/workflows/ci.yml:26`) with **one deliberate
deviation**: it parses with `@babel/parser` + `@babel/traverse` (both already devDependencies)
rather than matching a regex. The token lint checks for *class strings*, where regex is the natural
tool. This one checks for *scope*, which is a syntactic-structure property — a regex would have to
proxy it through indentation, and a false negative in this particular lint silently reintroduces the
exact bug the task exists to remove.

### Shorthand awareness is what makes the class-conflict check actually work

Before authoring a `classPatch.add` token, resolve which `StyleProperty` claims it by scanning
`PROPERTIES` (`src/muse/style/properties.ts`) through the existing `familyMatcher`. Those matchers
are already content-aware, which is what keeps `text-center` resolving to `textAlign` rather than
colliding with `color` or `fontSize` on the overloaded `text-` prefix.

The trap is the intersection test. The reported bug had inline key `margin` and class `mb-0` →
`marginBottom`. **An exact-key intersection finds no conflict and ships the same dead class.** The
check must treat an inline shorthand as covering its longhands; `expandConflictingShorthands` in
`server/styleEdit.ts` already encodes that relation and is reused rather than reimplemented. A
version of this task without this detail passes review, passes its own tests, and does not fix the
bug that motivated it.

## Task plan

Four PRs. Each branches off `main` and merges independently — there is no stack. PRs 1 and 2 both
touch `src/muse/api.ts` in non-overlapping regions; merge sequentially and rebase.

### Task 1 — Import order stops mattering

**Branch:** `fix/config-import-order`

**Files:** `src/muse/config.ts` · `src/muse/api.ts` · the 7 remaining consumers (`src/main.tsx`,
`MuseOverlay.tsx`, `components/canvas/CanvasMode.tsx`, `components/FlagsPanel.tsx`,
`components/MuseToolbar.tsx`, `components/RevertConfirmDialog.tsx`, `components/TokenList.tsx`) ·
`packages/overlay/src/index.ts` · `packages/overlay/package.json` · `scripts/lint-config-reads.mjs`
(new) · `package.json` · `.github/workflows/ci.yml` · `src/muse/__tests__/config.test.ts` (new)

**Changes:**

1. `config.ts` — replace `export const MOCK` / `export const EPHEMERAL` with `isMock()` /
   `isEphemeral()`. The `flag()` helper is unchanged; only the binding moves from const to call. The
   header comment currently documents the at-import resolution *as a constraint hosts must respect*
   — it is rewritten to say the opposite.
2. Every consumer moves to the getter. Module-scope reads are **restructured**, not renamed:
   `MuseToolbar.tsx:30`'s `SHARE_UI` becomes a value computed in the component body.
3. `museReorderable` gains the `if (isEphemeral()) return { reorderable: false, reason: … }`
   short-circuit its 14 siblings have. It fails closed by contract already, so demo mode simply
   shows no drag handle instead of making a network call it shouldn't.
4. `parseJson` replaces bare `await res.json()` where a non-JSON body would otherwise surface raw.
   `museShare` is exempt — its documented contract reads the body regardless of HTTP status and uses
   `ok` as the discriminator.
5. `packages/overlay/src/index.ts` stops re-exporting the consts and exports the getters instead;
   `packages/overlay/package.json` goes to `0.2.0`. Keeping the const export would preserve exactly
   the footgun being removed, and the package is 8 days old with one plausible consumer.
6. The lint + its npm script + its CI step.

**Interfaces — produced:**

```ts
// src/muse/config.ts — replaces the MOCK / EPHEMERAL consts
export function isMock(): boolean
export function isEphemeral(): boolean

// src/muse/api.ts — exported for its test; internal to the module otherwise
export async function parseJson<T>(res: Response): Promise<T>
```

`parseJson` reads the body, parses it as JSON, and on a parse failure throws an `Error` naming the
HTTP status and pointing at the likely cause (a host serving `/api/muse/*` without the Muse
middleware) rather than letting a `SyntaxError` reach `setError((e as Error).message)`.

**Interfaces — consumed:** none. This task is the root of the arc.

**Tests** (`src/muse/__tests__/config.test.ts`, node environment per `vitest.config.ts`):

- Import `config`, *then* set `process.env.MUSE_EPHEMERAL = '1'`, assert `isEphemeral() === true`.
  This assertion fails against today's code — it is the regression pin for the launch incident.
- Import `config`, *then* assign `globalThis.window = { __MUSE__: { ephemeral: true } }`, assert
  `isEphemeral() === true`. This is the production path the portfolio actually lost.
- A host global boolean `false` beats a `VITE_MUSE_EPHEMERAL=1` env var (precedence is unchanged by
  this task and must stay unchanged).
- `parseJson` on a `text/plain` `"Not found"` body throws an `Error` whose message contains neither
  `JSON.parse` nor `unexpected character`, and does contain the status code.
- `parseJson` on a valid JSON body returns the parsed value.

Plus the lint itself, run against the tree: `npm run lint:config` exits 0, and exits non-zero with a
`file:line` message when a module-scope read is reintroduced (verified by flipping one site).

### Task 2 — Firefox token panel, and the em-dash

**Branch:** `fix/firefox-cssom-tokens`

**Files:** `src/muse/api.ts` · `src/muse/components/canvas/CanvasMode.tsx` ·
`src/muse/__tests__/cssomTokens.test.ts` (new)

`readCssomTokens`'s `walkRules` (`api.ts:277`) tests `rule instanceof CSSGroupingRule` first and
`continue`s, so on Firefox — where `CSSStyleRule` has inherited from `CSSGroupingRule` since CSS
Nesting shipped — every `:root` rule is classified as a container, recursed into (no children), and
skipped before yielding a token. The panel then honestly reports zero. Harvest the style rule
**first**, then recurse; never either/or. `src/muse/cssom.ts:17` and `src/muse/forcedState.ts:55`
already do exactly this — `readCssomTokens` is the lone straggler, which is also the argument that
the change is small and safe.

Rider: the em-dashes at `CanvasMode.tsx:989` and `:993`.

**Interfaces — produced:** none (internal behavior fix). **Consumed:** none.

**Tests:** the verification method is the vault's, not a browser — a green Chromium check is not
evidence for a Firefox-only bug. The test builds fake rule objects whose `instanceof` semantics are
switched to mimic each engine and asserts the walk yields the same token count under both. Pinned
expectation: grouping-first yields 0 under Firefox semantics; style-first yields the full count
under both.

### Task 3 — `data-muse-active`

**Branch:** `feature/data-muse-active`

**Files:** `src/muse/useCanvasMode.ts` · `docs/HOSTING.md`

A `useEffect` keyed on the `active` state that `useCanvasMode.ts:93` already owns sets
`data-muse-active` on `document.documentElement` and removes it on cleanup. **Not gated on backend
mode** — the live page where the portfolio's `CustomCursor` fights Canvas is ephemeral, so gating it
would miss the only reported case. `docs/HOSTING.md` gains a section telling hosts to scope their
own cursors, command palettes and global hotkeys to `:not([data-muse-active])`.

**Interfaces — produced:** the `data-muse-active` attribute on `<html>`, present exactly while
Canvas Mode is active. This is a public host-integration contract; `docs/HOSTING.md` is its spec.
**Consumed:** none.

**Verification, stated honestly:** the engine side is a handful of lines and gets no test — asserting
"the host's cursor stands down" is only observable on a host, which means a re-vendor into Portfolio
v2. The attribute's presence/absence is confirmed live on the docs site via the dev server; the
downstream benefit is confirmed only when the portfolio re-vendors, which is out of scope here.

### Task 4 — The class field refuses instead of writing dead classes

**Branch:** `fix/class-field-inline-conflict`

**Files:** `server/styleEdit.ts` · `server/__tests__/classPatch.test.ts`

Inside `computeStyleEdit`'s `classPatch` block (`styleEdit.ts:1250`), before accepting an added
token: resolve its owning `StyleProperty` by testing each entry of `PROPERTIES` with
`resolveStyleWriter().family(spec)`; if one claims it, expand that property's `css` keys against the
element's inline style keys **through `expandConflictingShorthands`** and refuse on any overlap. The
refusal is a `warnings` entry — the existing channel the panel already renders — and the token is
dropped from `classTokens` so no source change occurs.

Removals are unaffected: removing a class that inline style overrides is already a no-op and
harmless.

**Interfaces — consumed:** `PROPERTIES` and `PropertySpec` from `src/muse/style/properties.ts`;
`resolveStyleWriter` from `src/muse/style/writers.ts`; `expandConflictingShorthands` from
`server/styleEdit.ts`. All exist today. **Produced:** no new exported surface — the behavior change
is visible only through `StyleEditResponse.warnings`.

**Tests** (extending `server/__tests__/classPatch.test.ts`):

- **The reported bug, exactly:** element with `style={{ margin: "0 auto 80px" }}`, classPatch adds
  `mb-0` → source is **byte-identical to input**, and `warnings` contains an entry naming `mb-0` and
  the inline `margin`. This is the assertion that would have failed on the real bug.
- Exact-key case: inline `marginBottom`, class `mb-0` → same refusal.
- **False-positive guard:** inline `{ color: 'red' }`, class `text-center` → the class **is**
  written. The overloaded `text-` prefix must resolve to `textAlign`, which shares no key with
  `color`.
- Unmatched token: inline `{ margin: 0 }`, class `sr-only` → written, no warning. The check declines
  to guess.
- A property edit and a conflicting classPatch in the same request: the property edit still lands.

## How we will know it worked

- `npm test` green on both CI legs, with the count up from the **312** this arc starts at (measured
  on `main` at `ab68b20`, 21 files — the vault's "326" is the unmerged #172 branch, not `main`).
- `npm run lint:config` green, and demonstrably red when a module-scope read is reintroduced.
- Task 1's two lazy-read assertions fail on `main` and pass on the branch — that difference *is* the
  fix; a passing test that also passes on `main` proves nothing here.
- Task 4's fixture is byte-identical before and after the refused edit. "No write happened" is the
  behavior; asserting only on the warning would let a silent write through.
- Live on the docs site (`npm run dev` in this worktree, which has **no** `.env.development.local` —
  the root checkout does, and it forces MOCK+EPHEMERAL): the class field surfaces the refusal in the
  panel, and `document.documentElement` carries `data-muse-active` only while Canvas is on.

## Risks

- **A missed module-scope read** is the one failure that makes things worse rather than merely
  unfixed. Mitigated by the AST lint, not by the sweep's thoroughness.
- **Dead-code elimination.** A build-time const can be inlined and eliminated by a bundler; a
  function call cannot. If any build path depends on `EPHEMERAL` folding away, Task 1 changes bundle
  contents. Checked before implementation; if it turns out to be load-bearing for `build:demo`, the
  fix is a build-time define, not reverting to a const.
- **[#172](https://github.com/thientran01/Muse/pull/172) is CONFLICTING with `main`** and touches
  `CanvasMode.tsx` — the same function as Task 2's em-dash rider. Two characters, trivially
  resolved, but #172 already needs a rebase against the design-system merge (#164–#173) regardless.
- **Task 3 is the one this arc cannot verify end to end.** Stated above rather than papered over.
- The published-package version bump is a judgment call on a package with essentially one consumer.
  If `@thientran01/muse@0.1.0` turns out to have real installs, the kinder path is exporting the
  getters *alongside* deprecated consts for one minor — at the cost of keeping the footgun alive.
