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
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
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
      },
      // A strong ease-out (Emil: the built-in curves are too weak) for the docs
      // site's interactions — press feedback, the feedback panel, page entrances.
      transitionTimingFunction: {
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
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
