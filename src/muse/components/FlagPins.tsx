import { useEffect, useState } from 'react'
import { findFlagNode, revealFlag } from '../flagLocate'
import { useMuseStore } from '../store'
import type { Flag } from '../types'

type Pin = { flag: Flag; n: string; top: number; left: number }

// Best-effort markers: a small numbered dot at each OPEN flag's live element. A flag whose
// element has drifted past its captured line simply gets no pin (the panel still lists it).
// Re-measures on scroll/resize so pins track the page; clicking one scrolls to + flashes it.
export function FlagPins() {
  const { flags } = useMuseStore()
  const [pins, setPins] = useState<Pin[]>([])

  useEffect(() => {
    const open = flags.filter((f) => f.status === 'open')
    let raf = 0
    const measure = () => {
      const next: Pin[] = []
      for (const f of open) {
        const node = findFlagNode(f)
        if (!node) continue
        const r = node.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        // skip pins for elements scrolled fully off-screen
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue
        next.push({ flag: f, n: f.id.replace(/^f_/, ''), top: r.top - 8, left: r.left - 8 })
      }
      setPins(next)
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [flags])

  return (
    <>
      {pins.map((p) => (
        <button
          key={p.flag.id}
          type="button"
          title={p.flag.comment || `Flag ${p.flag.id}`}
          aria-label={`Flag ${p.n}: ${p.flag.comment || 'no note'}`}
          onClick={() => revealFlag(p.flag)}
          style={{ top: p.top, left: p.left }}
          className="pointer-events-auto absolute z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white shadow ring-1 ring-surface-soft/40 transition duration-[120ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
        >
          {p.n}
        </button>
      ))}
    </>
  )
}
