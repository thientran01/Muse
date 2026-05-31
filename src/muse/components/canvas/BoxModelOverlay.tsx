import { useEffect, useReducer } from 'react'
import type { Sides } from './PropertiesPanel'

// Devtools-style visualization of the selected element: a solid outline plus a
// translucent band for each padding side, so spacing edits read spatially as you
// scrub them. Re-measures on scroll / resize / element-resize (e.g. after an
// edit's HMR repaint) so the bands track the live layout. Purely visual in this
// phase — editing happens in the controls popover.
export function BoxModelOverlay({ node, padding }: { node: HTMLElement; padding: Sides }) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const on = () => force()
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    const ro = new ResizeObserver(on)
    if (node.isConnected) ro.observe(node)
    return () => {
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
      ro.disconnect()
    }
  }, [node])

  if (!node.isConnected) return null
  const r = node.getBoundingClientRect()
  const { top: pt, right: pr, bottom: pb, left: pl } = padding
  const band = 'absolute bg-accent/20'

  return (
    <div className="pointer-events-none">
      <div
        className="absolute rounded-[2px] ring-2 ring-accent"
        style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
      />
      {pt > 0 && <div className={band} style={{ top: r.top, left: r.left, width: r.width, height: pt }} />}
      {pb > 0 && <div className={band} style={{ top: r.bottom - pb, left: r.left, width: r.width, height: pb }} />}
      {pl > 0 && <div className={band} style={{ top: r.top + pt, left: r.left, width: pl, height: r.height - pt - pb }} />}
      {pr > 0 && <div className={band} style={{ top: r.top + pt, left: r.right - pr, width: pr, height: r.height - pt - pb }} />}
    </div>
  )
}
