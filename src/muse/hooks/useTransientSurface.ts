import { useEffect, useId, useRef } from 'react'
import { museStore } from '../store'

// Mutual exclusion for TRANSIENT surfaces — toolbar popovers, the panel's color
// pickers: opening one closes whoever held the slot, so popovers can't stack
// into clutter (toolbar popovers were already exclusive among themselves; the
// pickers' local open state was the leak). Mechanism: an opener claims
// `activeSurface` in the store; every open surface watches the slot and closes
// itself when a different id claims it. Outside-click/Esc handling stays
// per-surface — this hook only guarantees AT MOST ONE transient is open.
// Persistent controls (the breakpoint pills, section toggles) are not surfaces.
export function useTransientSurface(open: boolean, close: () => void): void {
  const id = useId()
  const closeRef = useRef(close)
  closeRef.current = close

  // Claim the slot on open.
  useEffect(() => {
    if (open) museStore.setState({ activeSurface: id })
  }, [open, id])

  // While open, close when someone else claims. (A natural close leaves the
  // stale id in the slot — harmless, the next claimer overwrites it.)
  useEffect(() => {
    if (!open) return
    return museStore.subscribe(() => {
      if (museStore.getState().activeSurface !== id) closeRef.current()
    })
  }, [open, id])
}
