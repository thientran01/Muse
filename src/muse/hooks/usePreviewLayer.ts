import { useCallback, useEffect, useRef } from 'react'
import type { PreviewDelta } from '../diffPreview'

// Applies a PreviewDelta to a live DOM node on hover and restores it on leave.
//
// The snapshot is always the element's ORIGINAL state, so switching between
// option cards (same node) just overwrites the className/style from scratch —
// no flicker through the original, and no compounding of one option onto
// another. restore() puts the node back; it runs on mouse-out, commit, window
// blur, and unmount, so a preview can never get stranded on the page.
export function usePreviewLayer() {
  const snap = useRef<{ node: HTMLElement; className: string; cssText: string } | null>(null)

  const restore = useCallback(() => {
    const s = snap.current
    if (!s) return
    // Only restore if the node is still in the document; if it was replaced by
    // an HMR reload after commit, the new node already carries the real styles.
    if (s.node.isConnected) {
      s.node.className = s.className
      s.node.style.cssText = s.cssText
    }
    snap.current = null
  }, [])

  const preview = useCallback(
    (node: Element | undefined, delta: PreviewDelta) => {
      if (!(node instanceof HTMLElement)) return
      // Switching to a different node: restore the previous one first.
      if (snap.current && snap.current.node !== node) restore()
      if (!snap.current) {
        snap.current = { node, className: node.className, cssText: node.style.cssText }
      }
      node.className = delta.newClassName
      Object.assign(node.style, delta.style)
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
