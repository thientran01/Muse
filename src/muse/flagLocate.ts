// Best-effort: find the live DOM node a flag points at, and reveal it. Flags store a
// repo-relative file + line + column captured at flag-time; after edits those line numbers
// drift, so a flag may no longer resolve to a node — the panel stays the reliable surface,
// and pins simply don't render for an orphaned flag.
import { getSourceLocation } from './sourceLocation'
import type { Flag } from './types'

export function findFlagNode(flag: Flag): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>('[data-muse-loc]')
  for (const n of nodes) {
    const loc = getSourceLocation(n)
    if (!loc || !loc.fileName) continue
    // data-muse-loc carries an ABSOLUTE path; the flag's `file` is repo-relative — match by
    // suffix (+ exact line/column). Normalize Windows backslashes first.
    if (
      loc.lineNumber === flag.line &&
      loc.columnNumber === flag.column &&
      loc.fileName.replace(/\\/g, '/').endsWith(flag.file)
    ) {
      return n
    }
  }
  return null
}

// Briefly outline a node in the accent color (inline, never written to source).
export function highlightNode(node: HTMLElement): void {
  const prev = { outline: node.style.outline, offset: node.style.outlineOffset, transition: node.style.transition }
  node.style.transition = 'outline-color 1s ease'
  node.style.outline = '2px solid rgb(var(--muse-accent))'
  node.style.outlineOffset = '2px'
  window.setTimeout(() => {
    node.style.outline = prev.outline
    node.style.outlineOffset = prev.offset
    node.style.transition = prev.transition
  }, 1300)
}

// Scroll the flagged element into view + flash it. Returns false if it can't be found
// (drifted past its captured location) so the caller can show a calm "couldn't find it".
export function revealFlag(flag: Flag): boolean {
  const node = findFlagNode(flag)
  if (!node) return false
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightNode(node)
  return true
}
