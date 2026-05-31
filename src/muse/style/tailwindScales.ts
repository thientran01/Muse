import type { PropertySpec } from './properties'

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
//
// The sizing families (w/h) also carry keyword + fraction values — `w-full`,
// `w-screen`, `w-1/2`, `w-fit`, `w-min`, viewport units — which a px resize must
// REPLACE, or the new `w-[Npx]` would sit alongside `w-full` and they'd fight.
// Spacing families have no such tokens, so they keep the tight set.
export function spacingFamilyRe(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sizeExtra =
    prefix === 'w' || prefix === 'h'
      ? '|full|screen|svh|svw|lvh|lvw|dvh|dvw|min|max|fit|\\d+\\/\\d+'
      : ''
  return new RegExp(`^-?${escaped}-(?:auto|px|\\d+(?:\\.5)?|\\[[^\\]]+\\]${sizeExtra})$`)
}

// ============================================================
//  TYPOGRAPHY + COLOR — kind-aware tokens & family matchers
// ------------------------------------------------------------
//  Tailwind overloads prefixes: `text-` is font-size AND text-color; `font-` is
//  weight AND font-family. So we can't reuse the flat spacing matcher for these —
//  a font-size edit must never touch a `text-[color:var(--x)]`, a weight edit must
//  never touch `font-[var(--font-display)]`. The matchers below are content-aware
//  (a `text-[…]` is a SIZE only if the bracket parses as a length, a COLOR only if
//  it's #/rgb/hsl/color:/var(…)). Builders return null when a value can't be
//  expressed safely as a class — the engine then routes it to inline style.
// ============================================================

// Inverse of the forward maps above (kept derived so they can't drift).
const FONT_WEIGHT_INVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(FONT_WEIGHT).map(([name, val]) => [val, name]),
)
const TRACKING_INVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TRACKING).map(([name, val]) => [val, name]),
)
const FONT_SIZE_KEYS = Object.keys(FONT_SIZE)
const FONT_WEIGHT_KEYS = Object.keys(FONT_WEIGHT)
const LEADING_KEYS = Object.keys(LEADING)
const TRACKING_KEYS = Object.keys(TRACKING)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// --- bracket-content classifiers (the heart of the overload safety) ---
const isLengthArbitrary = (content: string): boolean => {
  const c = content.replace(/^length:/, '').trim()
  return c === '0' || /^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch)$/.test(c)
}
const isColorArbitrary = (content: string): boolean => {
  const c = content.replace(/^color:/, '').trim()
  return /^#[0-9a-fA-F]{3,8}$/.test(c) || /^(rgb|rgba|hsl|hsla)\(/.test(c) || /^var\(/.test(c)
}
const isWeightArbitrary = (content: string): boolean => /^[1-9]00$/.test(content.trim())

// --- typography token builders (value → token | null) ---
export function fontSizeToken(value: string): string | null {
  const px = lengthToPx(value)
  if (px === null || !Number.isFinite(px)) return null
  return `text-[length:${px}px]` // arbitrary, sets ONLY font-size (no line-height coupling)
}
export function fontWeightToken(value: string): string | null {
  const n = String(Math.round(Number(value)))
  if (FONT_WEIGHT_INVERSE[n]) return `font-${FONT_WEIGHT_INVERSE[n]}`
  return /^[1-9]00$/.test(n) ? `font-[${n}]` : null
}
export function leadingToken(value: string): string | null {
  const v = value.trim()
  if (/^\d*\.?\d+$/.test(v)) return `leading-[${v}]` // unitless multiplier
  const px = lengthToPx(v)
  if (px === null) return null
  const suffix = spacingSuffix(`${px}px`)
  return suffix !== null ? `leading-${suffix}` : `leading-[${px}px]`
}
export function trackingToken(value: string): string | null {
  const v = value.trim()
  if (v === 'normal' || v === '0' || v === '0px') return 'tracking-normal'
  if (TRACKING_INVERSE[v]) return `tracking-${TRACKING_INVERSE[v]}`
  if (/^-?\d*\.?\d+(px|em|rem)$/.test(v)) return `tracking-[${v}]`
  return null
}

// --- typography family matchers (predicate on one class token) ---
const namedRe = (prefix: string, keys: string[]) =>
  new RegExp(`^${esc(prefix)}-(?:${keys.filter(Boolean).map(esc).join('|')})$`)

