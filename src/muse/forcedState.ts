// DevTools-style forced :hover for the selected element — the ":hov" pin.
//
// CSS can't force :hover, so the pin CLONES every accessible rule whose
// selector mentions :hover, rewriting the pseudo to an attribute selector
// ([data-muse-pin-hover] — same specificity tier as a pseudo-class), and
// injects the clones as one <style> appended last in <head>. Setting the
// attribute on the selected node makes its hover styles render for real:
// getComputedStyle picks them up, so the properties panel can read AND scrub
// hover-governed values without the cursor parked on the element.
//
// Grouping context is preserved (@media/@supports/@container wrap the clone;
// a CSS-nesting parent wraps its children) with one deliberate exception:
// @layer wrappers are DROPPED — an unlayered clone beats layered originals,
// which is exactly the "pin wins" behavior the feature needs.
//
// Freeze interplay: "Freeze page" neuters :hover selectors IN PLACE, so a pin
// started while frozen reads each rule's pre-freeze selector via
// getFrozenOriginal. The clones themselves contain no :hover, so freezing
// while pinned leaves the pin painted — freeze kills global hover noise, the
// pin keeps the one element's hover state visible.
import { getFrozenOriginal } from './animationFreeze'
import { allDocumentSheets } from './cssom'

export const PIN_HOVER_ATTR = 'data-muse-pin-hover'

// Same lookbehind discipline as FROZEN_PSEUDOS: an escaped ident like
// Tailwind's `.hover\:bg-x` keeps its name; only a real :hover pseudo matches.
const HOVER_PSEUDO = /(?<!\\):hover(?![\w-])/g

// Rewrite a selector's :hover pseudos to the pin attribute, or null when the
// selector has none (nothing to clone). Pure — unit-tested directly.
export function pinSelectorText(selector: string): string | null {
  const out = selector.replace(HOVER_PSEUDO, `[${PIN_HOVER_ATTR}]`)
  return out === selector ? null : out
}

// The wrapper a grouping rule contributes to its descendants' clones, or null
// for "recurse bare". @layer is null ON PURPOSE (see header).
function groupWrapper(rule: CSSRule): string | null {
  if (rule instanceof CSSMediaRule) return `@media ${rule.conditionText}`
  if (rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`
  if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
    return `@container ${rule.conditionText}`
  }
  return null
}

// Walk one rule list, collecting pinned clones of every :hover rule. `ctx` is
// the wrapper chain (innermost last); a CSS-nesting parent joins it as its own
// selector so a nested `&:hover` clone stays correct inside the parent block.
function collectHoverClones(rules: CSSRuleList, ctx: string[], out: string[], imports: Set<CSSStyleSheet>): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (rule instanceof CSSImportRule && rule.styleSheet) imports.add(rule.styleSheet)
    if (rule instanceof CSSStyleRule) {
      const original = getFrozenOriginal(rule) ?? rule.selectorText
      const pinned = pinSelectorText(original)
      if (pinned !== null && rule.style.length > 0) {
        let css = `${pinned}{${rule.style.cssText}}`
        for (let j = ctx.length - 1; j >= 0; j--) css = `${ctx[j]}{${css}}`
        out.push(css)
      }
      // CSS-nesting children live under the parent's selector block.
      if (rule.cssRules && rule.cssRules.length) {
        collectHoverClones(rule.cssRules, [...ctx, original], out, imports)
      }
      continue
    }
    const children = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined
    if (children && children.length) {
      const wrap = groupWrapper(rule)
      collectHoverClones(children, wrap ? [...ctx, wrap] : ctx, out, imports)
    }
  }
}

// Pin :hover on `node`. Snapshots the page's current :hover rules — the caller
// re-pins after anything that rewrites stylesheets (an HMR repaint, undo/redo).
// Returns the unpin disposer (idempotent).
export function pinHover(node: Element): () => void {
  const out: string[] = []
  const imports = new Set<CSSStyleSheet>()
  const seen = new Set<CSSStyleSheet>()
  const walkSheet = (sheet: CSSStyleSheet) => {
    if (seen.has(sheet)) return
    seen.add(sheet)
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      return // cross-origin — skip silently, same posture as the freeze
    }
    collectHoverClones(rules, [], out, imports)
  }
  for (const sheet of allDocumentSheets()) walkSheet(sheet)
  // Walks discover @import'd sheets; drain until stable (bounded — seen only grows).
  let known = -1
  while (known !== seen.size) {
    known = seen.size
    for (const s of [...imports]) walkSheet(s)
  }

  const style = document.createElement('style')
  style.id = 'muse-force-hover'
  style.textContent = out.join('\n')
  document.head.appendChild(style)
  node.setAttribute(PIN_HOVER_ATTR, '')

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    node.removeAttribute(PIN_HOVER_ATTR)
    style.remove()
  }
}
