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
//
// MAKE ROOM (Figma-style): in a genuine 1D layout (one row / one column), the
// other siblings SLIDE in real time to open a gap where the dragged element will
// land — so the drop is obvious and the dragged element never just stacks on top
// of a static neighbor. The slide is purely visual (CSS transform on the
// siblings); the commit math is unchanged, so a mis-detected axis can only cost a
// cosmetic glitch, never a wrong edit. 2D grids / multi-row wrap and reduced-motion
// fall back to the insertion bar.
export function ReorderOverlay({
  node,
  expectedCount,
  onReorder,
  onDragChange,
}: {
  node: HTMLElement
  // How many movable children the ENGINE sees in source (the probe's count).
  // Drop slots are mapped from live geometry, which only matches source order 1:1
  // if the visible movable children line up with it — so if a child is hidden
  // (display:none → no client rect) the live count diverges and an index could
  // mis-target. We fail closed in that case rather than move the wrong element.
  expectedCount: number
  // Move the selected element to insertion slot `toIndex` (the source-order
  // position it lands BEFORE; siblings.length === drop at the end). Returns a
  // promise that resolves once the edit is written AND HMR has repainted +
  // re-selected, so the overlay can hold its lift/make-room until then and clear
  // it on the settled frame (no old-location flash, no double-jump).
  onReorder: (toIndex: number) => Promise<void>
  // Reports drag engage (true) / end (false) so the parent can hide the other
  // canvas chrome (panel, box-model, resize) that would cover the dragged element.
  // On a COMMITTED drop the overlay leaves it hidden and lets onReorder's caller
  // un-hide after the re-select settles; only cancel/no-op paths call (false) here.
  onDragChange?: (dragging: boolean) => void
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
  const onDragChangeRef = useRef(onDragChange)
  onDragChangeRef.current = onDragChange

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
    // Make-room: the sibling transition/transform inline values we override, saved
    // per node so we can restore exactly on teardown. Only set when oneAxis.
    sibPrev: Map<HTMLElement, { transition: string; transform: string }> | null
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

    // Restore lift + siblings immediately and un-hide the chrome. For cancel / no-op
    // (nothing was written), this is the whole story. A COMMITTED drop instead
    // routes through settleLanding → finalizeLanding (below), which holds the
    // made-room arrangement across the write + HMR repaint and un-hides itself.
    const teardown = (unhide = true) => {
      const p = press.current
      if (p?.dragging) {
        node.releasePointerCapture?.(p.pointerId) // capture is taken only on engage
        if (unhide) onDragChangeRef.current?.(false)
      }
      if (p?.sibPrev) restoreMakeRoom(p.sibPrev) // put the slid siblings back
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
        sibPrev: null,
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
        // Make-room is valid only on a true single line + with motion allowed;
        // otherwise we fall back to the insertion bar. Prime the sibling transitions.
        if (frozen.oneAxis && !prefersReducedMotion()) p.sibPrev = primeMakeRoom(frozen)
        onDragChangeRef.current?.(true) // hide the other canvas chrome for this drag
      }
      e.preventDefault()
      const dx = e.clientX - p.startX
      const dy = e.clientY - p.startY
      // Follow the cursor. Reduced-motion keeps the element in place (no scale/
      // translate) — the shadow + raised layer still signal "picked up".
      if (!prefersReducedMotion()) node.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`
      const target = computeDrop(e.clientX, e.clientY, p.frozen!, p.fromIndex)
      // When make-room is active, the opened gap IS the affordance — slide the
      // siblings and hide the bar. Otherwise show the bar (2D / reduced-motion).
      if (target && p.sibPrev) {
        applyMakeRoom(p.frozen!, target.slot, p.fromIndex)
        setDrop({ ...target, bar: null })
      } else {
        setDrop(target)
      }
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
      node.releasePointerCapture?.(e.pointerId)
      const target = computeDrop(e.clientX, e.clientY, p.frozen!, p.fromIndex)

      // A drop back into your own slot is a no-op — restore + un-hide now.
      if (!target || target.noop) {
        teardown()
        return
      }

      // COMMITTED drop. Don't snap. Ease the lifted element back DOWN to its origin
      // and glide the made-room siblings back to rest (a soft "set down"), and hold
      // the chrome hidden across the write + HMR repaint. HMR reuses these DOM nodes
      // and reconciles them POSITIONALLY (content is rewritten in place, nodes don't
      // move), so landing at the ORIGIN means the reorder shows up as content
      // updating with NO positional jump — far smoother than animating to the
      // destination (which would jump at the content swap). onReorder resolves after
      // HMR repaints + re-selects; only THEN do we finalize (restore the non-eased
      // styles, clear make-room, un-hide), so nothing flashes at the old location.
      const { prevStyle, sibPrev } = p
      setDrop(null)
      press.current = null // drag is over; saved styles captured in locals above
      settleLanding(node, prevStyle, sibPrev)
      void onReorderRef.current(target.toIndex).finally(() => {
        finalizeLanding(node, prevStyle, sibPrev)
        onDragChangeRef.current?.(false) // un-hide AFTER the new order is on screen
      })
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

  // The dragged element follows the cursor itself; siblings make room via their
  // own transforms. The only thing this component RENDERS is the insertion bar,
  // and only in the fallback (2D / reduced-motion) where make-room is off.
  return (
    <div className="pointer-events-none">
      {drop?.bar && !drop.noop && (
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

// Soft "set down" on a committed drop: ease the lifted element back to its origin
// (transform → its pre-drag value, shadow/scale/opacity easing out) and glide the
// made-room siblings back to rest, all over SLIDE_MS. The element keeps zIndex
// until finalize, so it stays above its peers during the descent. Reduced-motion
// never lifted, so there's nothing to ease — finalize handles it.
function settleLanding(node: HTMLElement, prev: SavedStyle | null, sibPrev: Map<HTMLElement, { transition: string; transform: string }> | null) {
  if (prev && node.isConnected && !prefersReducedMotion()) {
    const s = node.style
    s.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.16,1,0.3,1), box-shadow ${SLIDE_MS}ms cubic-bezier(0.16,1,0.3,1), opacity ${SLIDE_MS}ms cubic-bezier(0.16,1,0.3,1)`
    s.transform = prev.transform // back to origin
    s.boxShadow = prev.boxShadow
    s.opacity = prev.opacity
  }
  if (sibPrev) for (const [n] of sibPrev) if (n.isConnected) n.style.transform = '' // siblings glide home (their transition is still primed)
}

