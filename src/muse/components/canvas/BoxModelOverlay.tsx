import { useEffect, useReducer, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { StyleMutation, StyleProperty } from '../../types'
import type { Sides } from './PropertiesPanel'

type Box = 'padding' | 'margin'
type Side = 'top' | 'right' | 'bottom' | 'left'
type Drag = { box: Box; side: Side; startPt: number; startVal: number; cur: number }

const cap = (s: Side) => (s[0].toUpperCase() + s.slice(1)) as 'Top' | 'Right' | 'Bottom' | 'Left'
const prop = (box: Box, side: Side): StyleProperty => `${box}${cap(side)}` as StyleProperty
// Drag toward the element's interior grows the value. dy/dx are pointer deltas.
const delta = (box: Box, side: Side, dx: number, dy: number) => {
  if (box === 'padding') return side === 'top' ? dy : side === 'bottom' ? -dy : side === 'left' ? dx : -dx
  return side === 'top' ? -dy : side === 'bottom' ? dy : side === 'left' ? -dx : dx
}

// Devtools-style visualization of the selected element with DRAGGABLE edges: a
// solid outline, a translucent band per padding/margin side, and a thin handle on
// each band's inner (padding) / outer (margin) edge that scrubs that side's value
// in place. Dragging previews live (inline style on the node, via onPreview) and
// commits on release (onCommit). Re-measures on scroll / resize / element-resize
// and on every drag frame, so the bands track the reflow as spacing changes.
export function BoxModelOverlay({
  node,
  padding,
  margin,
  onPreview,
  onCommit,
}: {
  node: HTMLElement
  padding: Sides
  margin: Sides
  onPreview: (m: StyleMutation[]) => void
  onCommit: (m: StyleMutation[]) => void
}) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)

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

  // Effective values: the live computed sides, overridden by an in-progress drag.
  const eff = (box: Box, base: Sides): Sides => {
    if (drag && drag.box === box) return { ...base, [drag.side]: drag.cur }
    return base
  }
  const pad = eff('padding', padding)
  const mar = eff('margin', margin)

  const startDrag = (box: Box, side: Side) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const base = box === 'padding' ? padding : margin
    const d: Drag = { box, side, startPt: side === 'top' || side === 'bottom' ? e.clientY : e.clientX, startVal: base[side], cur: base[side] }
    dragRef.current = d
    setDrag(d)
  }
  const moveDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - (d.side === 'left' || d.side === 'right' ? d.startPt : e.clientX)
    const dy = e.clientY - (d.side === 'top' || d.side === 'bottom' ? d.startPt : e.clientY)
    const min = d.box === 'padding' ? 0 : -Infinity
    const cur = Math.max(min, Math.round(d.startVal + delta(d.box, d.side, dx, dy)))
    const next = { ...d, cur }
    dragRef.current = next
    setDrag(next)
    onPreview([{ property: prop(d.box, d.side), value: `${cur}px` }])
  }
  const endDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDrag(null)
    onCommit([{ property: prop(d.box, d.side), value: `${d.cur}px` }])
  }

  const { top: pt, right: pr, bottom: pb, left: pl } = pad
  const { top: mt, right: mr, bottom: mb, left: ml } = mar
  // Inner content box (inside padding), used to size the L/R bands.
  const innerH = Math.max(0, r.height - pt - pb)
  const HANDLE = 7 // grab strip thickness

  // A draggable edge strip. Rendered via a plain function (NOT a `<Handle/>`
  // component) so React reuses the same DOM node across the re-renders a drag
  // triggers — a remount would drop the active pointer capture mid-drag.
  const handle = (box: Box, side: Side, style: CSSProperties) => (
    <div
      key={`${box}-${side}`}
      onPointerDown={startDrag(box, side)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`pointer-events-auto absolute ${side === 'top' || side === 'bottom' ? 'cursor-ns-resize' : 'cursor-ew-resize'} ${
        drag && drag.box === box && drag.side === side ? 'bg-accent/60' : 'hover:bg-accent/40'
      }`}
      style={style}
    />
  )

  return (
    <div className="pointer-events-none">
      {/* element outline */}
      <div className="absolute rounded-[2px] ring-2 ring-accent" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />

      {/* margin bands (outside the element) */}
      {mt > 0 && <div className="absolute bg-accent/10" style={{ top: r.top - mt, left: r.left, width: r.width, height: mt }} />}
      {mb > 0 && <div className="absolute bg-accent/10" style={{ top: r.bottom, left: r.left, width: r.width, height: mb }} />}
      {ml > 0 && <div className="absolute bg-accent/10" style={{ top: r.top, left: r.left - ml, width: ml, height: r.height }} />}
      {mr > 0 && <div className="absolute bg-accent/10" style={{ top: r.top, left: r.right, width: mr, height: r.height }} />}

      {/* padding bands (inside the element) */}
      {pt > 0 && <div className="absolute bg-accent/20" style={{ top: r.top, left: r.left, width: r.width, height: pt }} />}
      {pb > 0 && <div className="absolute bg-accent/20" style={{ top: r.bottom - pb, left: r.left, width: r.width, height: pb }} />}
      {pl > 0 && <div className="absolute bg-accent/20" style={{ top: r.top + pt, left: r.left, width: pl, height: innerH }} />}
      {pr > 0 && <div className="absolute bg-accent/20" style={{ top: r.top + pt, left: r.right - pr, width: pr, height: innerH }} />}

      {/* padding edge handles (at the inner edge of each padding band) */}
      {handle('padding', 'top', { top: r.top + pt - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('padding', 'bottom', { top: r.bottom - pb - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('padding', 'left', { top: r.top, left: r.left + pl - HANDLE / 2, width: HANDLE, height: r.height })}
      {handle('padding', 'right', { top: r.top, left: r.right - pr - HANDLE / 2, width: HANDLE, height: r.height })}

      {/* margin edge handles (at the outer edge of each margin band) */}
      {handle('margin', 'top', { top: r.top - mt - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('margin', 'bottom', { top: r.bottom + mb - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('margin', 'left', { top: r.top, left: r.left - ml - HANDLE / 2, width: HANDLE, height: r.height })}
      {handle('margin', 'right', { top: r.top, left: r.right + mr - HANDLE / 2, width: HANDLE, height: r.height })}

      {/* live value readout while dragging */}
      {drag && (
        <div
          className="absolute rounded bg-fg px-1.5 py-0.5 text-[10px] font-semibold text-surface shadow-md"
          style={{ top: r.top - 22, left: r.left }}
        >
          {drag.box} {drag.side} {drag.cur}px
        </div>
      )}
    </div>
  )
}
