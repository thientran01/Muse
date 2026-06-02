// ============================================================
//  CSS rule editing — set a property inside a class rule (CSS Modules)
// ------------------------------------------------------------
//  Phase 4 Part B. A CSS-modules host writes `className={styles.card}` in JSX and
//  keeps the actual values in a `.module.css` rule (`.card { padding: 16px }`). So
//  a Canvas edit can't touch the className (it's just a binding) — it resolves
//  `styles.card` → the `.card` rule in the module and sets the declaration THERE.
//  This module does the rule edit on a stylesheet it's handed; the server resolves
//  WHICH module file (from the import), and the engine detects the `styles.x`
//  binding. PURE (no I/O, no DOM) so server + client can share it, like cssVarEdit.
//
//  Deliberately a regex/brace scan, not a full CSS parser: a CSS-modules rule is a
//  flat `.name { decl; decl; }` list. We edit the FIRST rule whose selector is
//  exactly `.name` (CSS Modules localizes the binding to a single-class selector)
//  and report the match count so the caller can warn about media/`:global`
//  overrides it left alone. Nested (SCSS) bodies and unsafe values fail closed.
// ============================================================
import { blankComments, escapeRe } from './cssVarEdit'

export type CssRuleEditResult = {
  newContent: string
  changed: boolean
  // How many `.className` rules exist in the sheet. >1 means the class is also
  // defined under a media query / :global / theme block; we edited the first
  // (base) one and the caller surfaces that the overrides were left as-is.
  matches: number
}

// The engine's PropertySpec.css keys are camelCase DOM-style names (paddingLeft,
// backgroundColor); CSS declarations are kebab-case. color → color, paddingLeft →
// padding-left, backgroundColor → background-color.
function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

// The inner-content span [start, end) (between the braces) of the FIRST flat rule
// whose selector is exactly `.className`, plus how many such rules exist. Matching
// runs over a comment-blanked copy so a commented-out rule can't be picked; offsets
// map 1:1 to the original. A nested body (contains `{` before its `}`) is skipped —
// we only edit a flat declaration list.
function findRuleBody(css: string, className: string): { start: number; end: number; count: number } | null {
  const scan = blankComments(css)
  // Selector boundary (start | `}` | `,` | whitespace) then `.name` (not a prefix
  // of a longer class — negative lookahead on class-name chars) then `{`.
  const re = new RegExp(`(?:^|[}\\s,])\\.${escapeRe(className)}(?![\\w-])\\s*\\{`, 'g')
  let m: RegExpExecArray | null
  let first: { start: number; end: number } | null = null
  let count = 0
  while ((m = re.exec(scan)) !== null) {
    const bodyStart = m.index + m[0].length // just past the `{`
    const bodyEnd = scan.indexOf('}', bodyStart)
    if (bodyEnd === -1) continue // unterminated
    if (scan.slice(bodyStart, bodyEnd).includes('{')) continue // nested (SCSS) — skip
    count++
    if (!first) first = { start: bodyStart, end: bodyEnd }
  }
  return first ? { ...first, count } : null
}

// Set (or insert) `cssProp: value` inside the `.className` rule. Edits the first
// matching rule in place; inserts a new declaration when the property is absent.
// Returns unchanged with changed:false when the rule isn't here (wrong sheet), the
// value already matches, or the value is unsafe (could break out of the rule).
export function setRuleProperty(css: string, className: string, cssProp: string, value: string): CssRuleEditResult {
  const v = value.trim()
  // A value carrying `;` `{` `}` (or angle brackets) could escape the declaration
  // and corrupt the rule — refuse it (scrub controls never emit these).
  if (/[;{}<>]/.test(v)) return { newContent: css, changed: false, matches: 0 }
  const body = findRuleBody(css, className)
  if (!body) return { newContent: css, changed: false, matches: 0 }
  const prop = kebab(cssProp)
  const inner = css.slice(body.start, body.end)

  // Existing declaration of this exact property (not a prefix like padding vs
  // padding-left)? Replace its value in place, preserving name/colon/spacing.
  const declRe = new RegExp(`(^|[;{]\\s*|\\s)(${escapeRe(prop)})(?![\\w-])(\\s*:\\s*)([^;]*?)(\\s*)(?=;|$)`, 'm')
  const dm = declRe.exec(inner)
  if (dm) {
    const valStart = body.start + dm.index + dm[1].length + dm[2].length + dm[3].length
    const valEnd = valStart + dm[4].length
    if (css.slice(valStart, valEnd) === v) return { newContent: css, changed: false, matches: body.count }
    return { newContent: css.slice(0, valStart) + v + css.slice(valEnd), changed: true, matches: body.count }
  }

  // No existing declaration — insert one as the last in the rule. Match the
  // indentation of an existing declaration if any, else two spaces.
  const indent = inner.match(/\n([ \t]+)\S/)?.[1] ?? '  '
  const trimmed = inner.replace(/\s+$/, '') // body up to the last non-ws char
  const needsSemi = trimmed !== '' && !trimmed.endsWith(';') && !trimmed.endsWith('{')
  const newInner = `${trimmed}${needsSemi ? ';' : ''}\n${indent}${prop}: ${v};\n`
  return { newContent: css.slice(0, body.start) + newInner + css.slice(body.end), changed: true, matches: body.count }
}
