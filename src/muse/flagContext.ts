// Instance context for flags — the derivation behind FlagDraft's crumbs/usage/instance
// fields. A flag on an element authored inside a shared component pins the COMPONENT
// file; these helpers recover which INSTANCE the designer meant, structurally, from
// what the click already knows (the canvasChain ancestor locs + the data-muse-loc DOM).

import type { FlagDraft } from './types'

// The slice of a CanvasElement pickUsage needs — structural so tests (and any future
// caller) don't have to build DOM nodes.
export type ChainLoc = { fileName: string; line: number; column: number; tag: string }

// Same-file check across the two locator strategies: the data-muse-loc stamp yields
// repo-RELATIVE paths while the fiber fallback yields ABSOLUTE ones, so a mixed chain
// can spell one file two ways. Normalize separators + case (win32) and treat a
// path-suffix match as the same file rather than a false cross-file hit.
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
function sameFile(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na)
}

// The nearest chain ancestor authored in a DIFFERENT file than the leaf — the usage-site
// container. Honest semantics: this is the closest containing ELEMENT from another file
// (in the common case the consuming page's wrapper), not the `<Component />` call-site
// line, which never reaches the DOM. undefined when the whole chain is one file.
export function pickUsage(chain: ChainLoc[]): FlagDraft['usage'] {
  const leaf = chain[0]
  if (!leaf) return undefined
  const hit = chain.find((c) => !sameFile(c.fileName, leaf.fileName))
  return hit ? { fileName: hit.fileName, line: hit.line, column: hit.column, tag: hit.tag } : undefined
}

// "2 of 3": the element's 1-based position, in document order, among every element
// sharing its data-muse-loc value — the same stamp for every instance of a shared
// component (and every row of a .map()). Only meaningful when the element resolved via
// the attribute (the fiber fallback has nothing to match on) and when there IS more
// than one. Muse's own chrome renders inside a shadow root, invisible to
// document.querySelectorAll, so the overlay can't pollute the count.
export function instanceOf(node: Element): { instanceIndex: number; instanceCount: number } | undefined {
  const loc = node.getAttribute('data-muse-loc')
  if (!loc) return undefined
  const matches: Element[] = []
  document.querySelectorAll('[data-muse-loc]').forEach((el) => {
    if (el.getAttribute('data-muse-loc') === loc) matches.push(el)
  })
  const idx = matches.indexOf(node)
  if (idx < 0 || matches.length < 2) return undefined
  return { instanceIndex: idx + 1, instanceCount: matches.length }
}
