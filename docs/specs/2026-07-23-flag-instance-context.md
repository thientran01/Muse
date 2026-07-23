# Instance-aware flags — carry the usage site in the flag payload

**Date:** 2026-07-23 · **Status:** approved (brainstorm session) · **Scope:** canonical Muse only (portfolio re-vendor is a separate follow-up)

## Problem

A flag dropped on an element authored inside a shared component always pins the
component file; which *instance* the designer meant rides only on rendered `text`
plus the plain-English comment. Surfaced dogfooding the Portfolio v2 case study
(vault: `Projects/Muse.md` § 2026-07-23): Shift-clicking a `FigureCaption` meaning
"delete this one" produced a work-order pointing at `FigureCaption.tsx` with nothing
structural identifying the usage.

The disambiguating context already exists at click time — `canvasChain` computes the
full ancestor chain (each entry with its own file:line:col) and the fiber owner walk
computes the component breadcrumb — but the shift branch throws both away and passes
only the leaf.

## Design

### Contract (additive, backward-compatible)

`FlagDraft` and `Flag` (`src/muse/types.ts`) gain optional fields:

- `crumbs?: string[]` — component breadcrumb from the existing owner walk
  (`getElementInfo`), outermost → nearest. Works on React 18 and 19 (`_debugOwner`
  survives both).
- `usage?` — the nearest `canvasChain` ancestor authored in a **different file**
  than the leaf. Draft shape `{ fileName, line, column, tag }` (as captured);
  persisted shape `{ file, line, column, tag }` with `file` repo-relative, same as
  the main loc. Semantics are deliberately honest: *nearest containing element from
  another file* — usually the consuming page, but it can be a layout component. It
  is NOT the `<Component />` call-site line (that line never reaches the DOM; the
  React-18 `_debugSource` route to it is dead on React 19 hosts).
- `instanceIndex?: number` / `instanceCount?: number` — "2 of 3": the element's
  1-based position, in document order, among all DOM elements whose `data-muse-loc`
  value matches its own. Present only when count > 1 and the element resolved via
  the attribute (skipped on the fiber fallback). This is what pins "delete THIS
  one" when the usage container is itself inside a `.map()`.

The authored `file:line:col` stays the primary contract — id stability, drift
semantics, panel, and existing flags are untouched. `.muse/flags.json` stays
`version: 1`. Both readers already pass unknown fields through (muse-mcp's
`FlagSchema.passthrough()` exists precisely for this), so no schema change and no
forced muse-mcp republish.

### Components

1. **`src/muse/flagContext.ts`** (new) — pure/derivation helpers:
   - `pickUsage(chain)` — first chain entry in a different file than `chain[0]`.
     File comparison normalizes separators + case and treats path-suffix matches as
     the same file (guards a mixed chain where the leaf resolved via the
     repo-relative `data-muse-loc` stamp but an ancestor fell back to the fiber's
     absolute path).
   - `instanceOf(node)` — the `data-muse-loc` match count/index described above
     (queries `[data-muse-loc]` and compares attribute values; the overlay's own
     stamped elements live in the shadow root and are invisible to
     `document.querySelectorAll`, so Muse chrome can't pollute the count).
2. **`draftFromElement`** (`src/muse/components/canvas/CanvasMode.tsx`) — derives
   `crumbs` / `usage` / `instanceIndex,instanceCount` via `canvasChain(el.node)` +
   `getElementInfo(el.node)` + the helpers. Both capture entry points (shift-click
   and the five refusal `refuse(...)` sites) flow through it, so refusal-born flags
   get the same enrichment. No signature change to `useCanvasMode`'s `onFlag`.
3. **Server** (`handleFlag`, `server/museCore.ts`) — validates `usage.fileName`
   with the same `resolveInSrc` gate as the main loc and stores it repo-relative;
   an invalid `usage` is **dropped, not rejected** (advisory context must not lose
   the flag). `crumbs` filtered to strings (cap 4); instance fields kept only when
   both are integers with `1 <= index <= count`.
4. **FlagComposer** (`src/muse/components/FlagComposer.tsx`) — one quiet readout
   line when context exists: nearest component · `instance 2 of 3` · `used in
   <usage file basename>`. Reuses classes already in the file (no new overlay CSS →
   no `build:overlay-css` regen).
5. **muse-mcp** (`packages/muse-mcp/src/`) — `types.ts` Flag type mirrors the new
   optional fields; `list_flags`/`get_flag` descriptions explain the two locs
   (authored = where the pixels live; usage + instance = which rendered instance).
   `FlagSchema` deliberately unchanged: passthrough already round-trips the fields,
   and typed validation there would let a malformed advisory field brick every
   flag read. Version bumped to 0.1.1 in-repo; npm publish is Thien's (OTP).

### Tests (`server/__tests__/flags.test.ts`, new — first coverage of the flag handler)

- **The real-bug assertion:** a flag POSTed for an element authored in a shared
  component file, with a usage entry from the consuming file, persists `usage.file`
  pointing at the consuming file (repo-relative), not the component file.
- A draft without the new fields (old client) still persists — no new keys invented.
- `usage.fileName` outside `src/` → flag saved, `usage` dropped.
- Invalid instance fields (index 0, count < index, non-integers) → dropped.
- `pickUsage`: single-file chain → undefined; mixed chain → first cross-file entry;
  absolute-vs-relative spelling of the same file (win32 separators) does not count
  as a cross-file hit.
- Round-trip: GET `/flags` returns the persisted `usage`/`crumbs`/instance fields.

## Out of scope

- Server-side import tracing to find the exact `<Component />` call-site line
  (YAGNI — the resolving agent closes that gap from usage + crumbs + comment).
- Composer UI for re-pinning the flag to another chain level (silent capture was
  the approved shape).
- Portfolio v2 re-vendor + live verification (separate session, that repo).
- muse-mcp npm publish (in-repo version bump only).
