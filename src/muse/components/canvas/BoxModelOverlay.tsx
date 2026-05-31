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

const HANDLE = 9 // grab strip thickness
const MIN_LABEL = 14 // hide a band's value label when the band is thinner than this

// Color-coded edge line for a handle (padding = emerald, margin = amber). Full
// literal class strings so Tailwind's JIT can see them.
const lineCls = (box: Box, active: boolean) =>
  box === 'padding'
    ? active
      ? 'bg-emerald-300'
      : 'bg-emerald-400/60 group-hover:bg-emerald-300'
    : active
      ? 'bg-amber-300'
      : 'bg-amber-400/60 group-hover:bg-amber-300'

// Devtools-style visualization of the selected element. Padding shows as GREEN
// bands (inside), margin as AMBER bands (outside) — distinct hues so it's obvious
// which you're touching. Each band's draggable edge carries a visible color-coded
// line (the affordance + cursor) that scrubs that side; every non-trivial band
// shows its px value persistently, so you can read the current spacing at a glance
// and not just while dragging. Bands themselves stay pointer-events-none so a click
// inside the element still drills the selection to a child (see useCanvasMode);
// only the thin edge lines capture the drag. Re-measures on scroll / resize /
// element-resize and on every drag frame, so the bands track the reflow.
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

  // A draggable edge strip with a visible, color-coded line. Rendered via a plain
  // function (NOT a `<Handle/>` component) so React reuses the same DOM node across
  // the re-renders a drag triggers — a remount would drop the active pointer capture.
  const handle = (box: Box, side: Side, style: CSSProperties) => {
    const horizontal = side === 'top' || side === 'bottom'
    const active = !!drag && drag.box === box && drag.side === side
    return (
      <div
        key={`${box}-${side}`}
        onPointerDown={startDrag(box, side)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`group pointer-events-auto absolute ${horizontal ? 'cursor-ns-resize' : 'cursor-ew-resize'}`}
        style={style}
      >
        <div
          className={`absolute transition-colors ${
            horizontal ? 'inset-x-0 top-1/2 h-[2px] -translate-y-1/2' : 'inset-y-0 left-1/2 w-[2px] -translate-x-1/2'
          } ${lineCls(box, active)}`}
        />
      </div>
    )
  }

  // The px value sitting on a band, centered at (x,y). Muted + color-coded normally,
  // a solid chip while that side is being dragged. Hidden on bands too thin to fit it.
  const label = (box: Box, side: Side, value: number, x: number, y: number) => {
    const active = !!drag && drag.box === box && drag.side === side
    if (!active && value < MIN_LABEL) return null
    const tone = active
      ? 'bg-fg text-surface shadow-sm'
      : box === 'padding'
        ? 'text-emerald-200/90'
        : 'text-amber-200/90'
    return (
      <div
        key={`lbl-${box}-${side}`}
        className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[9px] font-semibold tabular-nums ${tone}`}
        style={{ left: x, top: y }}
      >
        {Math.round(value)}
      </div>
    )
  }

  return (
    <div className="pointer-events-none">
      {/* element outline — selection identity stays accent */}
      <div className="absolute rounded-[2px] ring-2 ring-accent" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />

      {/* margin bands (amber, outside the element) */}
      {mt > 0 && <div className="absolute bg-amber-400/15" style={{ top: r.top - mt, left: r.left, width: r.width, height: mt }} />}
      {mb > 0 && <div className="absolute bg-amber-400/15" style={{ top: r.bottom, left: r.left, width: r.width, height: mb }} />}
      {ml > 0 && <div className="absolute bg-amber-400/15" style={{ top: r.top, left: r.left - ml, width: ml, height: r.height }} />}
      {mr > 0 && <div className="absolute bg-amber-400/15" style={{ top: r.top, left: r.right, width: mr, height: r.height }} />}

      {/* padding bands (emerald, inside the element) */}
      {pt > 0 && <div className="absolute bg-emerald-400/20" style={{ top: r.top, left: r.left, width: r.width, height: pt }} />}
      {pb > 0 && <div className="absolute bg-emerald-400/20" style={{ top: r.bottom - pb, left: r.left, width: r.width, height: pb }} />}
      {pl > 0 && <div className="absolute bg-emerald-400/20" style={{ top: r.top + pt, left: r.left, width: pl, height: innerH }} />}
      {pr > 0 && <div className="absolute bg-emerald-400/20" style={{ top: r.top + pt, left: r.right - pr, width: pr, height: innerH }} />}

      {/* margin edge handles (outer edge) — UNDER the padding handles in z-order */}
      {handle('margin', 'top', { top: r.top - mt - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('margin', 'bottom', { top: r.bottom + mb - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('margin', 'left', { top: r.top, left: r.left - ml - HANDLE / 2, width: HANDLE, height: r.height })}
      {handle('margin', 'right', { top: r.top, left: r.right + mr - HANDLE / 2, width: HANDLE, height: r.height })}

      {/* padding edge handles (inner edge) — ABOVE margin handles so the inner/outer edges don't fight */}
      {handle('padding', 'top', { top: r.top + pt - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('padding', 'bottom', { top: r.bottom - pb - HANDLE / 2, left: r.left, width: r.width, height: HANDLE })}
      {handle('padding', 'left', { top: r.top, left: r.left + pl - HANDLE / 2, width: HANDLE, height: r.height })}
      {handle('padding', 'right', { top: r.top, left: r.right - pr - HANDLE / 2, width: HANDLE, height: r.height })}

      {/* persistent value labels */}
      {label('margin', 'top', mt, r.left + r.width / 2, r.top - mt / 2)}
      {label('margin', 'bottom', mb, r.left + r.width / 2, r.bottom + mb / 2)}
      {label('margin', 'left', ml, r.left - ml / 2, r.top + r.height / 2)}
      {label('margin', 'right', mr, r.right + mr / 2, r.top + r.height / 2)}
      {label('padding', 'top', pt, r.left + r.width / 2, r.top + pt / 2)}
      {label('padding', 'bottom', pb, r.left + r.width / 2, r.bottom - pb / 2)}
      {label('padding', 'left', pl, r.left + pl / 2, r.top + pt + innerH / 2)}
      {label('padding', 'right', pr, r.right - pr / 2, r.top + pt + innerH / 2)}
    </div>
  )
}
