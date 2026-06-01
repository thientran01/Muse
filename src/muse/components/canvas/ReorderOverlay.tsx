import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 5 // px the pointer must travel before a press becomes a drag

// Figma-style drag-to-reorder, gesture = press the element body + drag.
//
// Listeners live on the REAL element (not an overlay surface) using POINTER
// events, which useCanvasMode doesn't use — it drives select/drill off mouse +
// click. So a press that never crosses THRESHOLD never calls preventDefault, the
// normal `click` still reaches useCanvasMode, and selection/drill-in is untouched.
// Only once the pointer crosses THRESHOLD does the drag ENGAGE: the element lifts
// (scale + shadow + raised layer) and FOLLOWS the cursor via a CSS transform,
// while an accent insertion bar shows the drop slot. Release commits a
// deterministic source reorder (no model call) via onReorder → /api/muse/reorder
// → museWrite → history.
//
// The engine is 1D (move child A before source-slot N); all 2D logic lives HERE:
// we map a drop point to a source index from sibling geometry. That mapping is
// only sound because reorder is gated host-only (source order === DOM order 1:1 —
// see computeReorderable), so the parent's element children ARE the source
// children, in order, and the dragged element's DOM index === its source index.
//
// Two things make follow-the-cursor safe: (1) the lift is a CSS transform, which
// moves the element WITHOUT reflowing siblings, so the drop geometry stays stable;
// (2) we FREEZE the other siblings' rects at pickup, EXCLUDING the dragged node —
// otherwise its rect would move with the pointer and always match itself.
// setPointerCapture retargets the compat mouse events to the node during a drag,
// so useCanvasMode's hover highlight sees the node (contained) and self-clears
// instead of flickering across siblings.
export function ReorderOverlay({
  node,
  expectedCount,
  onReorder,
}: {
  node: HTMLElement
  // How many movable children the ENGINE sees in source (the probe's count).
  // Drop slots are mapped from live geometry, which only matches source order 1:1
  // if the visible movable children line up with it — so if a child is hidden
  // (display:none → no client rect) the live count diverges and an index could
  // mis-target. We fail closed in that case rather than move the wrong element.
  expectedCount: number
  // Move the selected element to insertion slot `toIndex` (the source-order
  // position it lands BEFORE; siblings.length === drop at the end).
  onReorder: (toIndex: number) => void
}) {
  // The live drop target while dragging: where the bar draws + which slot commits.
  const [drop, setDrop] = useState<DropTarget | null>(null)
  // Latest props read inside the imperative listeners, so the listener effect only
  // re-subscribes on `node` (mirrors useCanvasMode's ref pattern) — an inline
  // onReorder identity change per render must not detach mid-press.
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder
  const expectedCountRef = useRef(expectedCount)
  expectedCountRef.current = expectedCount

  // A press in progress. `dragging` flips true only after THRESHOLD, so a click
  // below threshold stays a normal select. `frozen` is the sibling geometry
  // snapshotted at engage (excludes the dragged node). `prevStyle` saves the
  // element's inline styles we override for the lift, to restore on every exit.
  const press = useRef<{
    startX: number
    startY: number
    pointerId: number
    dragging: boolean
    fromIndex: number
    frozen: Frozen | null
    prevStyle: SavedStyle | null
  } | null>(null)

  useEffect(() => {
    if (!node.isConnected) return
    const parent = node.parentElement
    if (!parent) return

    // A pending one-shot click-swallower (set on drop), tracked so teardown can
    // cancel it if the component unmounts in the gap before the trailing click.
    let cancelSwallow: (() => void) | null = null

    // Advertise the body as draggable BEFORE any press (siblings set their cursor
    // unconditionally too); saved/restored so we don't clobber a host cursor.
    const prevCursor = node.style.cursor
    node.style.cursor = 'grab'

    const teardown = () => {
      const p = press.current
      if (p?.dragging) node.releasePointerCapture?.(p.pointerId) // capture is taken only on engage
      if (p?.prevStyle && node.isConnected) restoreLift(node, p.prevStyle)
      press.current = null
      setDrop(null)
    }

    const onDown = (e: PointerEvent) => {
      if (press.current || e.button !== 0) return // primary button only
      // Don't preventDefault/stopPropagation OR capture yet — a press that never
      // crosses the threshold must remain a plain click for useCanvasMode to
      // select/drill, and capturing early can suppress touch-scroll + muddy click
      // routing. Capture is deferred to engage (below).
      const nodes = movableSiblings(parent)
      press.current = {
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        dragging: false,
        fromIndex: nodes.indexOf(node),
        frozen: null,
        prevStyle: null,
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < THRESHOLD) return
        // Engage: snapshot geometry (excluding the dragged node), lift the element.
        const frozen = freezeSiblings(parent, node)
        // Fail closed: the dragged node must be a known movable sibling, and the
        // live movable count (others + dragged) must match what the engine sees in
        // source — else an index could mis-target. Abandon, leave it a no-op.
        if (p.fromIndex < 0 || frozen.rects.length + 1 !== expectedCountRef.current) {
          teardown()
          return
        }
        node.setPointerCapture(e.pointerId) // now retarget the stream to the node
        p.frozen = frozen
        p.dragging = true
        p.prevStyle = applyLift(node)
      }
      e.preventDefault()
      const dx = e.clientX - p.startX
      const dy = e.clientY - p.startY
      // Follow the cursor. Reduced-motion keeps the element in place (no scale/
      // translate) — the shadow + raised layer still signal "picked up".
      if (!prefersReducedMotion()) node.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`
      setDrop(computeDrop(e.clientX, e.clientY, p.frozen!, p.fromIndex))
    }

    const onUp = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      if (!p.dragging) {
        press.current = null // a click — let it select/drill, nothing to undo
        return
      }
      node.releasePointerCapture?.(e.pointerId)
      e.preventDefault()
      // A threshold-crossing drag still emits a trailing `click` at the drop point.
      // useCanvasMode's click handler is on document (capture), so it would select
      // whatever's under the cursor at release — wrong. Swallow that one click with
      // a WINDOW capture listener (window capture fires before document capture, so
      // it preempts useCanvasMode). One-shot + a timeout in case no click comes
      // (some browsers suppress click after a drag). Tracked via cancelSwallow so
      // teardown can clear it if we unmount before the click lands.
      const swallowClick = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
        cleanupSwallow()
      }
      const killSwallow = window.setTimeout(() => cleanupSwallow(), 350)
      const cleanupSwallow = () => {
        window.removeEventListener('click', swallowClick, true)
        window.clearTimeout(killSwallow)
        cancelSwallow = null
      }
      window.addEventListener('click', swallowClick, true)
      cancelSwallow = cleanupSwallow
      const target = computeDrop(e.clientX, e.clientY, p.frozen!, p.fromIndex)
      teardown()
      // Only a real move commits — a drop back into your own slot is a no-op (the
      // engine guards this too, but skipping the round-trip is cleaner).
      if (target && !target.noop) onReorderRef.current(target.toIndex)
    }

    const onCancel = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      teardown()
    }

    node.addEventListener('pointerdown', onDown)
    node.addEventListener('pointermove', onPointerMove)
    node.addEventListener('pointerup', onUp)
    node.addEventListener('pointercancel', onCancel)
    return () => {
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onPointerMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onCancel)
      cancelSwallow?.() // don't leave a window click-swallower alive past unmount
      teardown() // restore the lift if we unmount mid-drag (e.g. HMR)
      if (node.isConnected) node.style.cursor = prevCursor
    }
  }, [node])

  // The dragged element follows the cursor itself; the only thing this component
  // renders is the insertion bar (in the shared fixed overlay layer).
  return (
    <div className="pointer-events-none">
      {drop && !drop.noop && (
        <div
          className="absolute z-10 rounded-sm bg-accent shadow-[0_0_0_1px_rgb(var(--muse-accent)/0.35)]"
          style={drop.bar}
        />
      )}
    </div>
  )
}

// --- lift (transform + shadow + raised layer), saved/restored as one unit ---

type SavedStyle = { transform: string; boxShadow: string; zIndex: string; opacity: string; transition: string; cursor: string; willChange: string }

function applyLift(node: HTMLElement): SavedStyle {
  const s = node.style
  const prev: SavedStyle = {
    transform: s.transform,
    boxShadow: s.boxShadow,
    zIndex: s.zIndex,
    opacity: s.opacity,
    transition: s.transition,
    cursor: s.cursor,
    willChange: s.willChange,
  }
  // Reduced-motion keeps the element in place (onPointerMove skips the follow
  // transform); the shadow + raised layer + fade still read as "picked up".
  if (!prefersReducedMotion()) s.transform = 'scale(1.03)'
  // Neutral elevation, NOT an accent ring: the selected element already wears the
  // accent selection ring (BoxModelOverlay), so the lift signals depth (shadow +
  // raised layer + scale) while accent stays the language of selection + the drop
  // bar — three roles, two visual cues, no accent-halo collision.
  s.boxShadow = '0 12px 28px -6px rgb(0 0 0 / 0.45), 0 2px 6px -2px rgb(0 0 0 / 0.3)'
  s.zIndex = '999990' // above peers, below Muse's overlay chrome
  s.opacity = '0.95'
  s.transition = 'none' // we drive transform per-frame; no lag
  s.cursor = 'grabbing'
  s.willChange = 'transform'
  return prev
}

// Honor the OS reduce-motion setting for the lift's movement cues (scale + follow).
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function restoreLift(node: HTMLElement, prev: SavedStyle) {
  const s = node.style
  s.transform = prev.transform
  s.boxShadow = prev.boxShadow
  s.zIndex = prev.zIndex
  s.opacity = prev.opacity
  s.transition = prev.transition
  s.cursor = prev.cursor
  s.willChange = prev.willChange
}

// --- drop-target geometry (the 2D → 1D mapping) ---

type DropTarget = {
  toIndex: number
  noop: boolean
  bar: { top: number; left: number; width: number; height: number }
}

type Layout = { vertical: boolean }

// Frozen at pickup: the OTHER movable siblings' rects (dragged node excluded) and
// the layout axis — all immune to the dragged element's follow transform.
type Frozen = { rects: DOMRect[]; layout: Layout }

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

// The parent's movable children in DOM (= source) order, with a visible rect.
function movableSiblings(parent: HTMLElement): HTMLElement[] {
  return ([...parent.children] as Element[]).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.getClientRects().length > 0,
  )
}

// Snapshot the OTHER siblings' geometry at pickup (dragged node excluded), so the
// drop search is stable while the dragged element follows the cursor.
function freezeSiblings(parent: HTMLElement, dragged: HTMLElement): Frozen {
  const others = movableSiblings(parent).filter((n) => n !== dragged)
  return { rects: others.map((n) => n.getBoundingClientRect()), layout: readLayout(parent) }
}

// Map a pointer position to an insertion slot among the FROZEN (other) siblings:
// nearest neighbor by center distance (handles 2D), then leading/trailing edge
// along the reading axis. `slot` is an index in OTHER-sibling space (0..others);
// lift it back into full source order using `fromIndex` (the dragged node's slot).
function computeDrop(px: number, py: number, frozen: Frozen, fromIndex: number): DropTarget | null {
  const { rects, layout } = frozen
  if (rects.length === 0) return null

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
  const slot = before ? j : j + 1
  // Other-sibling index i corresponds to original index i (i < fromIndex) or i+1
  // (i ≥ fromIndex). So an insertion slot ≤ fromIndex maps straight through; past
  // it, add one to skip the dragged node's vacated original position.
  const toIndex = slot <= fromIndex ? slot : slot + 1
  const noop = toIndex === fromIndex || toIndex === fromIndex + 1

  const BAR = 3
  const bar = layout.vertical
    ? { left: rj.left, top: (before ? rj.top : rj.bottom) - BAR / 2, width: rj.width, height: BAR }
    : { top: rj.top, left: (before ? rj.left : rj.right) - BAR / 2, width: BAR, height: rj.height }

  return { toIndex, noop, bar }
}
