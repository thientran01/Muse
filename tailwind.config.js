/** @type {import('tailwindcss').Config} */

// ── Muse motion system ───────────────────────────────────────────────────────
// One source of truth for animation timing + easing, encoding Emil Kowalski's
// rules (emilkowal.ski/ui) so every Muse animation stays consistent:
//   • Easing is the most important part (tip #4): ease-OUT for enter/exit.
//   • Keep it fast — everything under 300ms (tip #6).
//   • Never scale from 0 (tip #2): entrances start ≥ 0.96.
//   • transform-origin matches the trigger (tip #5): set per-component.
//   • Blur masks an imperfect morph (tip #7): used on the panel collapse.
const EASE = {
  // Enter & exit: easeOutExpo — strong, snappy deceleration that settles soft.
  // One curve for everything, including the collapse: an ease-OUT fades the panel
  // early and decelerates it INTO the FAB (a soft landing), where an ease-in held
  // it visible until the last frame and then cut out abruptly.
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
}
// Duration scale — all under the 300ms ceiling, in ~40ms steps.
const DUR = {
  fast: '90ms',  // micro fades / content swaps
  base: '160ms', // default content step-in
  mid: '200ms',  // panel in-flight (collapse, catch) + the success beat
  slow: '220ms', // largest single element: the full panel entrance
}

