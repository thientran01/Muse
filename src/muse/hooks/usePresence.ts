import { useEffect, useState } from 'react'

/**
 * Keep `open` content mounted through an EXIT transition.
 *
 * Returns `mounted` (render the element while true) and `state` ('open' | 'closed')
 * for a `data-state` attribute that drives a CSS enter/exit transition. The element
 * mounts in the 'closed' style and flips to 'open' on the next frame (so the
 * transition runs), and on close flips back to 'closed' and unmounts after
 * `durationMs`. Using a data-state + CSS transition — rather than a keyframe — keeps
 * the motion interruptible: re-opening mid-exit smoothly retargets (Emil's rule).
 *
 * Pair with the `.muse-pop` class in muse.css.
 */
export function usePresence(open: boolean, durationMs = 150): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open)
  const [state, setState] = useState<'open' | 'closed'>(open ? 'open' : 'closed')

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Two rAFs: let the browser paint the 'closed' starting style before flipping
      // to 'open', otherwise React can batch both into one frame and the transition
      // never runs (it would just appear already-open).
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setState('open'))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setState('closed')
    const t = window.setTimeout(() => setMounted(false), durationMs)
    return () => window.clearTimeout(t)
  }, [open, durationMs])

  return { mounted, state }
}