// After the new order is on screen (onReorder settled), clear the remaining
// overrides — zIndex/willChange/cursor on the element, transitions on the siblings —
// so nothing is stranded. Transform/shadow/opacity already eased to rest in settle.
function finalizeLanding(node: HTMLElement, prev: SavedStyle | null, sibPrev: Map<HTMLElement, { transition: string; transform: string }> | null) {
  if (prev && node.isConnected) restoreLift(node, prev)
  if (sibPrev) restoreMakeRoom(sibPrev)
}

// --- drop-target geometry (the 2D → 1D mapping) ---

type DropTarget = {
  toIndex: number // slot in FULL source order (what onReorder receives)
  slot: number // slot among the OTHER siblings (0..others.length) — drives make-room
  noop: boolean
  bar: { top: number; left: number; width: number; height: number } | null
}

type Layout = { vertical: boolean }

// Frozen at pickup, all immune to the dragged element's follow transform:
//  • nodes/rects — the OTHER movable siblings (dragged node excluded), in source
//    order, used for the drop search AND the make-room slide.
//  • layout — the reading axis (which way the insertion bar / slide runs).
//  • draggedRect — the dragged element's own rect, so the slide knows how far each
//    sibling must move to open its gap (the gap == the dragged element's extent +
//    the layout gap between siblings).
//  • oneAxis — true only when every sibling shares the dragged element's row (for a
//    horizontal axis) or column (vertical): the make-room slide is a single-axis
//    shift, which is only correct in a true 1D line. Real 2D grids / wrapped rows
//    set this false → insertion-bar fallback.
type Frozen = { nodes: HTMLElement[]; rects: DOMRect[]; layout: Layout; draggedRect: DOMRect; gap: number; oneAxis: boolean }

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

