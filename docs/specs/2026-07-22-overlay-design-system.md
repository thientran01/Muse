# Overlay design system — adopting the Claude Design System into the code

**Date:** 2026-07-22
**Branch:** `feature/overlay-design-system`
**Lens:** design call for the values, engineering call for the mechanism. The values are already
decided (see Source of truth); everything left is a migration whose failure modes are mechanical.

## Problem

The overlay's chrome reads as inconsistent because two of its five layers were never systematized.
Colors and motion are tokenized well — semantic CSS vars that flip per theme, one easing curve, a
`DEFAULT` transition override so even a bare `transition` lands on the system curve. Type, alpha,
radius, shadow, and component structure were not.

Measured across all 19 `src/muse/**/*.tsx` files, ~189 drift sites:

| Layer | Drift |
|---|---|
| Type | 9 distinct sizes; 84 of 90 usages are arbitrary bracket values, including a `text-[10.5px]` |
| Alpha | 7 steps of `line/N`, 8 of `accent/N`, applied ad hoc on top of clean color tokens |
| Radius | 91 sites on stock Tailwind keys whose scale disagrees with the design system's |
| Shadow | 7 elevated surfaces ship at half the intended alpha |
| Components | no primitives — the same list-row class string appears verbatim 3×, the same empty state 2×, and two panels ship two different "primary" buttons |

Each individual choice was made locally and defensibly. Together they are not a system.

## Source of truth

The **Muse Design System** at `claude.ai/design/p/7bd58238-150d-4821-b383-13f145206cc4` (project id
`7bd58238-150d-4821-b383-13f145206cc4`, read via the `DesignSync` tool). It is **descriptive, not
aspirational** — harvested from this repo, and its own `tokens/colors.css` says so: *"Values verbatim
from src/muse/muse.css."* Verified byte-identical for the overlay color layer.

This matters for scope: the design work is already done. This spec is a reconciliation and a
migration, not a design exercise. Where the design system and the code disagree, the design system
is presumed right unless it contradicts accessibility or a documented product decision — both
exceptions occur and are ruled below.

### What it settles

Every value question, every role name, the entire color and motion layer, and the component
contracts. Three corrections to earlier assumptions, all found by reading both sources:

1. **Motion is zero migration.** `--ease-in-out cubic-bezier(0.65,0,0.35,1)`, `--dur-morph 140ms`,
   and `--dur-pop 150ms` are live at `src/muse/muse.css:32/35/36` and drive `.muse-dock-trail` at
   `muse.css:229`. An earlier audit read only `tailwind.config.js` and wrongly called them missing.
2. **`--terracotta: #e3a384` already exists** in the design system, documented as *"the accent,
   lightened for dark surfaces."* The gap is not a missing color — it is that the design system
   scoped it to the docs site and never aliased it for the overlay. `src/index.css:19` does the same
   lightening. Precedent is unanimous; only the overlay was left out.
3. **`--text-ui: 13px` exists** under the docs scale, and `tokens/typography.css`'s own header claims
   a *"10–13px"* overlay range its token block does not deliver. The 13px overlay token was authored
   out, not forgotten.

### What it does not settle

