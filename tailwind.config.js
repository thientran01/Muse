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
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  // "Absorb": slight ease-IN so the panel accelerates as the FAB swallows it,
  // rather than drifting to a stop mid-air. Used only for collapse-into-FAB.
  absorb: 'cubic-bezier(0.4, 0, 0.7, 1)',
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
      // Muse motion — keyframes describe WHAT moves; the `animation` block below
      // binds each to a duration + easing from the EASE/DUR tokens at the top of
      // this file (the single source of truth, per Emil's "encode the rules").
      keyframes: {
        // Panel entrance: scales up from ~0.96 (never from 0) and rises a touch.
        // Paired with `origin-bottom-right` so it grows out of the FAB corner.
        'muse-panel-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Step-to-step content swap (intent -> questions -> edit). A small rise
        // plus a clearing blur to smooth an otherwise abrupt content change.
        'muse-step-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)', filter: 'blur(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        // The "Applied" success moment — a rare, delightful beat, so it earns one.
        'muse-rise-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Panel exit — collapses INTO the FAB. Panel and FAB share the
        // bottom-right corner (origin-bottom-right), so scaling down toward that
        // origin makes the panel converge onto the button. Blur masks the morph
        // (Emil tip #7).
        'muse-panel-out': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
          '100%': { opacity: '0', transform: 'translateY(4px) scale(0.45)', filter: 'blur(3px)' },
        },
        // Panel content empties faster than the shell, so the collapse reads as a
        // shrinking card rather than shrinking text.
        'muse-content-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        // FAB "catches" the collapsing panel — grows in from the same corner.
        'muse-fab-catch': {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        // Entrances — all easeOut, sized by how much moves.
        'muse-panel': `muse-panel-in ${DUR.slow} ${EASE.out}`,
        'muse-step': `muse-step-in ${DUR.base} ${EASE.out}`,
        'muse-rise': `muse-rise-in ${DUR.mid} ${EASE.out}`,
        // Collapse-into-FAB: the panel is *absorbed* (ease-in) while its content
        // fades faster, then the FAB "catches" it (easeOut, 40ms delay so it
        // emerges as the panel falls in). Both run ${DUR.mid} so they read as one.
        'muse-panel-out': `muse-panel-out ${DUR.mid} ${EASE.absorb} forwards`,
        'muse-content-out': `muse-content-out ${DUR.fast} ${EASE.out} forwards`,
        'muse-fab-catch': `muse-fab-catch ${DUR.mid} ${EASE.out} 40ms backwards`,
      },
    },
  },
  plugins: [],
}
