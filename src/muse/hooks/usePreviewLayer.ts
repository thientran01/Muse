import { useCallback, useEffect, useRef } from 'react'
import type { PreviewMatch } from '../diffPreview'

// Applies a set of PreviewMatches to live DOM nodes on hover and restores them
// on leave. A single option can restyle several elements (the selected one
// and/or its children, plus every looped sibling that shares a className), so
// the snapshot is an ARRAY of nodes, each captured at its original className/
// style.
//
// Every preview() restores the previous set first, so switching between option
// cards — even ones that touch a different number of nodes — never compounds or
// strands a style: each hover starts from a clean baseline. restore() also runs
// on mouse-out, commit, window blur, and unmount, so a preview can never get
// left on the page.
export function usePreviewLayer() {
  const snaps = useRef<Array<{ node: HTMLElement; className: string; cssText: string }>>([])

  const restore = useCallback(() => {
    for (const s of snaps.current) {
      // Only restore if the node is still in the document; if it was replaced by
      // an HMR reload after commit, the new node already carries the real styles.
      if (s.node.isConnected) {
        s.node.className = s.className
        s.node.style.cssText = s.cssText
      }
    }
    snaps.current = []
  }, [])

  const preview = useCallback(
    (matches: PreviewMatch[]) => {
      // Clear any prior preview first so we always apply onto the true baseline —
      // this is what keeps card-to-card switches from compounding.
      restore()
      const next: Array<{ node: HTMLElement; className: string; cssText: string }> = []
      for (const { node, delta } of matches) {
        next.push({ node, className: node.className, cssText: node.style.cssText })
        node.className = delta.newClassName
        Object.assign(node.style, delta.style)
      }
      snaps.current = next
    },
    [restore],
  )

  // Safety net: never leave a preview applied if the panel/page loses focus or
  // the component unmounts mid-hover.
  useEffect(() => {
    window.addEventListener('blur', restore)
    return () => {
      restore()
      window.removeEventListener('blur', restore)
    }
  }, [restore])

  return { preview, restore }
}
