import { useEffect, type RefObject } from 'react'

// Keep Tab cycling inside an open MODAL surface (aria-modal dialogs like the
// revert confirm). A trap is deliberately NOT applied to the non-modal popovers
// (tokens/flags/changes/shortcuts) — those are disclosures, and the APG pattern
// for disclosures is free Tab order; hijacking the page's Tab for them would
// jail keyboard users.
//
// The listener sits on the document at capture so it sees keys through the
// shadow boundary; composedPath()[0] is the REAL focused node (a document-level
// event is retargeted to the shadow host, so e.target alone would lie). When
// focus is outside the container entirely, the next Tab pulls it to the trap's
// first (or last, with Shift) tabbable — that's the "escaped focus comes home"
// half of the contract.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
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
      // contains() works here because the trap container and the focused node
      // live in the SAME shadow tree — it only breaks across nested shadow
      // roots, which this overlay doesn't have.
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
