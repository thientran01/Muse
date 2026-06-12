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

// ============================================================
//  VARIANT PREFIXES — hover:p-4 / md:p-6 / dark:hover:text-white
// ------------------------------------------------------------
//  A Tailwind token is (variant chain) + (base utility), colon-joined. The chain
//  splits ONLY at bracket depth 0, so `text-[length:17px]` has no variants and
//  `lg:text-[color:var(--x)]` splits as lg + text-[color:var(--x)]. This is the
//  single shared token parser: the family matchers (via the StyleWriter seam),
//  the panel's class chips, and the client's variant resolvers all read tokens
//  through it.
// ============================================================
export function splitVariants(token: string): { variants: string; base: string } {
  let depth = 0
  let lastColon = -1
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch === '[') depth++
    else if (ch === ']') depth = depth > 0 ? depth - 1 : 0
    else if (ch === ':' && depth === 0) lastColon = i
  }
  return lastColon === -1
    ? { variants: '', base: token }
    : { variants: token.slice(0, lastColon), base: token.slice(lastColon + 1) }
}

// A variant chain Muse will WRITE ('hover', 'md', 'dark:hover'): simple ident
// segments only. Arbitrary/bracket variants ([&>li]:) are recognized by
// splitVariants but never authored — and a chain arriving over the wire is
// embedded into a className verbatim, so it MUST pass this first (the server
// re-validates; never trust the client).
const VARIANT_SEGMENT = /^[a-z0-9_-]+$/i
export function isVariantChain(chain: string): boolean {
  return chain.length > 0 && chain.split(':').every((s) => VARIANT_SEGMENT.test(s))
}

