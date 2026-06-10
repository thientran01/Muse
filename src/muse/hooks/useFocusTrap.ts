import { useEffect, type RefObject } from 'react'

// Keep Tab cycling inside an open overlay surface (a popover, a modal). Without
// this, Tab walks straight out of the Shadow DOM into the host page while a
// Muse panel is open — the host's links start lighting up behind the overlay.
//
// The listener sits on the document at capture so it sees keys through the
// shadow boundary; composedPath()[0] is the REAL focused node (a document-level
// event is retargeted to the shadow host, so e.target alone would lie). When
// focus is outside the container entirely, the next Tab pulls it to the trap's
// first (or last, with Shift) tabbable — that's the "escaped focus comes home"
// half of the contract.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const node = ref.current
      if (!node) return
      // offsetParent filters display:none / detached candidates (a hidden state
      // chip, a collapsed section's controls) without forcing layout per element.
      const els = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      )
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      const current = e.composedPath()[0] as HTMLElement | undefined
      const inside = !!current && node.contains(current)
      if (e.shiftKey) {
        if (!inside || current === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (!inside || current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [ref, active])
}
