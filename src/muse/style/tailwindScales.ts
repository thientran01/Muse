// ============================================================
//  Tailwind scales — the single source of truth for token ↔ value
// ------------------------------------------------------------
//  Two directions live here so they can never drift apart:
//    • FORWARD  (token → CSS value): used by diffPreview to render a live
//      preview of a className change without waiting for the JIT bundle.
//    • INVERSE  (CSS value → token): used by the deterministic style editor
//      (server/styleEdit.ts) to turn a scrubbed value back into a Tailwind
//      utility — a named step when the value lands on the scale (p-6), or an
//      arbitrary value when it doesn't (p-[17px]).
//  Pure module: no DOM, no React — the Vite-plugin server imports it too.
// ============================================================

// --- FORWARD: token suffix → value ------------------------------------------
export const FONT_WEIGHT: Record<string, string> = {
  thin: '100', extralight: '200', light: '300', normal: '400',
  medium: '500', semibold: '600', bold: '700', extrabold: '800', black: '900',
}
export const FONT_SIZE: Record<string, [string, string]> = {
  xs: ['0.75rem', '1rem'], sm: ['0.875rem', '1.25rem'], base: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'], xl: ['1.25rem', '1.75rem'], '2xl': ['1.5rem', '2rem'],
  '3xl': ['1.875rem', '2.25rem'], '4xl': ['2.25rem', '2.5rem'], '5xl': ['3rem', '1'],
  '6xl': ['3.75rem', '1'], '7xl': ['4.5rem', '1'], '8xl': ['6rem', '1'], '9xl': ['8rem', '1'],
}
export const TRACKING: Record<string, string> = {
  tighter: '-0.05em', tight: '-0.025em', normal: '0em',
  wide: '0.025em', wider: '0.05em', widest: '0.1em',
}
export const LEADING: Record<string, string> = {
  none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2',
}
export const ROUNDED: Record<string, string> = {
  none: '0px', sm: '0.125rem', '': '0.25rem', md: '0.375rem', lg: '0.5rem',
  xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px',
}

// Tailwind spacing scale → rem (the steps the design presets actually emit).
export const spaceRem = (n: string): string | null => {
  const v = Number(n)
  return Number.isFinite(v) ? `${v * 0.25}rem` : null
}

// --- INVERSE: value → token suffix ------------------------------------------
// Tailwind's default spacing scale as [suffix, px @ 16px root]. `px` is the
// special 1px step; everything else is suffix*4 = px. Used to decide between a
// named utility and an arbitrary value when writing an edit.
const SPACING_STEPS: Array<[string, number]> = [
  ['0', 0], ['px', 1], ['0.5', 2], ['1', 4], ['1.5', 6], ['2', 8], ['2.5', 10],
  ['3', 12], ['3.5', 14], ['4', 16], ['5', 20], ['6', 24], ['7', 28], ['8', 32],
  ['9', 36], ['10', 40], ['11', 44], ['12', 48], ['14', 56], ['16', 64], ['20', 80],
  ['24', 96], ['28', 112], ['32', 128], ['36', 144], ['40', 160], ['44', 176],
  ['48', 192], ['52', 208], ['56', 224], ['60', 240], ['64', 256], ['72', 288],
  ['80', 320], ['96', 384],
]
const PX_TO_SUFFIX = new Map(SPACING_STEPS.map(([s, px]) => [px, s]))

// Parse a CSS length to px at a 16px root. Handles px / rem / unitless-0.
// Returns null for anything we can't resolve to a fixed px (em, %, calc, …).
export function lengthToPx(value: string): number | null {
  const v = value.trim()
  if (v === '0') return 0
  let m: RegExpMatchArray | null
  if ((m = v.match(/^(-?\d*\.?\d+)px$/))) return Number(m[1])
  if ((m = v.match(/^(-?\d*\.?\d+)rem$/))) return Number(m[1]) * 16
  return null
}

// A CSS length → its Tailwind spacing suffix if it lands exactly on the scale,
// else null. Negatives map to the positive step (the caller emits the leading
// `-` on the whole utility, e.g. `-mt-4`).
export function spacingSuffix(value: string): string | null {
  const px = lengthToPx(value)
  if (px === null) return null
  return PX_TO_SUFFIX.get(Math.abs(px)) ?? null
}

// A value is safe to embed in an arbitrary Tailwind token `prefix-[…]` only if
// it can't break out of the brackets or the surrounding className/JSX. Brackets,
// quotes, braces, semicolons and angle-brackets are disqualifying — such a value
// must go through inline style instead (the caller falls back on a null return).
const SAFE_ARBITRARY = /^[\w.%#,()+\-*/ ]+$/

// Build a spacing utility for a prefix (p, px, mt, gap-x, …) from a CSS value.
// `auto` → `${prefix}-auto`; on-scale → named step; off-scale → arbitrary value
// (spaces underscored, per Tailwind's arbitrary-value syntax). Returns null when
// the value can't be expressed safely as a class token — the caller then routes
// the mutation to inline style instead of emitting a malformed className.
export function spacingToken(prefix: string, value: string): string | null {
  const v = value.trim()
  if (v === 'auto') return `${prefix}-auto`
  const suffix = spacingSuffix(v)
  if (suffix !== null) {
    const neg = (lengthToPx(v) ?? 0) < 0 ? '-' : ''
    return `${neg}${prefix}-${suffix}`
  }
  if (!SAFE_ARBITRARY.test(v)) return null
  return `${prefix}-[${v.replace(/\s+/g, '_')}]`
}

// Exact regex for one spacing family's utilities, so removing/replacing `p-*`
// can't accidentally swallow `px-*`, `pt-*`, `placeholder-*`, etc. Matches the
// optional negative prefix, named steps, `auto`, and arbitrary `[...]` values.
export function spacingFamilyRe(prefix: string): RegExp {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^-?${esc}-(?:auto|px|\\d+(?:\\.5)?|\\[[^\\]]+\\])$`)
}
