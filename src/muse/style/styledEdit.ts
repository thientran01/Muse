// ============================================================
//  Styled-template editing — set a property inside a styled/emotion template
// ------------------------------------------------------------
//  Phase 4 Part C. A styled-components / emotion host writes its styles in a
//  tagged-template literal: `const Card = styled.div`…`` or an emotion `css`
//  prop (`<div css={css`…`}>`). The DOM element is rendered by that component,
//  so a Canvas edit can't touch the className (it's a generated hash) and
//  shouldn't go inline (that would override, not retune, the component's style)
//  — it sets the declaration in the TEMPLATE BODY, where the component's styles
//  actually live. This module does that edit on a template body it's handed; the
//  engine (server/styleEdit.ts) detects the styled binding and resolves the
//  body's source range. PURE (no I/O, no DOM) so server + client can share it,
//  like cssVarEdit / cssRuleEdit.
//
//  A template body is a brace-less CSS declaration list — `padding: 16px;` with
//  no selector wrapper — but it commonly nests `&:hover { … }` and `@media { … }`
//  blocks. So unlike a flat CSS-Modules rule we must edit only the TOP-LEVEL
//  declaration list: we blank nested blocks (and comments) before matching, then
//  splice the original. The shared setDeclarationInBlock does the set/insert; this
//  module owns the top-level masking. Templates carrying `${…}` interpolations are
//  rejected upstream (the engine only hands us a single-quasi, expression-free
//  body), so a body here is static text.
//
//  LIMITATION (by design, matching cssRuleEdit's "regex/brace scan, not a full CSS
//  parser" stance): a literal `{` inside a value or string — `content: "{"`, an odd
//  `url(…)` — is read as a nested-block opener by blankNestedBlocks, masking the
//  rest of the body. The worst case is benign: a top-level prop after the stray `{`
//  isn't found, so we INSERT a fresh `prop: value;` at the end instead of replacing
//  in place — a duplicate whose (new) value still wins the cascade, body still valid
//  CSS. Full string/url awareness would need a real parser.
// ============================================================
import { blankComments } from './cssVarEdit'
import { setDeclarationInBlock } from './cssRuleEdit'

export type StyledEditResult = { newContent: string; changed: boolean }

// Replace every balanced `{ … }` block (and its braces) with equal-length spaces,
// so a declaration INSIDE a nested rule (`&:hover { color: red }`, `@media { … }`)
// is never mistaken for a top-level one. Depth-tracked so deeply nested blocks are
// fully masked; newlines are preserved purely to keep the masked copy readable —
// every byte offset still maps 1:1 to the input (which is what lets the caller
// splice the ORIGINAL by offsets found in this masked copy). Run blankComments
// first so a stray `{`/`}` inside a comment can't unbalance the depth counter.
export function blankNestedBlocks(s: string): string {
  const out = s.split('')
  let depth = 0
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (c === '{') {
      depth++
      out[i] = ' '
    } else if (c === '}') {
      if (depth > 0) depth--
      out[i] = ' '
    } else if (depth > 0 && c !== '\n') {
      out[i] = ' '
    }
  }
  return out.join('')
}

// Set (or insert) `cssProp: value` in the TOP-LEVEL declaration list of a styled /
// emotion template body. Returns the body unchanged with changed:false when the
// value is unsafe (could break out of the declaration) or already matches; nested
// `&{…}`/media overrides are left as-is (we edit the base value), mirroring how
// editCssVar / setRuleProperty edit the base and leave theme overrides alone.
export function setTemplateProperty(body: string, cssProp: string, value: string): StyledEditResult {
  const v = value.trim()
  // Same guard as the rule/var editors: a value carrying `;` `{` `}` `< >` or a
  // newline could escape the declaration — refuse it (scrub controls never emit
  // these; defense-in-depth against a malformed value reaching the splice).
  if (/[;{}<>]|[\r\n]/.test(v)) return { newContent: body, changed: false }
  // Match against a copy with comments AND nested blocks masked, but splice the
  // real body at the same offsets — so we only ever touch a top-level declaration.
  const scan = blankNestedBlocks(blankComments(body))
  const r = setDeclarationInBlock(body, scan, cssProp, v)
  return { newContent: r.inner, changed: r.changed }
}
