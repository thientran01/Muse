import { useEffect, useReducer, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// Figma-style drag-to-reorder. A dedicated grip handle pinned to the selected
// element; dragging it shows an accent INSERTION BAR at the nearest slot among its
// siblings and, on release, commits a deterministic source reorder (no model call)
// via the parent's onReorder → /api/muse/reorder → museWrite → history.
//
// The engine is 1D (move child A before source-slot N); all 2D logic lives HERE:
// we read the live sibling geometry and map a drop point to a source index. That
// mapping is only sound because reorder is gated host-only (source order === DOM
// order 1:1 — see computeReorderable), so the parent's element children ARE the
// source children, in order. The dragged element's DOM index === its source index.
//
// Gesture is deliberately isolated to this handle so it can be swapped for
// press-hold-body later without touching the commit path.
export function ReorderOverlay({
  node,
  expectedCount,
  onReorder,
}: {
  node: HTMLElement
  // How many movable children the ENGINE sees in source (the probe's count).
  // We map drop slots from live geometry, which only matches source order 1:1 if
  // the visible movable children line up with it — so if a child is hidden
  // (display:none → no client rect) the live count diverges and an index could
  // mis-target. We fail closed in that case rather than move the wrong element.
  expectedCount: number
  // Move the selected element to insertion slot `toIndex` (the source-order
  // position it lands BEFORE; siblings.length === drop at the end).
  onReorder: (toIndex: number) => void
}) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  // The live drop target while dragging: where the bar draws + which slot commits.
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const draggingRef = useRef(false)
  // The dragged element's dimmed opacity is an inline override we must always
  // restore (every exit path) so it can't strand a faded element on the page.
  const prevOpacityRef = useRef<string | null>(null)

  // Track the element through scroll / resize / reflow so the handle stays glued.
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

  // Restore the dragged element's opacity if we unmount mid-drag (e.g. HMR).
  useEffect(
    () => () => {
      if (prevOpacityRef.current !== null && node.isConnected) node.style.opacity = prevOpacityRef.current
      prevOpacityRef.current = null
    },
    [node],
  )

  if (!node.isConnected) return null
  const parent = node.parentElement
  if (!parent) return null
  const r = node.getBoundingClientRect()
  const layout = readLayout(parent)

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    draggingRef.current = true
    prevOpacityRef.current = node.style.opacity
    node.style.opacity = '0.4' // ghost the element being moved
    setDrop(computeDrop(node, e.clientX, e.clientY, layout, expectedCount))
  }
  const moveDrag = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return
    setDrop(computeDrop(node, e.clientX, e.clientY, layout, expectedCount))
  }
  const restoreOpacity = () => {
    if (prevOpacityRef.current !== null) {
      if (node.isConnected) node.style.opacity = prevOpacityRef.current
      prevOpacityRef.current = null
    }
  }
  const endDrag = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    draggingRef.current = false
    const target = computeDrop(node, e.clientX, e.clientY, layout, expectedCount)
    restoreOpacity()
    setDrop(null)
    // Only a real move commits — a tap, or a drop back into your own slot, is a
    // no-op (the engine guards this too, but skipping the round-trip is cleaner).
    if (target && !target.noop) onReorder(target.toIndex)
  }
  const cancelDrag = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    draggingRef.current = false
    restoreOpacity()
    setDrop(null)
  }

  return (
    <div className="pointer-events-none">
      {/* The insertion bar — only while dragging to an actionable slot. */}
      {drop && !drop.noop && (
        <div
          className="absolute z-10 rounded-full bg-accent shadow-[0_0_0_1px_rgb(var(--muse-accent)/0.35)]"
          style={drop.bar}
        />
      )}

      {/* Drag handle — a quiet grip pinned just above the element's top-left.
          Sits clear of the corner resize knobs and edge spacing handles. */}
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        title="Drag to reorder"
        className={`pointer-events-auto absolute z-10 flex h-5 items-center gap-1 rounded-md bg-accent px-1.5 text-surface shadow-sm ring-1 ring-surface/20 ${
          drop ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ top: r.top - 24, left: r.left }}
      >
        <GripDots />
      </div>
    </div>
  )
}

// Six-dot grip mark (two columns), drawn inline to avoid an icon dependency.
function GripDots() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden>
      {[2, 6, 10].map((cy) =>
        [2, 6].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" />),
      )}
    </svg>
  )
}

// --- drop-target geometry (the 2D → 1D mapping) ---

type DropTarget = {
  toIndex: number
  noop: boolean
  bar: { top: number; left: number; width: number; height: number }
}

// `vertical` = the insertion bar is horizontal (a stacked column / block flow);
// otherwise the bar is vertical (a row, or a 2D grid/wrap read left-to-right).
type Layout = { vertical: boolean }

function readLayout(parent: HTMLElement): Layout {
  const cs = getComputedStyle(parent)
  const disp = cs.display
  if (disp.includes('grid')) return { vertical: false } // 2D — read in rows, vertical bar
  if (disp.includes('flex')) {
    const wrap = cs.flexWrap.startsWith('wrap')
    if (wrap) return { vertical: false } // 2D wrap — same as grid
    return { vertical: cs.flexDirection.startsWith('column') }
  }
  return { vertical: true } // normal block flow stacks vertically
}

// The parent's movable children, in DOM (= source) order, with a client rect.
function siblingRects(node: HTMLElement): { nodes: HTMLElement[]; rects: DOMRect[] } {
  const parent = node.parentElement!
  const nodes = ([...parent.children] as Element[]).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.getClientRects().length > 0,
  )
  return { nodes, rects: nodes.map((n) => n.getBoundingClientRect()) }
}

// Map a pointer position to an insertion slot: find the nearest sibling by center
// distance (handles 2D — a grid cell is nearest by Euclidean distance), then choose
// the leading or trailing edge of that cell along the reading axis.
function computeDrop(
  node: HTMLElement,
  px: number,
  py: number,
  layout: Layout,
  expectedCount: number,
): DropTarget | null {
  const { nodes, rects } = siblingRects(node)
  if (rects.length === 0) return null
  // Fail closed: if the live movable children don't match what the engine sees in
  // source (e.g. a display:none sibling has no client rect), a visible-order index
  // would mis-target — don't reorder rather than move the wrong element.
  if (rects.length !== expectedCount) return null
  const fromIndex = nodes.indexOf(node)

  let j = 0
  let best = Infinity
  for (let i = 0; i < rects.length; i++) {
    const cx = rects[i].left + rects[i].width / 2
    const cy = rects[i].top + rects[i].height / 2
    const d = (cx - px) ** 2 + (cy - py) ** 2
    if (d < best) {
      best = d
      j = i
    }
  }

  const rj = rects[j]
  const before = layout.vertical ? py < rj.top + rj.height / 2 : px < rj.left + rj.width / 2
  const toIndex = before ? j : j + 1
  const noop = fromIndex !== -1 && (toIndex === fromIndex || toIndex === fromIndex + 1)

  const BAR = 3
  const bar = layout.vertical
    ? { left: rj.left, top: (before ? rj.top : rj.bottom) - BAR / 2, width: rj.width, height: BAR }
    : { top: rj.top, left: (before ? rj.left : rj.right) - BAR / 2, width: BAR, height: rj.height }

  return { toIndex, noop, bar }
}