Ten value calls, listed under [Open docket](#open-docket). None changes this plan; each is settled
inside the PR that touches it.

## Architecture

### The ruling: adopt the values and the contracts, not the CSS delivery or the components

This is not a preference. Three hard mechanisms:

- **`components/injectStyle.js` appends `<style>` to `document.head`.** `useShadowHost.ts:36-40`
  gives the overlay a shadow root whose only stylesheet is `OVERLAY_CSS`, and shadow roots do not
  inherit document stylesheets. Every design-system overlay component would render unstyled. Custom
  properties *do* inherit across the boundary, so the tokens are fine — it is the rules that never
  arrive. Importing that CSS would also violate the "hosts import ZERO Muse CSS" invariant the
  shadow root exists to enforce.
- **`components/core/Icon.jsx` injects a jsDelivr `<link>`** for `@phosphor-icons/web@2.1.1`. Same
  boundary problem, plus a CDN fetch in a dev-only offline-capable tool, plus it contradicts
  `@thientran01/muse`, which tree-shakes Phosphor React and ships zero icon dependency. `Panel`,
  `Chip`, `IconButton`, `Dock`, and `UndoRedoBar` all import it transitively.
- **Every `:root` token block is inert inside a shadow root.** The document element is not in that
  tree. This is silent: the CSS parses, matches nothing, and inherited defaults apply.

So the design system's *values* land as CSS vars in `muse.css` plus theme keys in
`tailwind.config.js`; its *component contracts* inform repo primitives written natively; its
component source is reference, not a dependency.

### Naming law

**Role names, never t-shirt sizes.** Tailwind's stock keys in every namespace touched here are
t-shirt sizes (`xs/sm/md/lg/xl`), so a role name (`field`, `eyebrow`, `panel`, `scrim`, `pop`) can
never collide. Redefining a stock key is global and silent — verified in a scratch compile:
`extend.fontSize = { sm: '11px' }` emits `.text-sm{font-size:11px}` and retypes the docs site's 13
`text-sm` sites, while adding `fontSize.field` leaves `.text-sm` stock at `0.875rem/1.25rem`.

The design system's token *names* therefore never enter the repo. This also sidesteps a live
collision: `--radius-lg` means 12px in the design system and **16px** at `src/index.css:14`, where it
is one of the four tokens the Design-tokens popover repaints live.

Every theme value points at a CSS var rather than a literal, so the live token editor (`/tokens` +
`/token-edit`) can still retarget it at runtime.

### Both halves are required

A CSS variable alone cannot mint a utility. Verified: `text-[length:var(--text-field)]` works with no
config change; a bare `text-field` requires a theme key. Each token needs the var in `muse.css`
(single source of truth) *and* the theme key pointing at it.

## The token map

> **On the counts.** Site counts come from the reconciliation pass against HEAD and are accurate to
> within a site or two where a value serves more than one role (the `line/20` split across swatches,
> scrollbar thumbs, and `muse.css` is the fiddliest). They size the work; they are not an acceptance
> criterion. Re-measure at the start of each PR with the grep in
> [How we will know it worked](#how-we-will-know-it-worked) — that number, going to zero, is the
> criterion.

### Type — `theme.extend.fontSize`

| Token | Value | Class | Replaces | Sites |
|---|---|---|---|---|
| `--text-row` *(new)* | 13px / 1.375 | `text-row` | `text-[13px]` | 2 |
| `--text-panel-title` | 12px / 1.375 / `-0.01em` | `text-title` | `text-[12px]` (title role only) | 1 of 8 |
| `--text-body-sm` *(new)* | 12px / 1.625 | `text-body-sm` | `text-[12px]` (prose/input/label), `text-xs` | 7 + 1 |
| `--text-field` | 11px / 1.375 | `text-field` | `text-[11px]` | 40 |
| `--text-eyebrow` | 10px / 1.15 / `+0.02em` | `text-eyebrow` | `text-[10px] tracking-wide` (true eyebrows) | 7 |
| `--text-chip` *(new)* | 10px / `16px` | `text-chip` | 10px non-eyebrows, mono chips | 19 |
| `--text-badge` *(new)* | 9px / 1 | `text-badge` | `text-[9px]` | 6 |

**Weight never goes in a tuple.** Tailwind v3 tuples hold exactly one `fontWeight`, and `text-field`
genuinely splits 500/400 (7 `font-medium` against ~30 unset). Baking either value silently flips the
other bucket inside `generated/overlayCss.ts`, where `npm run dev` will never show the regression.

Weight itself needs **zero migration**: `--fw-normal/medium/semibold` map 1:1 onto `font-normal` ×2 /
`font-medium` ×13 / `font-semibold` ×14. `--fw-bold` (700) has zero consumers in `src/muse` *and*
`src/site` — drop it from the design system's font import.

Tracking and leading need explicit keys because the design system's values differ from stock:
`letterSpacing.tight` `-0.02em` (stock `-0.025em`), `letterSpacing.title` `-0.01em` (new, one site at
`MuseToolbar.tsx:233`), `letterSpacing.wide` `0.02em` (stock `0.025em`, folded into the `eyebrow`
tuple). `--leading-snug` 1.375 and `--leading-relaxed` 1.625 already match stock. `--leading-tight`
1.15 is a 36px display ratio; the one overlay site using it (`PropertiesPanel.tsx:312`) wants 1.25,
so rename the design-system token to `--leading-display` rather than adopting it.

### Alpha / hairline — `theme.extend.colors`

Fixed-alpha colors, so they intentionally lose the `/<alpha-value>` modifier.

| Token | Value | Class | Replaces | Sites |
|---|---|---|---|---|
| `--fill-recessed` *(rename of `--scrim`)* | `line / .05` | `bg-scrim` | `bg-line/5`, `bg-line/[0.04]`, `bg-line/[0.06]` | 10 |
| `--hairline` | `line / .10` | `border-hairline`, `ring-hairline` | `ring-line/10`, `border-line/10` | 19 |
| `--wash-hover` *(new)* | `line / .10` | `hover:bg-wash` | `hover:bg-line/10` | 16 |
| `--hairline-strong` | `line / .15` | `border-hairline-strong` | `border-line/15`, `bg-line/15`, `ring-line/15` | 10 |
| `--hairline-contrast` *(new)* | `line / .20` | `border-hairline-contrast` | `border-line/20` on swatches | 4 |
| `--control-track-quiet` *(new)* | `line / .20` | `bg-track-quiet` | scrollbar thumbs | 4 |
| `--control-track` *(new)* | `line / .30` | `bg-track` | `bg-line/30`, `muse.css:105`'s orphan `0.34` | 3 |
| `--control-track-hover` *(new)* | `line / .60` | `hover:bg-track-hover` | `hover:bg-line/60` | 1 |

`--hairline` and `--wash-hover` share the 0.10 value doing two different jobs (a ring and a fill).
Both names are kept: the design system's own components prove the split is real — `Panel.jsx` hovers
at 0.05 while `IconButton.jsx` hard-codes `rgb(var(--muse-line) / .1)` because no fill token exists.

`--hairline-contrast` carries a mandatory role note: *"outlines a swatch whose FILL is user-chosen;
`--hairline-strong` disappears on mid-tone fills."* Without it a later cleanup pass will collapse it
to 0.15 and reintroduce the bug.

### Accent — `theme.extend.colors.accent`

The one layer with no design-system token at all; it names alpha roles only for `--muse-line`.

| Token | Value | Class | Replaces | Sites |
|---|---|---|---|---|
| `--muse-accent-fg` *(new)* | dark `227 163 132`, light `127 47 47` | `text-accent-fg` | `text-accent` on any accent tint | 4 |
| `--focus-ring` *(new)* | `accent / .50` | `ring-focus` | `ring-accent/50` ×21, `/60` ×1, `/25` ×1 | 23 |
| `--tint-active` / `--tint-active-hover` | `accent / .10` / `.15` | `bg-tint`, `hover:bg-tint-hover` | `bg-accent/10` ×4, `/15` ×3, `hover:bg-accent/20` ×1 | 8 |

The focus ring becomes a named token rather than staying `ring-accent/50`. It is already the most
disciplined value in the codebase (21 consistent uses), so this costs nothing — but leaving it as a
raw alpha would force the PR 10 lint to carve out an exception, and an exception is how the next
hardcoded alpha gets in. `ring-accent/60` at `FlagPins.tsx:57` folds in here; the other two `/60`
ring sites (`ColorPicker.tsx:228`, `PropertiesPanel.tsx:584`) are a *selected-item* ring, a different
job, ruled under [open docket #5](#open-docket).

### Radius — `theme.extend.borderRadius`

The design system's ladder is shifted **exactly one step** against Tailwind's (DS `sm`=6px, Tailwind
`sm`=2px — a 3× error). `tailwind.config.js` has no `borderRadius` extend today, so all 91 sites are
on stock keys. **Name-based find-and-replace is forbidden**; the migration is driven by role.

| Token | Value | Class | Replaces | Sites |
|---|---|---|---|---|
| `--radius-2xs` *(new)* | 2px | `rounded-knob` | `rounded-sm`, `rounded-[2px]` | 6 |
| `--radius-xs` | 4px | `rounded-chip` | bare `rounded`, `rounded-[4px]` | 20 |
| `--radius-sm` | 6px | `rounded-field` | `rounded-md` | 23 |
| `--radius-md` | 8px | `rounded-card` | `rounded-lg` | ~30 |
| `--radius-lg-ov` | 12px | `rounded-panel` | `rounded-xl` | ~10 |
| `--radius-xl-ov` | 16px | `rounded-modal` | modal surfaces | 1 |

The `-ov` suffixes are deliberate: `--radius-lg` and `--radius-xl` are taken by `src/index.css`.

### Shadow and blur

| Token | Value | Class | Replaces | Sites |
|---|---|---|---|---|
| `--shadow-dock` | `shadow-lg` geometry @ 0.20 | `shadow-dock` | `shadow-lg shadow-black/20` ×2, bare `shadow-lg` ×4 | 6 |
| `--shadow-pop` | `shadow-xl` geometry @ 0.20 | `shadow-pop` | `shadow-xl shadow-black/20` ×1, bare `shadow-xl` ×3 | 4 |
| `--shadow-modal` *(new)* | `0 25px 50px -12px rgb(0 0 0/.25)` | `shadow-modal` | `shadow-2xl` (`RevertConfirmDialog.tsx:44`) | 1 |
| `--overlay-blur` | 8px | `backdrop-blur-overlay` | bare `backdrop-blur` | 7 |
| `--scrim-blur` *(new)* | 4px | `backdrop-blur-scrim` | `backdrop-blur-sm` | 1 |

`--scrim-blur` is deliberately half `--overlay-blur` so the dimmed host stays legible.

### Motion

Zero migration. Two small additions fold into PR 1: expose the duration scale as
`transitionDuration: { fast, base, mid, slow, morph, pop }` (today only `DEFAULT` is exposed, so 12
sites fall back to arbitrary or stock values including a `duration-[120ms]` that is on neither
scale), and add `transitionTimingFunction['in-out']`. Three sites hand-type
`ease-[cubic-bezier(0.16,1,0.3,1)]` where it is already the `DEFAULT` — redundant no-ops to delete.

**Do not import `tokens/motion.css`** — it would emit all six `@keyframes` a second time into the
shadow stylesheet.

## Gaps and rulings

Seven tokens to add (above, marked *new*). Six values migrate to existing tokens:

| Value | Ruling |
|---|---|
| 14px FAB wordmark (`MuseToolbar.tsx:274`) | → `text-row` (13px). 14px has no overlay token. If 14px is non-negotiable as brand it needs `--text-wordmark` and an explicit note that it is the one overlay size above the chrome ceiling — [open docket #1](#open-docket). |
| `text-[10.5px]` (`SelectionOverlay.tsx:35`) | → `text-chip`. Every other mono chip is exactly 10px, and a half-pixel size rasterises inconsistently across platforms, so the intended distinction is not reliably rendered. Width is governed by `max-w-[260px] truncate` at line 41 regardless. |
| `text-[8px]` (`PropertiesPanel.tsx:589`) | → **not typography.** An `aria-hidden` `×` glyph in the no-shadow swatch. Replace with a Phosphor `<X/>` at fixed size; the design system's own "no unicode-as-icon" rule covers it, and it deletes the outlier rather than tokenizing it. |
| `bg-line/[0.04]`, `bg-line/[0.06]` (`TokenList.tsx:39/168`) | → `bg-scrim` (0.05). Visually indistinguishable. |
| `ring-accent/25` (`TokenList.tsx:39`) | → focus token. This is the only overlay control using `focus:` rather than `focus-visible:`, so it shows a ring on mouse click — which the design system explicitly forbids. The alpha is not the defect. |
| `line/25` (`CanvasMode.tsx:1793` keycap) | → `hairline-strong`. Its twin at `ShortcutsPanel.tsx:8` uses `/20` with `bg-line/5`. Two keycaps, two border alphas, two face alphas, no design intent — converge both on `border-hairline-strong bg-scrim font-medium`. |

**Design-system-side deletions**, carried in a parallel non-blocking PR: `--radius-2xl` (0
consumers, no role prose), `--tap-min` 44px (contradicted by the design system's own `--icon-btn:
32px`; Muse is a desktop dev tool), `--control-h` (no overlay consumer), the `--space-*` scale (18
inert custom properties restating Tailwind's built-in 4px scale verbatim), `--fw-bold`.

**Migration-script warning:** arbitrary-bracket alphas (`bg-line/[0.04]`) are invisible to a `/N`
grep, as are `muse.css:105`'s `0.34` and `ReorderOverlay.tsx:496`'s
`rgb(var(--muse-accent)/0.35)`. Scan both forms or four sites are missed.

## Conflicts

### 1 — BLOCKING: accent-on-tint fails WCAG AA, and the design system sanctions the pairing

`readme.md` states *"Brick is never a button fill (buttons are ink)"* but separately blesses *"the
selected/active tint (at ~10% alpha)"* and *"an accent-text color"*, and
`components/overlay/IconButton.jsx` ships `background: rgb(var(--muse-accent) / .1); color:
rgb(var(--muse-accent))` verbatim. The code follows suit at `MuseToolbar.tsx:73`,
`FlagsPanel.tsx:143`, `CanvasMode.tsx:1530`, and `PropertiesPanel.tsx:325`.

Recomputed with 8-bit sRGB compositing:

| Pairing | Composited bg | Contrast |
|---|---|---|
| `text-accent` on `bg-accent/10`, **dark** `#141210` | `#1F1513` | **2.00:1** — fails AA (4.5) and non-text (3.0) |
| `text-accent` on `bg-accent/10`, **light** `#FBF9F6` | `#EFE5E2` | **7.22:1** — passes |
| `text-accent-hover` `#964343` on the dark tint | — | **2.71:1** — also fails |

Two things follow. It is **dark-theme only**, so a fix that changes the light theme over-corrects.
And `--muse-accent` at relative luminance 0.0675 **cannot reach 4.5:1 against any near-black surface
at any tint alpha** — lowering the tint does not help. The foreground must change.

**Resolution, both moves design-system-compliant:**

1. **Buttons become ink.** `FlagsPanel.tsx:143` primary → `bg-fg text-surface` (the exact treatment
   `ChangesPanel.tsx:168` already uses); secondary → ghost. Result **16.35:1 dark / 16.52:1 light**.
   This is the design system's own written rule, currently followed by one panel and violated by the
   other.
2. **Selected/active states keep the ~10% tint** (sanctioned) **and change the foreground to
   `text-accent-fg`** — dark `#E3A384`, light `#7F2F2F`. Result **8.38:1 dark / 7.22:1 light**.

**Cost: 5 call sites, 2 token additions**, plus one design-system-side fix to `IconButton.jsx`.

**The trap:** raising the tint from `/10` to `/15` — the natural "make it more visible" instinct —
makes dark contrast *worse*, because the background moves toward the text. A tint-scale cleanup must
not be mistaken for the accessibility fix.

**Named but out of scope:** `MuseToolbar.tsx:264` renders the manta at `text-accent` on
`bg-surface-soft` — 1.94:1. WCAG 1.4.11 exempts logotypes, so this is compliant, and also genuinely
dim. [Open docket #2](#open-docket).

### 2 — HIGH: eleven overlay sites are rem-based inside a shadow root

`CanvasMode.tsx:1668`, `MuseToolbar.tsx:274`, `RevertConfirmDialog.tsx:48/60/67` use `text-sm`
(0.875rem); `RevertConfirmDialog.tsx:50` uses `text-xs`; `MeasureOverlay.tsx:38` and
`PropertiesPanel.tsx:902/935/967/1038` use `leading-4` (1rem).

**Shadow DOM does not isolate root-relative units** — these resolve against the *host document's*
`<html>`. On a host running `html{font-size:62.5%}` (a common legacy reset) the Canvas banner and the
entire Revert dialog render at 62.5% of intended size while the px chrome beside them holds.

This is the only **functional** bug in the set, and it lands on exactly the surface Muse claims to be
indifferent to. It ships before any cosmetic work.

### 3 — HIGH: seven elevated surfaces ship at half the intended alpha

Only `MuseToolbar.tsx:220` passes `shadow-xl shadow-black/20`. `PropertiesPanel.tsx:184`,
`PropertiesPanel.tsx:807`, and `FlagComposer.tsx:80` ship bare `shadow-xl` (0.10). Same miss on the
dock tier at `SelectionOverlay.tsx:35` and `CanvasMode.tsx:1511/1522/1668`.

Mechanical once `boxShadow.pop`/`.dock` exist — but decide first whether the canvas hint and banner
surfaces genuinely want a lighter shadow than the dock. If so the design system needs a documented
third tier rather than an undocumented accident. [Open docket #6](#open-docket).

### Lower-severity conflicts

Carried but not blocking: the design system uses `border` where the repo and its own readme use
`ring`; three rival treatments exist for "this option is selected"; `--scrim` is labelled "hover
wash" but is a resting fill in 6 of 8 uses (hence the `--fill-recessed` rename); `animate-pulse` on
the Share button breaks three motion rules at once; reduced-motion is "keep the fade" in CSS and
"kill it" in JSX; press-scale magnitude differs from the stated rule at a few sites.

## Integration recipe

### Step 0 — fix the build pipeline. Its own PR, before any token moves.

`scripts/build-overlay-css.mjs:48` globs `./src/muse/**/*.{ts,tsx}`, which matches
`src/muse/generated/overlayCss.ts` — so Tailwind re-harvests class names out of its own previous
output. Verified at HEAD: the committed artifact is **65,218 bytes** and contains `.min-h-screen`,
`.max-w-2xl`, `.max-w-6xl`, `.border-slate-200`, `.animate-spin`, `.grid-cols-4`, `.space-y-6`, and
`.backdrop-blur-xl` — all with zero occurrences anywhere in real `src/muse` source.

**Why this blocks the migration specifically:** retired *arbitrary* classes self-clean, because their
compiled selectors are escaped (`\[`) and the extractor cannot re-read them. Retired *plain* classes
are sticky forever. This migration swaps arbitrary names (`text-[11px]`, `bg-accent/15`) for plain
ones (`text-field`, `bg-tint`). Without the fix, every rename permanently grows the shipped
stylesheet and there is no way to verify a migrated-away class actually died.

```js
// scripts/build-overlay-css.mjs:48
files: ['./src/muse/**/*.{ts,tsx}', '!./src/muse/generated/**'],

// tailwind.config.js:27 — the docs-site bundle has identical contamination
content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/muse/generated/**'],

// scripts/build-overlay-css.mjs:34 — make output EOL-deterministic across runners
const museCss = fs.readFileSync(museCssPath, 'utf8').replace(/\r\n/g, '\n')
```

Delete and regenerate the artifact in the same commit — it will not shrink on its own, being a locked
fixed point (two rebuilds are byte-identical).

**CI gate**, appended to the existing ubuntu-only `build` job (`.github/workflows/ci.yml:28-37`,
which already runs `npm run build` → `build:overlay-css`):

```yaml
      - run: npm run build
      - run: git diff --exit-code -- src/muse/generated/overlayCss.ts
```

Pinned to that one job deliberately — the `test` job is a ubuntu/windows matrix and Tailwind output
can differ across platforms. Accepted side effect: any bump to `tailwindcss`, `postcss`, or
`autoprefixer` reds the build until someone regenerates. That is the gate working.

### Step 1 — `src/muse/muse.css`

**Inside the existing `[data-muse-ui]` block at `muse.css:22`, never `:root`.** Light-theme flips go
in the `[data-muse-ui][data-theme='light']` block at `muse.css:66`.

Add: the overlay type scale, tracking and leading; the hairline/wash/track alphas;
`--muse-accent-fg`; the overlay radii under role names; `--shadow-dock/-pop/-modal`,
`--overlay-blur`, `--scrim-blur`.

**Do not integrate:** `tokens/motion.css` (duplicate keyframes); `tokens/fonts.css` — its `@import`
would be concatenated *after* the `@tailwind` output at `build-overlay-css.mjs:53`, and a non-leading
`@import` is invalid CSS and silently dropped (Inter is already loaded by `index.html`); the
`--space-*` scale; `--fw-*`; the docs-site type scale; `--site-*` and `--stone-*`.

### Step 2 — `tailwind.config.js`

```js
theme: { extend: {
  fontSize: {
    row:       ['var(--text-row)',         { lineHeight: '1.375' }],
    title:     ['var(--text-panel-title)', { lineHeight: '1.375', letterSpacing: 'var(--tracking-title)' }],
    'body-sm': ['var(--text-body-sm)',     { lineHeight: '1.625' }],
    field:     ['var(--text-field)',       { lineHeight: '1.375' }],
    eyebrow:   ['var(--text-eyebrow)',     { lineHeight: '1.15',  letterSpacing: 'var(--tracking-wide)' }],
    chip:      ['var(--text-chip)',        { lineHeight: '16px' }],
    badge:     ['var(--text-badge)',       { lineHeight: '1' }],
  },
  letterSpacing: { tight: '-0.02em', title: '-0.01em', wide: '0.02em' },
  borderRadius: {
    knob: 'var(--radius-2xs)', chip: 'var(--radius-xs)',  field: 'var(--radius-sm)',
    card: 'var(--radius-md)',  panel: 'var(--radius-lg-ov)', modal: 'var(--radius-xl-ov)',
  },
  colors: {
    scrim: 'var(--fill-recessed)', wash: 'var(--wash-hover)',
    hairline: 'var(--hairline)', 'hairline-strong': 'var(--hairline-strong)',
    'hairline-contrast': 'var(--hairline-contrast)',
    track: 'var(--control-track)', 'track-quiet': 'var(--control-track-quiet)',
    'track-hover': 'var(--control-track-hover)',
    accent: { /* keep DEFAULT + hover */ fg: 'rgb(var(--muse-accent-fg) / <alpha-value>)' },
    tint: 'var(--tint-active)', 'tint-hover': 'var(--tint-active-hover)',
  },
  ringColor: { focus: 'var(--focus-ring)' },
  boxShadow: { dock: 'var(--shadow-dock)', pop: 'var(--shadow-pop)', modal: 'var(--shadow-modal)' },
  backdropBlur: { overlay: 'var(--overlay-blur)', scrim: 'var(--scrim-blur)' },
  transitionDuration: { fast: DUR.fast, base: DUR.base, mid: DUR.mid, slow: DUR.slow, morph: '140ms', pop: '150ms' },
  transitionTimingFunction: { 'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)' },
}}
```

Docs-site protection is **structural, not procedural**: one config serves both surfaces. Adding keys
under `extend` is safe; redefining a stock key is not. Every key above is a role name, so the
collision surface is zero by construction.

### Step 3 — regeneration

`npm run dev` is bare `vite` (`package.json:7`) and **never** regenerates. Anyone who changes a class
and checks with the dev server alone sees the *old* stylesheet and concludes the token does not work.

**Rule for every PR touching a class in `src/muse`:** run `npm run build:overlay-css`, commit
`src/muse/generated/overlayCss.ts`, then verify by grepping the **regenerated file** — not by
eyeballing the dev server. Optionally add `"predev": "npm run build:overlay-css"` to `package.json`.

### Step 4 — what stays raw CSS

Never becomes a utility: the multi-property transitions on `.muse-panel-surface` / `.muse-pop` /
`.muse-dock-trail`; `@starting-style`; `[data-closing]` and `[data-state=closed]`; the three
`prefers-reduced-motion` blocks; `interpolate-size: allow-keywords` (`muse.css:41` — without it the
panel's height reshape snaps); `::-webkit-scrollbar*` and `scrollbar-color/-width`;
`--muse-pop-origin` (set per-caller at runtime); `grid-template-columns: 0fr/1fr`; all `@keyframes`.

## Sequencing

Correctness precedes cosmetics. Alpha, radius, and shadow split out of the popover/canvas division
because they cross-cut every file and are mechanically distinct from type.

| # | PR | Proves |
|---|---|---|
| 0 | Pipeline: glob exclusion ×2, CRLF normalization, regenerated artifact, CI diff gate | Artifact is reproducible and byte-stable on a clean runner; dead classes can be collected. ~65,218 → ~54,300 bytes, −145 selectors, **zero source change** |
| 1 | Token layer only — vars into `muse.css`, keys into `tailwind.config.js`. **Zero call sites changed** | Purely additive: the artifact diff shows only new selectors, and no docs-site class changed value. De-risks everything after it |
| 2 | Rem eviction — 11 sites → px tokens | The overlay renders identically on a host with `html{font-size:62.5%}`. Verify against a deliberately-reset host, not the docs site |
| 3 | Contrast — `--muse-accent-fg`, 4 foreground swaps, FlagsPanel primary → ink | 2.00:1 → 8.38:1 (tints) and 16.35:1 (buttons), both themes, measured. 5 sites |
| 4 | Type — the 5 popovers (6 files, ~55 sites) | The tuple mechanism works on real chrome. Highest-density, lowest-risk surface. Also lands the 7 eyebrow collapses (zero visual change) |
| 5 | Type — canvas (10 files, ~35 sites) | On-canvas overlays survive a type-scale swap. Includes the 10.5px and 8px evictions |
| 6 | Type — `PropertiesPanel.tsx` alone (~45 sites) | The densest file migrates cleanly. Separate purely for diff reviewability |
| 7 | Alpha — ~68 `line/N` sites → `scrim`/`wash`/`hairline*`/`track*`, plus the remaining `accent/N` sites → `ring-focus` and the selected-item ring | The 4-role hairline model covers 100% of real usage. After this PR no raw alpha fraction remains, which is what makes PR 10's lint enforceable without exceptions |
| 8 | Radius + shadow/blur — ~90 + 19 + 8 sites | The one-step name shift is survivable when driven by role names. Also lands the half-alpha shadows |
| 9 | Primitives — `IconButton`, `Row`, `EmptyState`, `CountBadge` | The design system's contracts are adoptable even though its CSS delivery is not |
| 10 | Lint gate — ban `text-[…]`, `tracking-[…]`, `rounded-[…]`, raw `letter-spacing:`, `line/[0.0N]` in `src/muse/**` | The escape hatch closes |

**Parallel, non-blocking:** a design-system-side PR carrying the seven token additions, the
`IconButton.jsx` accent-foreground fix, the `Toggle.jsx` and `SegmentedControl.jsx` untokenized
alphas, the `--fw-bold` / `--radius-2xl` / `--tap-min` / `--control-h` / `--space-*` deletions, and
the `--radius-lg` readme correction.

## How we will know it worked

1. **Greppable, and wired into CI as PR 10.** Zero hits across `src/muse/**/*.tsx` for
   `text-\[[0-9.]+px\]`, `(line|accent)/[0-9.]`, `(line|accent)/\[`, `rounded-\[`, `tracking-\[`,
   and one `primary` button implementation. No carve-outs — PR 7 exists precisely so this pattern
   needs none.
2. **PR 0 is self-verifying**: the regenerated artifact shrinks by ~145 selectors with zero source
   change, and the CI `git diff --exit-code` gate proves reproducibility on a clean runner.
3. **PR 1 is self-verifying**: the artifact diff must contain *only additions*. Any modified or
   removed selector means a stock key was redefined — stop and fix the naming.
4. **PR 2 has a concrete test**: render the overlay on a host with `html{font-size:62.5%}` and
   confirm the banner and Revert dialog match the px chrome.
5. **PR 3 has measured numbers**, both themes, stated above.

**What none of this measures is whether it looks better.** The E2E suite asserts on the fixture app's
source bytes — it catches "the scrub field stopped writing to disk," not "the panel looks subtly
worse." There is no automated guard on the overlay's own appearance, and screenshot compositing has
produced false readings in this project three separate times. The visual check is a human one, per
PR — which is the reason for file-sized PRs rather than one sweep.

## Regression risks

### A — the design system's delivery mechanism cannot reach the overlay

Hard blocks, resolved by the [architecture ruling](#the-ruling-adopt-the-values-and-the-contracts-not-the-css-delivery-or-the-components):
document-head style injection, the CDN icon font, inert `:root` blocks, and `Kbd`'s dark branch
keying off `.dark` (which does not exist inside the shadow root, so a small keycap would paint white
on near-black glass).

### B — adopting a component wholesale drops shipped behavior

This is why PR 9 writes primitives natively against the design system's *contracts*:

| Component | Would drop |
|---|---|
| `SegmentedControl` | `role=tablist/tab/aria-selected` replacing the repo's `radiogroup/radio/aria-checked`. Three repo instances use radio semantics and two comment on why. Tabs promise a `tabpanel` that does not exist and need roving tabindex the design system does not implement. **Strict a11y downgrade** |
| `Panel` | `data-muse-panel` — `PropertiesPanel.tsx:119` does `closest('[data-muse-panel]')` to anchor the color picker, so **the picker's position breaks**. Also `data-state` + `--muse-pop-origin` (the per-corner grow-out-of-the-dock exit), the Esc handler at `MuseToolbar.tsx:222-230`, the `max-h-[340px]` scroll cap, and the documented *"NO focus trap here, deliberately"* decision |
| `Chip` | `PropertiesPanel.tsx:906-912` hides the `×` until hover and grows the hit area, commenting that it is *"a misclick magnet."* The design system's `×` is always visible with no hit-area expansion — **reintroduces a fixed hazard** |
| `TokenRow` | The entire hex branch (`TokenList.tsx:129-155`): ColorPicker with live host-root preview, `portalContainer` to escape the `backdrop-filter` containing block, and an `onClose` that clears the override so undo is not masked. Non-hex falls back to text *specifically* so editing `oklch()` does not rewrite the author's color space |
| `UndoRedoBar` | Revert gated on `loading` alone instead of `!canUndo \|\| loading` — **ships an always-live revert-all on empty history**. No `danger` tone. And it uses `arrow-counter-clockwise` for *undo*, which is the repo's *revert* glyph |
| `Dock` | Zen mode entirely — the hidden state, the corner hotspot, the peek timer whose comment records *"a real user was unable to find Muse at all"*, and the pointer-events exclusivity invariant at `MuseToolbar.tsx:180-184` documenting a bug already shipped and fixed |
| `Badge` | Clamps to `"9+"`. `FlagsPanel.tsx:77` renders an **ordinal** matching on-page pin numbers — flag #12 would render as `"9+"` while its pin reads `12` |
| `MantaMark` | `const run = loading \|\| animated` — a bare `<MantaMark/>` is **still**. `UfoIcon.tsx` always runs the mount idle settle, so a faithful-looking adoption silently removes the dock mark's signature undulation |
| `ScrubField` | The most faithful port, but drops `data-testid={\`scrub-${label}\`}` — which the E2E suite selects on — and makes `onPreview`/`onCommit` optional, so a silently inert scrub field type-checks |
| `Toggle` | Behaviorally correct, but the **rationale** appears nowhere. `SettingsPanel.tsx:68-70` explains that rem travel *"resolves against the HOST page's root font-size — a 62.5%-base host would strand the knob."* That comment must travel with the code |

### C — the migration's own risks

Regenerating the artifact is mandatory and invisible if skipped. A migration script must scan
arbitrary-bracket alphas as well as `/N`. And `src/muse/style/tailwindScales.ts:27-30` hardcodes
stock Tailwind tracking values feeding `TRACKING_INVERSE` (`:194`) → `trackingToken()` (`:234`) —
host projects are unaffected, but when Muse edits **its own docs site**, a tracking scrub will emit
`tracking-[-0.02em]` instead of the named `tracking-tight` once the config alias changes. Accept the
arbitrary output or make `TRACKING` project-aware; that decision must not be smuggled into PR 1.

## Open docket

Ten value calls the design system does not settle. None changes this plan; each is settled inside the
PR that touches it.

1. **FAB wordmark** — `text-row` (13px, joins the scale) or `--text-wordmark` (14px brand exception)?
2. **The manta at 1.94:1** — logotype-exempt, so taste rather than compliance. Acceptable?
3. **Toggle knob travel** — the repo's 16px (flush right, asymmetric) or the design system's 14px
   (symmetric 2px insets)? The latter is more defensible and visibly shifts the on-state 2px.
4. **Reduced motion** — accept `motion-reduce:animate-none` for one-shot entrances (8 shipped sites)
   and soften the design system's "keep the fade" wording, or add fade-only variants?
5. **Selected-state treatment** — raised chip, neutral wash, or accent tint? One rule for all
   exclusive-choice controls, or is the toolbar toggle a different species?
6. **Canvas hint/banner shadows** — intentional third tier, or the same half-alpha miss?
7. **`--control-track-hover` at 0.60** — a 2× jump off 0.30. Keep the snap or calm it to ~0.45?
8. **The Revert dialog** — overlay chrome or a docs-scale surface? It uses overlay color and
   elevation tokens with docs-scale type. Recommend overlay; needs a ruling either way.
9. **`ui.tsx:21`'s `tracking-wider`** (0.05em) — a deliberate second uppercase treatment needing a
   token, or drift toward `tracking-wide`?
10. **Design-system API with no repo consumer** — `Button`'s `ghost`/`sm`/`lg`, `Card`'s
    `interactive`, `Chip`'s `tone="accent"`, `MantaMark`'s `badge`. Keep as forward-looking API or
    prune? The readme's *"values verbatim from the product"* claim does not hold for them.
