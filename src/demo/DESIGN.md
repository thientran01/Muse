<!--
  Format: DESIGN.md (https://github.com/google-labs-code/design.md), © Google,
  Apache-2.0. Structure (token frontmatter + ordered prose sections) is borrowed;
  all content below describes THIS app's design system.

  HOW MUSE USES THIS FILE: it is injected into Muse's context on every edit so
  proposals stay on-brand. The tokens are NORMATIVE — prefer them over invented
  values. In code, colors are CSS variables that flip per theme, so always apply
  them through the variable (e.g. text-[color:var(--c-energy)]), never as raw hex.
-->
---
name: Dink Den Design System
description: A warm, editorial, high-energy design system for a social pickleball app — deep-forest dark surfaces, a cream canvas, and electric lime/orange accents.
colors:
  # Apply in code via the matching CSS variable, e.g. bg-[color:var(--c-bg)].
  bg: "#0f1f1a"            # var(--c-bg) — deep forest; app background (dark default)
  surface: "#1a2e26"       # var(--c-surface) — raised panels/cards on the dark bg
  card: "#f5f1e8"          # var(--c-card) — warm cream; light cards / inverted blocks
  ink: "#0f1f1a"           # var(--c-ink) — near-black text on light surfaces
  muted: "#6b7670"         # var(--c-muted) — secondary/meta text
  line: "rgba(15,31,26,0.10)"   # var(--c-line) — hairline dividers
  energy: "#d4ff3a"        # var(--c-energy) — PRIMARY accent (lime): active states, key CTAs, emphasis
  pop: "#ff6b35"           # var(--c-pop) — SECONDARY accent (orange): highlights, badges, "hot" signals
  on-bg: "#f5f1e8"         # var(--c-on-bg) — primary text/icon color on the app bg
  on-bg-muted: "rgba(245,241,232,0.55)"  # var(--c-on-bg-muted) — dimmed text on the app bg
typography:
  display-xl:
    fontFamily: Bricolage Grotesque
    fontSize: 36px
    fontWeight: "800"
    lineHeight: 1.05
    letterSpacing: -0.02em
  display-lg:
    fontFamily: Bricolage Grotesque
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 1.1
    letterSpacing: -0.01em
  heading:
    fontFamily: Bricolage Grotesque
    fontSize: 18px
    fontWeight: "700"
    lineHeight: 1.2
    letterSpacing: -0.01em
  body:
    fontFamily: Schibsted Grotesk
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 1.5
    letterSpacing: 0em
  label:
    fontFamily: Schibsted Grotesk
    fontSize: 10px
    fontWeight: "700"
    lineHeight: 1.2
    letterSpacing: 0.18em      # uppercase eyebrow/label
  stat:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: "700"
    lineHeight: 1.2
    letterSpacing: 0em         # numerics: scores, ELO, W–L (use tabular-nums)
rounded:
  card: 1.25rem    # var(--r-card) — cards, panels, modals
  chip: 999px      # var(--r-chip) — pills, toggles, avatars, badges
  sm: 0.375rem     # small inline tags
spacing:
  pad: 1.25rem     # var(--pad) — default card padding
  unit: 4px        # Tailwind base step (gap-2 = 8px, etc.)
components:
  button-primary:
    backgroundColor: "{colors.energy}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    typography: "{typography.label}"
  chip-toggle-active:
    backgroundColor: "{colors.energy}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
  badge-hot:
    backgroundColor: "{colors.pop}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.pad}"
---

# Dink Den Design System

## Brand & Style

A social pickleball app with the energy of a local league and the polish of a sports magazine. The audience is competitive-but-casual players who check standings, log matches, and trash-talk friends. The feel is **warm, editorial, and kinetic** — never sterile or corporate. Deep-forest darkness sets a premium, focused stage; electric lime and orange accents supply the playful, athletic charge. Lean confident and a little loud: bold display type, decisive accents, and texture (court lines, dotted grids) that signals "this is a game."

Default surface is dark; a light theme mirrors every color via CSS variables. Because of that, **always style color through the variable, never a hardcoded hex** — a raw color breaks theme switching.

## Colors

The palette pairs grounded neutrals with two high-voltage accents.

- **Energy / lime (`var(--c-energy)`):** the primary accent. Active toggles, key CTAs, and the single most important thing on screen. Use sparingly so it keeps its punch. On lime, text is ink (`var(--c-ink)`), never white.
- **Pop / orange (`var(--c-pop)`):** the secondary accent. "Hot" signals — win streaks, the "You" badge, player-of-the-week, fire icons. Pairs with white text.
- **Background / surface:** `var(--c-bg)` (deep forest) is the canvas; `var(--c-surface)` lifts cards a step above it. Cream `var(--c-card)` is for inverted/light blocks.
- **Text:** `var(--c-on-bg)` on the app background, `var(--c-ink)` on light surfaces, `var(--c-muted)` / `var(--c-on-bg-muted)` for meta and secondary text.

Don't introduce new colors. If something needs emphasis, reach for energy or pop before inventing a hue.

## Typography

Three voices, each with a job:

- **Bricolage Grotesque** (`var(--font-display)`) — every heading and title. Bold to extra-bold, tight tracking, so headlines feel monumental and athletic.
- **Schibsted Grotesk** (`var(--font-body)`) — body copy, controls, and most UI text.
- **Mono** (`font-mono`, JetBrains Mono) — all numerics: scores, ELO, win–loss records, ranks. Always pair with `tabular-nums` so columns of figures align.

Small labels and eyebrows are tiny, uppercase, and widely tracked (`text-[10px] uppercase tracking-[0.18em]`), often in an accent color.

## Layout & Spacing

Dense but breathable, card-based. Spacing follows Tailwind's 4px scale; cards use `var(--pad)` (20px) internally. Group related items tightly (`gap-2`/`gap-3`) and separate sections generously (`mt-6`/`mt-8`). Multi-column layouts use an asymmetric grid (e.g. a wider primary column beside a narrower rail). Keep indentation and structure intact when editing — don't flatten nested JSX.

## Elevation & Depth

Depth is conveyed by surface color and texture, not heavy drop shadows. Cards sit on `var(--c-surface)`, a step up from the background. Hairline dividers (`border-[color:var(--c-line)]` / `var(--c-rail-line)`) separate rows. Texture overlays — court lines (`var(--court-lines-bg)`) and dotted grids (`var(--dotted-grid-bg)`) at low opacity — add atmosphere on feature cards. Use shadows rarely and softly.

## Shapes

Generously rounded and pill-forward. Cards and panels use `rounded-[var(--r-card)]` (20px); buttons, toggles, filter groups, avatars, and badges are fully round (`rounded-full` / `var(--r-chip)`). Small inline tags may use a modest `rounded`. Avoid sharp corners — the language is soft and friendly.

## Components

### Buttons & Toggles
Primary actions and active toggle states fill with lime (`bg-[color:var(--c-energy)]`) and ink text, fully rounded. Inactive toggles are muted text on a faint rail (`var(--c-rail-line)`), brightening on hover. Filter groups are pill clusters with a single active lime segment.

### Cards
Rounded `var(--r-card)` surfaces on `var(--c-surface)`, padded with `var(--pad)`. Feature cards layer a low-opacity texture overlay. Headings inside cards use Bricolage; meta uses muted mono.

### Badges & Labels
Status badges (e.g. "You", streaks) use orange (`var(--c-pop)`) with white text, small and tracked-uppercase. Eyebrow labels are tiny lime uppercase with `0.18em` tracking, often led by an icon.

### Stats & Rows
List rows (leaderboards, matches) align an avatar, name, and a right-aligned mono stat. ELO/scores are `font-mono font-bold tabular-nums`. Ranks are mono in muted color.

## Do's and Don'ts

- **Do** apply color through CSS variables (`text-[color:var(--c-energy)]`) so themes keep working. **Don't** hardcode hex values.
- **Do** reserve lime for the single most important accent per view; **don't** flood the screen with it.
- **Do** use mono + `tabular-nums` for every number. **Don't** set stats in the body font.
- **Do** keep things pill-rounded and textured. **Don't** introduce sharp corners or new colors/fonts.
- **Do** preserve existing indentation and JSX nesting when editing. **Don't** flatten or reformat untouched code.
