// Shared CSSOM helpers for the features that walk the host page's stylesheets
// (the animation freeze, the forced-:hover pin). Pure traversal — what to DO
// with a rule stays in the caller.

// Recursively visit every CSSStyleRule under `rules`, surfacing @import'd
// sheets to the caller (they never appear in document.styleSheets — only
// through their CSSImportRule). Grouping rules (media/supports/layer/container/
// scope) and CSS-nesting children of style rules all expose cssRules, so one
// generic recursion covers them.
export function walkCssRules(
  rules: CSSRuleList,
  visit: (rule: CSSStyleRule) => void,
  onImport?: (sheet: CSSStyleSheet) => void,
): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (rule instanceof CSSStyleRule) visit(rule)
    if (rule instanceof CSSImportRule && rule.styleSheet) onImport?.(rule.styleSheet)
    const children = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined
    if (children && children.length) walkCssRules(children, visit, onImport)
  }
}

// Every same-origin sheet attached to the document (link/style + adopted).
// @import'd sheets are NOT here — discover them via walkCssRules's onImport.
export function allDocumentSheets(): CSSStyleSheet[] {
  return [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])].filter(
    (s): s is CSSStyleSheet => s instanceof CSSStyleSheet,
  )
}