// A class token the FREEFORM field may write verbatim into a className — the
// classPatch security boundary (user text → source file; the server
// re-validates, never trusting the client). A BLOCKLIST of the structural
// characters that could escape a `"…"` or `` {`…`} `` className emit or read
// as JSX — whitespace, double quote, backtick, $ (template interpolation),
// braces, angle brackets, semicolon, backslash — so real Tailwind passes
// untouched: variants (hover:), arbitrary values (w-[calc(100%-2rem)],
// content-['»'] — unicode included), fractions (w-1/2), modifiers
// (bg-white/60, !mt-0). Balanced brackets required so one token can't open a
// bracket the next token closes.
const UNSAFE_CLASS_CHAR = /[\s"`$\\{}<>;]/
export function isSafeClassToken(token: string): boolean {
  if (token.length === 0 || token.length > 128) return false
  if (UNSAFE_CLASS_CHAR.test(token)) return false
  let depth = 0
  for (const ch of token) {
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

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
  return m ? isWeightArbitrary(m[1]) : false // excludes font-sans/serif/mono and arbitrary font-var brackets
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
// Variant-blind on purpose: dark:text-[color:var(--x)] is just as theme-bound as
// the bare form, so the panel marks the channel read-only either way.
export function isVarColorToken(prefix: string, tok: string): boolean {
  const { base } = splitVariants(tok)
  return colorFamilyMatch(prefix, base) && /var\(/.test(base)
}

export { isLengthArbitrary, isColorArbitrary }

// ============================================================
//  APPEARANCE — radius / border width / border style / opacity
// ------------------------------------------------------------
//  The border- prefix is triple-overloaded (width vs style vs color), so each
//  kind gets a content-aware matcher, same discipline as text-/font- above.
//  Radius's "all corners" matcher deliberately covers the side/corner variants
//  too: scrubbing the whole radius should REPLACE a lingering rounded-tl-none,
//  not duel with it (the engine replaces the first match and drops the rest).
// ============================================================

// Inverse of the forward ROUNDED map, derived so they can't drift. '' is the
// bare-`rounded` 0.25rem step; the suffix joins with '-' only when non-empty.
// Every ROUNDED value parses (px/rem literals), so the filter is a type guard,
// not a reachable fallback.
const ROUNDED_INVERSE = new Map<number, string>(
  Object.entries(ROUNDED)
    .map(([suffix, val]) => [lengthToPx(val), suffix] as const)
    .filter((e): e is [number, string] => e[0] !== null),
)
const roundedClass = (prefix: string, suffix: string) => (suffix === '' ? prefix : `${prefix}-${suffix}`)

export function radiusToken(prefix: string, value: string): string | null {
  const px = lengthToPx(value)
  if (px === null || px < 0) return null
  if (px >= 9999) return `${prefix}-full`
  const suffix = ROUNDED_INVERSE.get(px)
  if (suffix !== undefined) return roundedClass(prefix, suffix)
  return `${prefix}-[${px}px]`
}

const ROUNDED_SUFFIXES = Object.keys(ROUNDED).filter(Boolean)
// One radius family: the prefix bare, with a named step, or an arbitrary length.
const radiusReFor = (prefix: string) =>
  new RegExp(`^${esc(prefix)}(?:-(?:${ROUNDED_SUFFIXES.map(esc).join('|')}))?$|^${esc(prefix)}-\\[[^\\]]+\\]$`)
// The all-corners matcher folds in every side/corner variant so a whole-radius
// scrub replaces partial tokens instead of fighting their higher cascade slot.
const RADIUS_VARIANTS = ['t', 'r', 'b', 'l', 'tl', 'tr', 'br', 'bl', 'ss', 'se', 'ee', 'es']
export function radiusFamilyMatch(prefix: string, tok: string): boolean {
  if (radiusReFor(prefix).test(tok)) return true
  if (prefix !== 'rounded') return false
  return RADIUS_VARIANTS.some((v) => radiusReFor(`rounded-${v}`).test(tok))
}

// Tailwind border widths: bare `border` = 1px; named 0/2/4/8; else arbitrary.
const BORDER_WIDTH_NAMED = new Map<number, string>([[0, 'border-0'], [1, 'border'], [2, 'border-2'], [4, 'border-4'], [8, 'border-8']])
export function borderWidthToken(value: string): string | null {
  const px = lengthToPx(value)
  if (px === null || px < 0) return null
  return BORDER_WIDTH_NAMED.get(px) ?? `border-[${px}px]`
}
// Width tokens only — never border-color (named palette / #hex / var brackets, the
// colorFamilyMatch territory) and never border-style. SIDE width tokens (border-t-2,
// border-x, …) ARE absorbed, same rationale as the radius family: the panel's single
// width scrub means "the border's width", and leaving a side longhand in place would
// silently win the cascade over the new shorthand — an edit that doesn't stick is
// worse than one that flattens a per-side setup. The strict suffix group keeps
// border-teal-500 (a color) out of the `t` alternation.
const BORDER_SIDE = '(?:t|r|b|l|x|y|s|e)'
export const isBorderWidthToken = (tok: string): boolean => {
  if (new RegExp(`^border(?:-${BORDER_SIDE})?(?:-(?:0|2|4|8))?$`).test(tok)) return true
  const m = tok.match(new RegExp(`^border(?:-${BORDER_SIDE})?-\\[(.+)\\]$`))
  return m ? isLengthArbitrary(m[1]) : false
}

const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']
export function borderStyleToken(value: string): string | null {
  const v = value.trim()
  return BORDER_STYLES.includes(v) ? `border-${v}` : null
}
export const isBorderStyleToken = (tok: string): boolean =>
  new RegExp(`^border-(?:${BORDER_STYLES.join('|')})$`).test(tok)

// Tailwind v3's named opacity steps; anything off-scale becomes an arbitrary
// fraction. Accepts a 0..1 fraction or a percentage.
const OPACITY_STEPS = new Set([0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100])
export function opacityToken(value: string): string | null {
  const v = value.trim()
  let frac: number
  if (/^-?\d*\.?\d+%$/.test(v)) frac = parseFloat(v) / 100
  else if (/^-?\d*\.?\d+$/.test(v)) frac = parseFloat(v)
  else return null
  if (!Number.isFinite(frac) || frac < 0 || frac > 1) return null
  const pct = Math.round(frac * 100)
  if (Math.abs(frac * 100 - pct) < 0.001 && OPACITY_STEPS.has(pct)) return `opacity-${pct}`
  return `opacity-[${frac}]`
}
// 0–100 only — opacity-200 (a custom scale or a typo) is not ours to strip.
export const isOpacityToken = (tok: string): boolean => /^opacity-(?:100|[1-9]?\d|\[[^\]]+\])$/.test(tok)

// --- box shadow (preset model) --------------------------------------------------
// The panel offers Tailwind's shadow steps as PRESETS, so the value crossing the
// wire is the step's real box-shadow CSS (usable verbatim by the inline and
// CSS-file writers). FORWARD: name → value (the v3 defaults). INVERSE: a value
// round-trips to its named utility via a numeric signature — every px-ish length
// in order — which survives the different serializations (authored rems vs the
// computed "rgba(…) 0px 1px 2px 0px" form) without string-normalizing colors.
export const SHADOW: Record<string, string> = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  '': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  none: 'none',
}

// The ordered offsets/blurs/spreads of a shadow value, layer by layer: bare
// numbers and px lengths count; color-function innards (rgb(0 0 0 / 0.05)) are
// blanked first so their channels can't pollute the signature. ALL-ZERO layers
// are dropped — Tailwind's shadow utilities compose with two transparent ring
// placeholder layers ("0 0 #0000", computed as "rgba(0,0,0,0) 0px 0px 0px 0px"),
// and a computed value must still match its authored preset through them.
export function shadowSignature(value: string): string {
  const noColors = value.replace(/(rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\([^)]*\)|#[0-9a-fA-F]{3,8}/g, ' ')
  return noColors
    .split(',')
    .map((layer) => (layer.match(/-?\d*\.?\d+(?:px)?/g) ?? []).map((n) => String(parseFloat(n))))
    .filter((nums) => nums.length > 0 && nums.some((n) => n !== '0'))
    .map((nums) => nums.join(','))
    .join('|')
}

const SHADOW_BY_SIGNATURE = new Map(
  Object.entries(SHADOW).filter(([, v]) => v !== 'none').map(([name, v]) => [shadowSignature(v), name]),
)

export function shadowToken(value: string): string | null {
  const v = value.trim()
  if (v === 'none' || v === '0 0 #0000') return 'shadow-none'
  const name = SHADOW_BY_SIGNATURE.get(shadowSignature(v))
  if (name !== undefined) return name === '' ? 'shadow' : `shadow-${name}`
  // Off-scale: a SINGLE-layer shadow with a safe charset becomes an arbitrary
  // token (spaces underscored per Tailwind's syntax — commas inside the color
  // function are fine). Multi-layer or odd content falls back to inline style.
  const noColors = v.replace(/(rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\([^)]*\)|#[0-9a-fA-F]{3,8}/g, ' ')
  if (noColors.includes(',')) return null
  if (!/^[\w.%#,()+\-/ ]+$/.test(v)) return null
  return `shadow-[${v.replace(/\s+/g, '_')}]`
}

// First visible layer of a computed/authored box-shadow → its scrub-editable
// parts. Returns null for 'none', placeholder-only values, or inset shadows
// (a different thing — the custom editor composes outer shadows only). CSS
// length order is offset-x offset-y blur spread; the computed serialization may
// put the color first, which the color-blanking sidesteps.
export function parseShadowLayer(value: string): { x: number; y: number; blur: number; spread: number; alpha: number } | null {
  if (!value || value === 'none') return null
  const layers = value.split(/,(?![^(]*\))/)
  for (const layer of layers) {
    if (/\binset\b/.test(layer)) continue
    // Alpha from the layer's color: the comma form only on the 4-arg fns
    // (rgba/hsla — a bare `rgb(r, g, b)` would otherwise donate its last
    // CHANNEL as the alpha), or the slash form on any fn; default 1.
    const alphaMatch = layer.match(/(?:rgba|hsla)\([^)]*,\s*([\d.]+)\s*\)/) ?? layer.match(/\/\s*([\d.]+)\s*\)/)
    const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1
    const noColors = layer.replace(/(rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\([^)]*\)|#[0-9a-fA-F]{3,8}/g, ' ')
    const nums = (noColors.match(/-?\d*\.?\d+(?:px)?/g) ?? []).map(parseFloat)
    if (nums.length < 2 || nums.every((n) => n === 0)) continue // zero/placeholder layer
    return { x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, alpha }
  }
  return null
}

// shadow- is overloaded with COLORED shadows (shadow-red-500 sets --tw-shadow-color);
// the size family is the named steps + bare `shadow` + an arbitrary whose content
// starts like a length list. A full-value arbitrary that EMBEDS a color
// (shadow-[0_2px_9px_#f00]) is deliberately still size-family: this matcher only
// fires for boxShadow mutations, and clicking a preset chip means "replace my
// shadow with this preset" — color included.
const SHADOW_NAMES = Object.keys(SHADOW).filter(Boolean).concat('inner')
export function isShadowSizeToken(tok: string): boolean {
  if (new RegExp(`^shadow(?:-(?:${SHADOW_NAMES.join('|')}))?$`).test(tok)) return true
  const m = tok.match(/^shadow-\[(.+)\]$/)
  return m ? /^(?:inset[_ ])?-?\d/.test(m[1]) : false
}

// --- alignment (text-align / justify-content / align-items) ----------------------
// text- is the third overload of the text prefix (size, color, ALIGN) — the align
// family is a closed keyword set, so the matcher is a strict whitelist that can
// never claim a size or color token (and vice versa: the size/color matchers'
// named sets + content checks never include these keywords).
const TEXT_ALIGNS = ['left', 'center', 'right', 'justify', 'start', 'end']
export function textAlignToken(value: string): string | null {
  const v = value.trim()
  return TEXT_ALIGNS.includes(v) ? `text-${v}` : null
}
export const isTextAlignToken = (tok: string): boolean =>
  new RegExp(`^text-(?:${TEXT_ALIGNS.join('|')})$`).test(tok)

// CSS justify-content values ↔ Tailwind's shortened suffixes.
const JUSTIFY_MAP: Record<string, string> = {
  'flex-start': 'start', start: 'start',
  'flex-end': 'end', end: 'end',
  center: 'center',
  'space-between': 'between',
  'space-around': 'around',
  'space-evenly': 'evenly',
  normal: 'normal', stretch: 'stretch',
}
export function justifyToken(value: string): string | null {
  const suffix = JUSTIFY_MAP[value.trim()]
  return suffix ? `justify-${suffix}` : null
}
export const isJustifyToken = (tok: string): boolean =>
  /^justify-(?:start|end|center|between|around|evenly|normal|stretch)$/.test(tok)

const ALIGN_ITEMS_MAP: Record<string, string> = {
  'flex-start': 'start', start: 'start',
  'flex-end': 'end', end: 'end',
  center: 'center',
  baseline: 'baseline',
  stretch: 'stretch',
}
export function alignItemsToken(value: string): string | null {
  const suffix = ALIGN_ITEMS_MAP[value.trim()]
  return suffix ? `items-${suffix}` : null
}
export const isAlignItemsToken = (tok: string): boolean =>
  /^items-(?:start|end|center|baseline|stretch)$/.test(tok)

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
    case 'radius':
      return radiusToken(spec.tw, value)
    case 'borderWidth':
      return borderWidthToken(value)
    case 'borderStyle':
      return borderStyleToken(value)
    case 'opacity':
      return opacityToken(value)
    case 'shadow':
      return shadowToken(value)
    case 'textAlign':
      return textAlignToken(value)
    case 'justify':
      return justifyToken(value)
    case 'alignItems':
      return alignItemsToken(value)
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
    case 'radius':
      return (t) => radiusFamilyMatch(spec.tw, t)
    case 'borderWidth':
      return isBorderWidthToken
    case 'borderStyle':
      return isBorderStyleToken
    case 'opacity':
      return isOpacityToken
    case 'shadow':
      return isShadowSizeToken
    case 'textAlign':
      return isTextAlignToken
    case 'justify':
      return isJustifyToken
    case 'alignItems':
      return isAlignItemsToken
    default:
      return () => false
  }
}
