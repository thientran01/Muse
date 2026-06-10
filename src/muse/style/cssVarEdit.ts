// ============================================================
//  CSS custom-property editing — value ↔ var, and the var's definition
// ------------------------------------------------------------
//  Phase 4: when an element paints a property through a CSS variable
//  (`color: var(--c-energy)` inline, or `text-[color:var(--c-energy)]` as a
//  class), scrubbing that property should NOT hardcode a literal over the theme
//  binding — it should edit the VARIABLE'S DEFINITION so the change propagates
//  everywhere the token is used. That's the difference between "override this one
//  element" and "retune the theme," and theming apps want the latter.
//
//  This module is PURE (no I/O, no DOM) so both the Vite-plugin server and the
//  client can import it, mirroring tailwindScales. It does two things:
//    • extractVarName — pull `--x` out of a value that references it, so the
//      engine can recognize a var-bound value and defer it to a var edit.
//    • editCssVar     — given a stylesheet's source, rewrite the value of a
//      `--x: …;` declaration by character-range splice (same "smallest possible
//      change" contract as the JSX engine), reporting how many selectors define
//      it so the caller can warn about theme-specific overrides it left alone.
//  The server owns DISCOVERY (which .css file defines the var); this module only
//  edits a stylesheet it's handed.
// ============================================================

// Pull the custom-property name (`--x`) out of a value that paints through it.
// Handles the bare `var(--x)`, a fallback `var(--x, #fff)`, and a Tailwind
// arbitrary wrapper's inner content `color:var(--x)` / `length:var(--x)`. Returns
// null when the value isn't a single var reference (a literal, or a compound like
// `calc(var(--a) + var(--b))` we won't try to attribute to one var).
export function extractVarName(value: string): string | null {
  const v = value
    .trim()
    .replace(/\s*!important\s*$/i, '') // a themed value can still carry !important
    .replace(/^(?:color|length):/, '')
    .trim()
  // One var() reference, optional fallback, nothing else around it.
  const m = v.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/)
  return m ? m[1] : null
}

// True when a value is a single CSS-variable reference (the engine's test for
// "this property is theme-bound, defer it to a var edit").
export const isVarValue = (value: string): boolean => extractVarName(value) !== null

export type CssVarEditResult = {
  newContent: string
  changed: boolean
  // How many declarations of this var were found in the stylesheet. >1 means the
  // var is themed per selector (e.g. :root and .dark) and we edited only the first
  // (base) one — the caller surfaces this so the user knows overrides remain.
  matches: number
}

// A `--x:` declaration: its full span (for the splice) and the value-only span.
type VarDecl = { declStart: number; valueStart: number; valueEnd: number }

// Replace every /* … */ comment with equal-length spaces. Run before matching so
// a commented-out declaration (`/* --x: old */`) can't be picked up and spliced,
// while every byte offset stays aligned with the original source (we splice the
// original by these offsets).
export function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
}

// Find every `--x: <value>` declaration in CSS source. Deliberately simple — a
// regex over the (comment-blanked) text, not a full CSS parser — because a
// custom-property declaration is a flat `--name: tokens` ending at `;` or `}`. We
// capture the value span so we can replace ONLY the value, preserving the property
// name, whitespace, and trailing semicolon exactly. Matching runs over a copy with
// comments blanked to spaces; offsets are identical to the original.
function findVarDecls(css: string, varName: string): VarDecl[] {
  const scan = blankComments(css)
  const decls: VarDecl[] = []
  // `--name` followed by `:`, then the value up to the terminating `;` or `}`.
  // [^;}]* keeps us inside a single declaration; we never cross a rule boundary.
  const re = new RegExp(`${escapeRe(varName)}\\s*:\\s*([^;}]*)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(scan)) !== null) {
    const declStart = m.index
    // The value starts after the matched `--name` + colon + leading spaces.
    const valueStart = m.index + m[0].length - m[1].length
    // Trim trailing whitespace out of the value span so we replace only the
    // value glyphs, leaving the gap before `;`/`}` untouched.
    const trailingWs = m[1].length - m[1].trimEnd().length
    const valueEnd = m.index + m[0].length - trailingWs
    decls.push({ declStart, valueStart, valueEnd })
  }
  return decls
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Every custom-property DEFINITION in a stylesheet (`--name: value`), first-wins on
// duplicates (source order — the base `:root`/`@theme` value, before any `.dark`/media
// override). Comments are blanked first so a commented-out decl isn't listed; offsets
// stay aligned so values read from the original source. Powers the token panel: surface
// the project's design tokens so a user can edit one without hunting for an element.
export type CssVarDecl = { name: string; value: string }
export function listCssVars(css: string): CssVarDecl[] {
  const scan = blankComments(css)
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]*)/g
  const seen = new Set<string>()
  const out: CssVarDecl[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(scan)) !== null) {
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    const valStart = m.index + m[0].length - m[2].length
    const value = css.slice(valStart, m.index + m[0].length).trim()
    if (value) out.push({ name, value })
  }
  return out
}

// Whether a token VALUE is a color (drives the token panel's swatch + picker vs a
// plain value field). Conservative: only obvious color forms — a raw `r g b`
// channel triple (Tailwind-v4 `rgb(var(--x))` style) is ambiguous vs a spacing
// triple, so it's left as text. Shared by the server's /tokens scan and the
// client's CSSOM fallback so the two surfaces classify identically.
const TOKEN_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|color\(|hwb\()/
export function looksLikeColor(value: string): boolean {
  return TOKEN_COLOR_RE.test(value.trim().replace(/\s*!important\s*$/i, ''))
}

// Rewrite the value of `--varName` in a stylesheet. Edits the FIRST definition
// (source order — typically the `:root` base value) and reports the total count
// so the caller can warn when theme-specific overrides (.dark, media queries)
// were left as-is. Returns the source unchanged with changed:false when the var
// isn't defined here (the wrong stylesheet) or the value already matches.
export function editCssVar(css: string, varName: string, value: string): CssVarEditResult {
  const newValue = value.trim()
  // A value carrying `;` `{` `}` (angle brackets) or a newline would break out of
  // the declaration or write a multi-line token into the rule — refuse it. Scrub
  // controls never emit these; defense-in-depth against a malformed value reaching
  // the splice.
  if (/[;{}<>]|[\r\n]/.test(newValue)) return { newContent: css, changed: false, matches: 0 }
  const decls = findVarDecls(css, varName)
  if (decls.length === 0) return { newContent: css, changed: false, matches: 0 }
  const first = decls[0]
  const current = css.slice(first.valueStart, first.valueEnd)
  if (current === newValue) return { newContent: css, changed: false, matches: decls.length }
  const out = css.slice(0, first.valueStart) + newValue + css.slice(first.valueEnd)
  return { newContent: out, changed: true, matches: decls.length }
}