export const isFontSizeToken = (tok: string): boolean => {
  if (namedRe('text', FONT_SIZE_KEYS).test(tok)) return true
  const m = tok.match(/^text-\[(.+)\]$/)
  return m ? isLengthArbitrary(m[1]) : false
}
export const isFontWeightToken = (tok: string): boolean => {
  if (namedRe('font', FONT_WEIGHT_KEYS).test(tok)) return true
  const m = tok.match(/^font-\[(.+)\]$/)
  return m ? isWeightArbitrary(m[1]) : false // excludes font-sans/serif/mono and font-[var(...)]
}
const leadingFamilyRe = new RegExp(`^leading-(?:${LEADING_KEYS.map(esc).join('|')}|\\d+(?:\\.5)?|\\[[^\\]]+\\])$`)
const trackingFamilyRe = new RegExp(`^tracking-(?:${TRACKING_KEYS.map(esc).join('|')}|\\[[^\\]]+\\])$`)

// --- color ---
const COLOR_NAMES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOR_KEYWORDS = 'white|black|transparent|current|inherit'

// Normalize a color value to #rrggbb, or null if we can't (so the caller skips a
// class write). Accepts #rgb / #rrggbb / rgb()/rgba().
function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(0, 7) // drop the alpha byte
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('')
  const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  return null
}

export function colorToken(prefix: string, value: string): string | null {
  const hex = normalizeHex(value)
  return hex ? `${prefix}-[${hex}]` : null
}

// Match an existing COLOR token of `prefix` (text-/bg-/border-) — a named palette
// color, a keyword, or an arbitrary [#hex|rgb|var|color:…]. The COLOR_NAMES
// whitelist + the color-content check naturally EXCLUDE the non-color members of
// these overloaded prefixes (text-lg/center, bg-cover/center, border-2/solid/t).
export function colorFamilyMatch(prefix: string, tok: string): boolean {
  const p = esc(prefix)
  const base = tok.replace(/\/[^/]*$/, '') // drop an /opacity modifier for the named check
  if (new RegExp(`^${p}-(?:${COLOR_KEYWORDS})$`).test(base)) return true
  if (new RegExp(`^${p}-(?:${COLOR_NAMES})-\\d{1,3}$`).test(base)) return true
  const m = tok.match(new RegExp(`^${p}-\\[(.+?)\\](?:\\/\\S+)?$`))
  return m ? isColorArbitrary(m[1]) : false
}

// True when this token paints a color via a CSS variable (e.g. text-[color:var(--x)])
// — the engine leaves these untouched (skip + warn) rather than hardcode a hex.
export function isVarColorToken(prefix: string, tok: string): boolean {
  return colorFamilyMatch(prefix, tok) && /var\(/.test(tok)
}

export { isLengthArbitrary, isColorArbitrary }

// --- kind-aware facade the engine calls ---------------------------------------
// buildToken: value → Tailwind class token (or null → route inline). familyMatcher:
// a predicate that finds the element's existing token of the SAME family to replace
// in place. spacing/length delegate to the unchanged spacing helpers; the rest
// dispatch per kind, so an edit only ever touches its own overloaded slice.
export function buildToken(spec: PropertySpec, value: string): string | null {
  switch (spec.kind) {
    case 'spacing':
    case 'length':
      return spacingToken(spec.tw, value)
    case 'fontSize':
      return fontSizeToken(value)
    case 'fontWeight':
      return fontWeightToken(value)
    case 'lineHeight':
      return leadingToken(value)
    case 'letterSpacing':
      return trackingToken(value)
    case 'color':
      return colorToken(spec.tw, value)
    default:
      return null
  }
}

export function familyMatcher(spec: PropertySpec): (tok: string) => boolean {
  switch (spec.kind) {
    case 'spacing':
    case 'length': {
      const re = spacingFamilyRe(spec.tw)
      return (t) => re.test(t)
    }
    case 'fontSize':
      return isFontSizeToken
    case 'fontWeight':
      return isFontWeightToken
    case 'lineHeight':
      return (t) => leadingFamilyRe.test(t)
    case 'letterSpacing':
      return (t) => trackingFamilyRe.test(t)
    case 'color':
      return (t) => colorFamilyMatch(spec.tw, t)
    default:
      return () => false
  }
}
