import { useEffect, useReducer, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { StyleMutation } from '../../types'

type Corner = 'nw' | 'ne' | 'se' | 'sw'
type Drag = { corner: Corner; startX: number; startY: number; startW: number; startH: number; w: number; h: number }

// Figma-style corner resize: four small accent knobs on the selected element's
// corners. Dragging one scrubs width + height and commits w-[Npx]/h-[Npx] to
// source. Corners only (v1) — they sit clear of the box-model side handles, so a
// resize can never be confused with a padding/margin drag. Precise single-axis
// control lives in the panel's W/H fields. (getComputedStyle width/height are
// border-box px under Tailwind preflight, matching getBoundingClientRect, so a
// drag pins an auto/%/fr size to px — exactly Figma's behaviour.)
export function ResizeHandles({
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
  const r = node.getBoundingClientRect()

  const startDrag = (corner: Corner) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    // Measure fresh at pointer-down, not from the render-time rect, so a drag that
    // begins mid-reflow/transition starts from the element's actual current size.
    const live = node.getBoundingClientRect()
    const w = Math.round(live.width)
    const h = Math.round(live.height)
    const d: Drag = { corner, startX: e.clientX, startY: e.clientY, startW: w, startH: h, w, h }
    dragRef.current = d
    setDrag(d)
  }
  const moveDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const growX = d.corner === 'se' || d.corner === 'ne' ? 1 : -1
    const growY = d.corner === 'se' || d.corner === 'sw' ? 1 : -1
    const w = Math.max(8, Math.round(d.startW + growX * (e.clientX - d.startX)))
    const h = Math.max(8, Math.round(d.startH + growY * (e.clientY - d.startY)))
    const next = { ...d, w, h }
    dragRef.current = next
    setDrag(next)
    onPreview([
      { property: 'width', value: `${w}px` },
      { property: 'height', value: `${h}px` },
    ])
  }
  const endDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDrag(null)
    // Commit only the axes that actually moved — a near-horizontal drag shouldn't
    // pin the height (and a click without a drag commits nothing).
    const muts: StyleMutation[] = []
    if (d.w !== d.startW) muts.push({ property: 'width', value: `${d.w}px` })
    if (d.h !== d.startH) muts.push({ property: 'height', value: `${d.h}px` })
    if (muts.length) onCommit(muts)
  }

  const off = -5 // center the 10px knob on the corner
  const knob = (corner: Corner, style: CSSProperties, cursor: string) => (
    <div
      key={corner}
      onPointerDown={startDrag(corner)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`pointer-events-auto absolute h-2.5 w-2.5 rounded-[2px] border border-surface bg-accent shadow-sm ${cursor}`}
      style={style}
    />
  )

  return (
    <div className="pointer-events-none">
      {knob('nw', { top: r.top + off, left: r.left + off }, 'cursor-nwse-resize')}
      {knob('ne', { top: r.top + off, left: r.right + off }, 'cursor-nesw-resize')}
      {knob('se', { top: r.bottom + off, left: r.right + off }, 'cursor-nwse-resize')}
      {knob('sw', { top: r.bottom + off, left: r.left + off }, 'cursor-nesw-resize')}
      {drag && (
        <div
          className="absolute -translate-x-1/2 rounded bg-fg px-1.5 py-0.5 text-chip font-semibold tabular-nums text-surface shadow-md"
          style={{ top: r.top - 22, left: r.left + r.width / 2 }}
        >
          {drag.w} × {drag.h}
        </div>
      )}
    </div>
  )
}