export default {
  // src/muse/generated/** is excluded for the same reason build-overlay-css.mjs
  // excludes it: overlayCss.ts is compiled Tailwind output stored as a .ts
  // string, so scanning it re-harvests class names from a previous build and
  // keeps deleted ones alive in the docs-site bundle too.
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/muse/generated/**'],
  // The docs site toggles light/dark by adding a `dark` (or `light`) class on
  // <html>. Muse's own overlay reads that same class via useHostTheme, so one
  // toggle themes both the site and the overlay.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      // Muse design system — semantic tokens backed by CSS variables that
      // flip per theme. Light/dark values are defined in src/muse/muse.css
      // and toggled by useHostTheme() writing data-theme on [data-muse-ui].
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--muse-accent) / <alpha-value>)',
          hover: 'rgb(var(--muse-accent-hover) / <alpha-value>)',
          // Accent TEXT. --muse-accent never flips, so brick text on a brick tint
          // is unreadable on dark (2.00:1) — this flips to terracotta on dark for
          // AA, and stays brick on the warm-white light surface. See the spec.
          fg: 'rgb(var(--muse-accent-fg) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--muse-surface) / <alpha-value>)',
          soft: 'rgb(var(--muse-surface-soft) / <alpha-value>)',
          raised: 'rgb(var(--muse-surface-raised) / <alpha-value>)',
        },
        line: 'rgb(var(--muse-line) / <alpha-value>)',
        fg: {
          DEFAULT: 'rgb(var(--muse-fg) / <alpha-value>)',
          muted: 'rgb(var(--muse-fg-muted) / <alpha-value>)',
          faint: 'rgb(var(--muse-fg-faint) / <alpha-value>)',
        },
        // Diff colors — tinted bg + readable text, distinct triplets per theme.
        'diff-add': 'rgb(var(--muse-diff-add-tint) / <alpha-value>)',
        'diff-add-text': 'rgb(var(--muse-diff-add-text) / <alpha-value>)',
        'diff-del': 'rgb(var(--muse-diff-del-tint) / <alpha-value>)',
        'diff-del-text': 'rgb(var(--muse-diff-del-text) / <alpha-value>)',
        // Note colors — the panel's non-fatal warning strip (amber to the
        // error's rose), theme-flipped like the diff tokens.
        note: 'rgb(var(--muse-note-tint) / <alpha-value>)',
        'note-text': 'rgb(var(--muse-note-text) / <alpha-value>)',
        // Design-system alpha roles (2026-07-22). Pre-composited rgb() values, so
        // they intentionally take NO /alpha modifier — a role is one token, never a
        // fraction. Defined in muse.css as alpha of --muse-line/--muse-accent so
        // they flip with the overlay theme. Used as bg-scrim, border-hairline, etc.
        scrim: 'var(--muse-fill-recessed)',
        wash: 'var(--muse-wash-hover)',
        hairline: 'var(--muse-hairline)',
        'hairline-strong': 'var(--muse-hairline-strong)',
        'hairline-contrast': 'var(--muse-hairline-contrast)',
        track: 'var(--muse-track)',
        'track-quiet': 'var(--muse-track-quiet)',
        'track-hover': 'var(--muse-track-hover)',
        tint: 'var(--muse-tint-active)',
        'tint-strong': 'var(--muse-tint-strong)',
      },
      // Design-system type scale — the dense overlay chrome (10–13px). Role-named
      // so they can't collide with Tailwind's t-shirt-size keys (text-sm etc. stay
      // stock for the docs site). Tuples carry size + leading (+ tracking); WEIGHT
      // is never baked in — text-field genuinely splits 500/400, so a font-weight
      // in the tuple would silently flip one bucket.
      fontSize: {
        row: ['var(--muse-text-row)', { lineHeight: '1.375' }],
        title: ['var(--muse-text-panel-title)', { lineHeight: '1.375', letterSpacing: '-0.01em' }],
        'body-sm': ['var(--muse-text-body-sm)', { lineHeight: '1.625' }],
        field: ['var(--muse-text-field)', { lineHeight: '1.375' }],
        eyebrow: ['var(--muse-text-eyebrow)', { lineHeight: '1.15', letterSpacing: '0.02em' }],
        chip: ['var(--muse-text-chip)', { lineHeight: '16px' }],
        badge: ['var(--muse-text-badge)', { lineHeight: '1' }],
      },
      // NOTE: no `letterSpacing` extend. The overlay's title (-0.01em) and eyebrow
      // (0.02em) tracking are baked into their fontSize tuples above, so no standalone
      // tracking-* key is needed — and overriding stock `tracking-tight`/`tracking-wide`
      // (which the docs site uses 11×) would change the site. Aligning the site's
      // tracking to the DS's -0.02em is a separate, visible decision, not this layer's.
      borderRadius: {
        // Role ladder (2026-07-22). The DS radius names are shifted one step vs
        // Tailwind's, so role names are the only safe mapping — a name-based swap
        // of rounded-md would grow every field 6px→8px. Values in muse.css.
        knob: 'var(--muse-radius-knob)',
        chip: 'var(--muse-radius-chip)',
        field: 'var(--muse-radius-field)',
        card: 'var(--muse-radius-card)',
        panel: 'var(--muse-radius-panel)',
        modal: 'var(--muse-radius-modal)',
      },
      boxShadow: {
        dock: 'var(--muse-shadow-dock)',
        pop: 'var(--muse-shadow-pop)',
        modal: 'var(--muse-shadow-modal)',
      },
      backdropBlur: {
        overlay: 'var(--muse-blur-overlay)',
        scrim: 'var(--muse-blur-scrim)',
      },
      ringColor: {
        // 2px focus-visible ring — the one disciplined accent alpha, now named so
        // the PR-10 lint can ban raw ring-accent/50 without an exception.
        focus: 'var(--muse-focus-ring)',
        // The "this item is selected" ring — one token for the swatch, shadow
        // preset, and :hov pin, which had drifted to accent/60 / accent/60 / accent/30.
        selected: 'var(--muse-ring-selected)',
        // The measurement guide's region outline — decorative, its own value so it
        // isn't conflated with focus or selection.
        measure: 'var(--muse-ring-measure)',
      },
      borderColor: {
        // Text-input focus affordance — inputs show focus with an accent BORDER
        // (the ring is for buttons/controls). Tokenized so the lint can ban raw
        // border-accent/60 without an exception.
        focus: 'var(--muse-focus-border)',
      },
      // A strong ease-out (Emil: the built-in curves are too weak) for the docs
      // site's interactions — press feedback, the feedback panel, page entrances.
      // DEFAULT rebases every bare `transition`/`transition-colors`/... utility
      // onto the system curve + base duration, so a hover or press never falls
      // back to Tailwind's stock 150ms cubic-bezier(0.4,0,0.2,1) — the one place
      // the EASE/DUR tokens didn't reach.
      transitionTimingFunction: {
        DEFAULT: EASE.out,
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
        // Symmetric ease for on-screen MORPHS (the dock FAB↔toolbar stretch) —
        // easeOut's fast start lurches a morph. Mirrors muse.css's --muse-ease-in-out.
        // Named `morph` (→ ease-morph), NOT `in-out`, because `in-out` is the stock
        // key behind ease-in-out and overriding it would change that curve everywhere.
        morph: 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      transitionDuration: {
        DEFAULT: DUR.base,
        // The full DUR scale as named utilities, so a duration-* class binds to a
        // token instead of an arbitrary ms value. Mirrors the EASE/DUR block above.
        fast: DUR.fast,
        base: DUR.base,
        mid: DUR.mid,
        slow: DUR.slow,
        morph: '140ms',
        pop: '150ms',
      },
      // Muse motion — keyframes describe WHAT moves; the `animation` block below
      // binds each to a duration + easing from the EASE/DUR tokens at the top of
      // this file (the single source of truth, per Emil's "encode the rules").
      keyframes: {
        // Panel entrance: scales up from ~0.96 (never from 0) and rises a touch.
        // Origin-aware callers add `origin-bottom-right` to grow out of the FAB
        // corner; a centered modal (RevertConfirmDialog) leaves the default center.
        'muse-panel-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Top-anchored surface (the Canvas banner) — drops in FROM the top edge, so
        // the motion's direction matches where it arrives from (Emil: origin/arrival
        // direction). Just a short translate + fade, no blur (it's not a content swap).
        'muse-drop-in': {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Content swap within the panel (view switch, or step-to-step in a
        // thread). Pure opacity + clearing blur, NO transform: the panel
        // container itself animates its height to reshape around the new view
        // (see the `height` transition on .muse-panel-surface in muse.css), and
        // THAT reshape is the spatial motion. A transform here fought the
        // container's height change and was what read as "off" no matter the
        // value — slide, scale, or flat fade. Let the card reshape; just
        // crossfade the content (Emil: blur masks the swap).
        'muse-step-in': {
          '0%': { opacity: '0', filter: 'blur(2px)' },
          '100%': { opacity: '1', filter: 'blur(0)' },
        },
        // The "Applied" success moment — a rare, delightful beat, so it earns one.
        'muse-rise-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // FAB "catches" the collapsing panel — grows in from the same corner.
        // Kept as a keyframe (not a transition): it's a one-shot entrance on a
        // freshly-mounted button, never interrupted mid-flight (cancelling a
        // close just unmounts it), so the keyframe-restart caveat doesn't apply.
        'muse-fab-catch': {
          '0%': { opacity: '0', transform: 'scale(0.95)' }, // never scale from <0.95 (Emil tip #2); matches the other entrances
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Docs-site popover (feedback panel) — scales up from ~0.96, never 0.
        'site-pop': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Pure opacity fade — for surfaces where a scale/blur would read wrong
        // (a modal's backdrop scrim). Just resolves the jarring instant appear.
        'muse-fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      // NOTE: the panel's open AND close are CSS *transitions* (muse.css
      // `.muse-panel-surface` + `@starting-style` + `[data-closing]`), NOT
      // keyframes — so a click during the collapse smoothly reverses from the
      // current frame instead of restarting from zero (Emil: transitions
      // retarget mid-flight; keyframes restart). They still use EASE.out / DUR.mid.
      animation: {
        // Entrances — all easeOut, sized by how much moves.
        'muse-panel': `muse-panel-in ${DUR.slow} ${EASE.out}`,
        'muse-step': `muse-step-in ${DUR.base} ${EASE.out}`,
        'muse-rise': `muse-rise-in ${DUR.mid} ${EASE.out}`,
        'muse-drop': `muse-drop-in ${DUR.base} ${EASE.out}`,
        // FAB "catch" on collapse — 40ms delay so it emerges as the panel falls
        // in. (The panel collapse itself is a transition; see muse.css.)
        'muse-fab-catch': `muse-fab-catch ${DUR.mid} ${EASE.out} 40ms backwards`,
        // Docs-site motion (strong ease-out, sub-300ms).
        'site-pop': 'site-pop 180ms cubic-bezier(0.23, 1, 0.32, 1)',
        // Backdrop scrim fade (modal). Fast — the dialog itself is the focus.
        'muse-fade': `muse-fade-in ${DUR.fast} ${EASE.out}`,
      },
    },
  },
  plugins: [],
}
