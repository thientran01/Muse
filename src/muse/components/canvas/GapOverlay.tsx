import { useEffect, useReducer, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { StyleMutation } from '../../types'

type Drag = { startPt: number; startVal: number; cur: number }

// Figma-style on-canvas gap editing: for a flex container, draw a draggable SKY
// band in the empty space BETWEEN each pair of children. Dragging any band scrubs
// the container's `gap` (one CSS value, so every band moves together) — the direct-
// manipulation answer to "there's no way to adjust the space between elements
// except the panel." Lives inside CanvasMode's [data-muse-ui] layer, so the bands
// (pointer-events-auto) never drill-select a child. v1 handles single-line flex;
// grid keeps the panel's row/col fields.
export function GapOverlay({
  node,
  onPreview,
  onCommit,
}: {
  node: HTMLElement
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
  const cs = getComputedStyle(node)
  if (!cs.display.includes('flex')) return null // grid → panel handles gap in v1
  const horizontal = cs.flexDirection.startsWith('row')
  const baseGap = Math.round(parseFloat(horizontal ? cs.columnGap : cs.rowGap) || 0)
  const g = drag ? drag.cur : baseGap

  const kids = ([...node.children] as Element[]).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.getClientRects().length > 0,
  )
  if (kids.length < 2) return null
  // DOM order ≠ visual order under flex-reverse; sort by position along the axis.
  const rects = kids.map((k) => k.getBoundingClientRect()).sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top))

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const d: Drag = { startPt: horizontal ? e.clientX : e.clientY, startVal: baseGap, cur: baseGap }
    dragRef.current = d
    setDrag(d)
  }
  const moveDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    // Dragging along the layout axis moves the band 1:1 with the pointer — grow
    // right/down, shrink left/up (clamped at 0).
    const raw = (horizontal ? e.clientX : e.clientY) - d.startPt
    const cur = Math.max(0, Math.round(d.startVal + raw))
    const next = { ...d, cur }
    dragRef.current = next
    setDrag(next)
    onPreview([{ property: 'gap', value: `${cur}px` }])
  }
  const endDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDrag(null)
    onCommit([{ property: 'gap', value: `${d.cur}px` }])
  }

  return (
    <div className="pointer-events-none">
      {rects.slice(0, -1).map((rect, i) => {
        const next = rects[i + 1]
        // The inter-child band. Min 6px wide hit area even when gap is tiny/zero.
        const span = horizontal ? next.left - rect.right : next.top - rect.bottom
        const thick = Math.max(span, 6)
        const box = horizontal
          ? { left: rect.right + (span - thick) / 2, top: Math.min(rect.top, next.top), width: thick, height: Math.max(rect.height, next.height) }
          : { top: rect.bottom + (span - thick) / 2, left: Math.min(rect.left, next.left), height: thick, width: Math.max(rect.width, next.width) }
        return (
          <div
            key={i}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`group pointer-events-auto absolute ${horizontal ? 'cursor-ew-resize' : 'cursor-ns-resize'} ${
              drag ? 'bg-sky-400/25' : 'bg-sky-400/10 hover:bg-sky-400/20'
            }`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          >
            {/* center line affordance */}
            <div
              className={`absolute transition-colors ${
                horizontal ? 'inset-y-0 left-1/2 w-[2px] -translate-x-1/2' : 'inset-x-0 top-1/2 h-[2px] -translate-y-1/2'
              } ${drag ? 'bg-sky-300' : 'bg-sky-400/60 group-hover:bg-sky-300'}`}
            />
            {/* value chip on the first band only (all gaps share the value) */}
            {i === 0 && (
              <div
                className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[9px] font-semibold tabular-nums ${
                  drag ? 'bg-fg text-surface shadow-sm' : 'text-sky-200/90'
                }`}
              >
                {g}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