// Snapshot at pickup: the OTHER siblings (nodes + rects, dragged excluded), the
// dragged element's own rect, the inter-sibling gap, the axis, and whether this is
// a genuine single line (so make-room is geometrically valid).
function freezeSiblings(parent: HTMLElement, dragged: HTMLElement): Frozen {
  const layout = readLayout(parent)
  const draggedRect = dragged.getBoundingClientRect()
  const all = movableSiblings(parent)
  const nodes = all.filter((n) => n !== dragged)
  const rects = nodes.map((n) => n.getBoundingClientRect())

  // One line iff every element (incl. the dragged one) overlaps on the cross axis —
  // same row for a horizontal layout, same column for a vertical one. Robust to the
  // CSS specifics (flex vs block vs inline) since it reads actual geometry.
  const allRects = all.map((n) => n.getBoundingClientRect())
  const oneAxis = allRects.every((r) =>
    layout.vertical
      ? r.left < draggedRect.right && r.right > draggedRect.left // shares the column
      : r.top < draggedRect.bottom && r.bottom > draggedRect.top, // shares the row
  )

  // The gap to leave between elements when sliding = the median center-to-center
  // spacing minus element extent, floored at 0. Cheap + good enough for the slide.
  let gap = 0
  if (allRects.length >= 2) {
    const sorted = [...allRects].sort((a, b) => (layout.vertical ? a.top - b.top : a.left - b.left))
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(layout.vertical ? sorted[i].top - sorted[i - 1].bottom : sorted[i].left - sorted[i - 1].right)
    }
    gaps.sort((a, b) => a - b)
    gap = Math.max(0, gaps[gaps.length >> 1])
  }

  return { nodes, rects, layout, draggedRect, gap, oneAxis }
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

  return { toIndex, slot, noop, bar }
}

// --- make-room: slide siblings to open the drop gap (Figma-style) ---

const SLIDE_MS = 160 // matches the project's motion scale (<300ms easeOut)

// Save each sibling's inline transition/transform and prime the transition so the
// per-move shifts animate instead of snapping. Returns the saved map for restore.
function primeMakeRoom(frozen: Frozen): Map<HTMLElement, { transition: string; transform: string }> {
  const saved = new Map<HTMLElement, { transition: string; transform: string }>()
  for (const n of frozen.nodes) {
    saved.set(n, { transition: n.style.transition, transform: n.style.transform })
    n.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.16,1,0.3,1)`
    n.style.willChange = 'transform'
  }
  return saved
}

// Open the drop gap by sliding only the siblings BETWEEN the dragged element's
// original slot and the target slot — and in the correct direction.
//
// The dragged element moves by transform, so its layout box stays put: the frozen
// sibling positions still contain a "hole" at fromIndex. So a sibling's shift is
// its FINAL slot minus its FROZEN slot, in hole-units (each ±1 = one extent+gap):
//   • frozen full-index of nodes[i] = i < fromIndex ? i : i+1
//   • final  full-index of nodes[i] = i < slot      ? i : i+1
// Dragging FORWARD (slot > fromIndex): siblings fromIndex≤i<slot shift -1 (back,
// toward the vacated hole). Dragging BACKWARD (slot < fromIndex): siblings
// slot≤i<fromIndex shift +1 (forward, away). Everything else stays at rest. (The
// old "everything ≥ slot moves forward" was only right when dragging the LAST
// element — hence the first-element-forward bug.)
function applyMakeRoom(frozen: Frozen, slot: number, fromIndex: number) {
  const { nodes, layout, draggedRect, gap } = frozen
  const step = (layout.vertical ? draggedRect.height : draggedRect.width) + gap
  for (let i = 0; i < nodes.length; i++) {
    const frozenK = i < fromIndex ? i : i + 1
    const finalK = i < slot ? i : i + 1
    const d = (finalK - frozenK) * step // ∈ {-step, 0, +step}
    nodes[i].style.transform = d === 0 ? '' : layout.vertical ? `translateY(${d}px)` : `translateX(${d}px)`
  }
}

function restoreMakeRoom(saved: Map<HTMLElement, { transition: string; transform: string }>) {
  for (const [n, prev] of saved) {
    if (!n.isConnected) continue
    n.style.transition = prev.transition
    n.style.transform = prev.transform
    n.style.willChange = ''
  }
}
