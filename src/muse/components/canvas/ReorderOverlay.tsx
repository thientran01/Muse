import { useEffect, useRef, useState } from 'react'
import type { ReorderChild } from '../../types'
import { getSourceLocation } from '../../sourceLocation'

const THRESHOLD = 5 // px the pointer must travel before a press becomes a drag
// Strand-guard for the held lift/make-room transforms if the post-drop repaint never fires.
// Must exceed a slow, write-decoupled RSC refresh (Next/Turbopack) so it can't pre-empt a
// late-but-real swap; the MutationObserver clears earlier on the actual swap. Exported so
// CanvasMode's repaint-wait shares the SAME cap (overlay clear + re-select finalize together).
export const SETTLE_CAP_MS = 2500
// Above this many movable siblings, skip the exact per-slot ghost measure and use the analytic
// local-gap make-room — a guard for a pathologically large group, where the measures could
// accumulate. Profiled at ~1ms/measure on a heavy real page (18.5k-px doc, embeds, framer), so
// this is generous; the measure only fires on a user-paced slot-change, never per frame.
const MAX_MEASURE_MEMBERS = 200

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
// otherwise its rect would move with the pointer and always match itself. (exactMakeRoom
// does perform a controlled SYNCHRONOUS ghost reflow on a slot-change to measure the real
// landing — but it reverts the DOM + transforms before returning, before any frame paints,
// and never re-reads the frozen rects, so the drop geometry above stays stable.)
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
  sourceKeys,
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
  // SELF-ANCHOR only: the engine's source-child key-list (tag + static className), in
  // source order. When present, the dragged node's parent is a component-internal host
  // (e.g. Section's <motion.div>) that may INJECT its own nodes (a label) beside the
  // projected source children — so the movable set is built by MATCHING the parent's
  // in-flow DOM children to these keys (skipping injected + out-of-flow nodes) instead of
  // taking every child. Absent (container-anchor / host child) → the proven raw path.
  sourceKeys?: ReorderChild[] | null
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
  const sourceKeysRef = useRef(sourceKeys)
  sourceKeysRef.current = sourceKeys
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
    // The movable sibling run in SOURCE order, snapshotted at press start (the matched
    // members for self-anchor, or every visible child for the raw path). Frozen here so
    // the engage-time geometry reads the same set the index was computed against.
    members: HTMLElement[]
    frozen: Frozen | null
    prevStyle: SavedStyle | null
    // Make-room: the sibling transition/transform inline values we override, saved
    // per node so we can restore exactly on teardown. Only set when oneAxis.
    sibPrev: Map<HTMLElement, { transition: string; transform: string }> | null
    // Exact per-sibling make-room displacements, measured (ghost reorder) once per
    // target slot and cached so re-hovering a slot is free — see exactMakeRoom.
    measureCache: Map<number, number[]>
  } | null>(null)

  useEffect(() => {
    if (!node.isConnected) return
    const parent = node.parentElement
    if (!parent) return

    // A pending one-shot click-swallower (set on drop), tracked so teardown can
    // cancel it if the component unmounts in the gap before the trailing click.
    let cancelSwallow: (() => void) | null = null

    // The point that drives the drop slot. We key it off the dragged element's BODY
    // (its projected center) rather than the raw cursor, so the insertion tracks what
    // the user SEES — the card — no matter where on the card they grabbed it. With a
    // cursor-only rule, grabbing a card near its edge and dragging it over a TALLER
    // neighbor left the card fully overlapping that neighbor while the cursor was still
    // short of the neighbor's center, so no gap opened and the drag felt stuck ("can't
    // get through the big card"). Keying off the card's midpoint makes the swap fire
    // when the card's center crosses the neighbor's center — the standard sortable feel,
    // independent of grab offset. Reduced motion never moves the element (onPointerMove
    // skips the follow transform), so there the cursor is the only signal — fall back to it.
    const dropPoint = (e: PointerEvent, p: NonNullable<typeof press.current>) => {
      if (prefersReducedMotion() || !p.frozen) return { x: e.clientX, y: e.clientY }
      const dr = p.frozen.draggedRect
      return { x: dr.left + dr.width / 2 + (e.clientX - p.startX), y: dr.top + dr.height / 2 + (e.clientY - p.startY) }
    }

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
      const nodes = resolveMembers(parent, sourceKeysRef.current, node)
      press.current = {
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        dragging: false,
        fromIndex: nodes.indexOf(node),
        members: nodes,
        frozen: null,
        prevStyle: null,
        sibPrev: null,
        measureCache: new Map(),
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < THRESHOLD) return
        // Engage: snapshot geometry (excluding the dragged node), lift the element.
        const frozen = freezeSiblings(parent, p.members, node)
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
      const dp = dropPoint(e, p)
      const target = computeDrop(dp.x, dp.y, p.frozen!, p.fromIndex)
      // When make-room is active, the opened gap IS the affordance — slide the
      // siblings and hide the bar. Otherwise show the bar (2D / reduced-motion).
      if (target && p.sibPrev) {
        exactMakeRoom(parent, node, p.frozen!, p.members, target.toIndex, target.slot, p.fromIndex, p.measureCache)
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
      const dp = dropPoint(e, p)
      const target = computeDrop(dp.x, dp.y, p.frozen!, p.fromIndex)

      // A drop back into your own slot is a no-op — restore + un-hide now.
      if (!target || target.noop) {
        teardown()
        return
      }

      // COMMITTED drop. HMR reuses these DOM nodes and reconciles them POSITIONALLY:
      // the content is rewritten IN PLACE, the nodes don't move. That's the whole
      // subtlety — our transforms are pinned to nodes, so:
      //   • held (pre-swap content) → transforms show the FINAL order. good.
      //   • the instant content swaps, the SAME transforms show the ORIGINAL order.
      // So clearing the transforms must happen in the EXACT frame the content swaps,
      // or there's a beat of original-order (the "fakeout"). A timer always lands on
      // the wrong side of the swap; a MutationObserver fires after the DOM mutation
      // but before paint, making swap+clear atomic → the swap is invisible.
      //
      // We first set the dropped element DOWN into its destination slot (eased), so
      // during the hold it visibly settles into the gap the siblings already opened.
      const { frozen, prevStyle, sibPrev, members } = p
      setDrop(null)
      press.current = null // drag is over; saved styles captured in locals above
      if (frozen && prevStyle) {
        // Measure the REAL post-reorder layout (ghost move) and hold THAT, so clearing the
        // transforms on the repaint is a visual no-op even on non-uniform content — no snap.
        // Falls back to the uniform-extent approximation if the measure can't run.
        // MUST run BEFORE the MutationObserver below is wired: the ghost move mutates the
        // parent's childList twice (and reverts), which would otherwise trip clearTransforms.
        const measured = measureReorderDisplacements(parent, node, frozen, members, target.toIndex)
        landToDestination(node, frozen, p.fromIndex, target.toIndex, prevStyle, measured?.dragged)
        // SNAP the made-room siblings to their EXACT measured positions (don't ease). With the
        // local-gap make-room (freezeSiblings) the siblings the dragged element PASSES are
        // already exact during the drag, so their correction here is 0. What remains is the
        // MARGIN-COLLAPSE residual on the siblings AFTER the drop target — which no analytic
        // make-room can predict — and easing it reads as a post-drop settle of the surrounding
        // content. So suppress the transition, set the exact transforms, force ONE reflow on a
        // connected node to commit them instantly, then RESTORE each node's transition: never
        // leave `transition:none` on a host element, or a delayed clear (unmount / onReorder
        // error → the 2.5s safety) would suppress the host app's own transitions until then.
        // The transform is already committed, so restoring the transition can't re-animate it.
        // The dragged node still EASES its set-down (landToDestination) — that motion is intended.
        if (measured && sibPrev) {
          for (const n of frozen.nodes) n.style.transition = 'none'
          for (let i = 0; i < frozen.nodes.length; i++) {
            const d = measured.others[i]
            frozen.nodes[i].style.transform = d === 0 ? '' : frozen.layout.vertical ? `translateY(${d}px)` : `translateX(${d}px)`
          }
          const anchor = frozen.nodes.find((n) => n.isConnected)
          if (anchor) void anchor.offsetWidth // single reflow commits the snap for the whole subtree
          for (const n of frozen.nodes) n.style.transition = sibPrev.get(n)?.transition ?? '' // un-strand
        }
      }

      // TWO separate moments, deliberately NOT merged:
      //
      // (1) CLEAR TRANSFORMS — must happen in the exact frame the content swaps, or
      //     the held transforms briefly show the original order (the fakeout). The
      //     MutationObserver on the container is the SOLE driver (fires after the DOM
      //     mutation, before paint → swap + clear are atomic). It is deliberately NOT
      //     also cleared from onReorder's finally: on a host whose repaint is decoupled
      //     from the write (Next/Turbopack RSC, which refreshes on its own slower clock),
      //     onReorder can resolve BEFORE the swap, and an early clear there would snap the
      //     element back to its old slot — the exact fakeout we're avoiding. The held
      //     destination transform shows the correct final position until the real swap.
      let cleared = false
      const clearTransforms = () => {
        if (cleared) return
        cleared = true
        obs.disconnect()
        window.clearTimeout(safety)
        if (prevStyle && node.isConnected) restoreLift(node, prevStyle) // transform/shadow/z/…
        if (sibPrev) restoreMakeRoom(sibPrev) // sibling transforms — same frame as the swap
      }
      const obs = new MutationObserver(clearTransforms)
      obs.observe(parent, { childList: true, subtree: true, characterData: true })
      // Strand-guard if no mutation ever fires. Sized for a slow, write-decoupled RSC refresh
      // (not just Vite HMR), so it can't pre-empt a late-but-real swap; the observer resolves
      // earlier whenever the swap actually lands.
      const safety = window.setTimeout(clearTransforms, SETTLE_CAP_MS)

      // (2) UN-HIDE THE CHROME — must wait for the RE-SELECT, not the content swap.
      //     HMR reuses nodes positionally, so right after the swap `selected` still
      //     points at the dragged element's ORIGINAL physical node, now showing the
      //     other element's content at the old slot. Un-hiding then would flash the
      //     chrome at the old location before commitReorder's re-select moves it.
      //     onReorder now resolves only AFTER the parent's real repaint + re-select
      //     (it awaits the same mutation, host-agnostically), so un-hide in its finally —
      //     the chrome fades back in already anchored to the new location. Clearing the
      //     transforms is left entirely to the observer above (see note there).
      void onReorderRef.current(target.toIndex).finally(() => {
        onDragChangeRef.current?.(false)
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
  s.zIndex = '999990' // above peers, below Muse's overlay chrome
  s.cursor = 'grabbing'
  s.willChange = 'transform'
  // Ease the DEPTH cues (shadow + fade) in over LIFT_MS so the element reads as
  // lifting OFF the surface instead of popping — but transform is NOT in the
  // transition list, so per-frame cursor-follow stays 1:1 with zero lag. (Reduced
  // motion: no transition; the cues just appear.)
  s.transition = prefersReducedMotion() ? 'none' : `box-shadow ${LIFT_MS}ms ${EASE_OUT}, opacity ${LIFT_MS}ms ${EASE_OUT}`
  // Set the eased target props on the next frame so the transition has a from→to to
  // animate (setting them in the same frame as the transition would snap).
  requestAnimationFrame(() => {
    if (node.style.zIndex !== '999990') return // lift was already torn down
    // Neutral elevation, NOT an accent ring: the selected element already wears the
    // accent selection ring (BoxModelOverlay), so the lift signals depth (shadow +
    // raised layer + scale) while accent stays the language of selection + the drop
    // bar — three roles, two visual cues, no accent-halo collision.
    node.style.boxShadow = '0 12px 28px -6px rgb(0 0 0 / 0.45), 0 2px 6px -2px rgb(0 0 0 / 0.3)'
    node.style.opacity = '0.95'
  })
  return prev
}

// Honor the OS reduce-motion setting for the lift's movement cues (scale + follow).
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function restoreLift(node: HTMLElement, prev: SavedStyle) {
  const s = node.style
  // Snap the transform back with NO transition, THEN restore the saved transition.
  // Otherwise an element whose CSS class sets `transition: transform` (Tailwind's
  // `transition` utility includes transform — buttons carry it for hover) animates
  // the cleared transform back to rest, sliding the dropped element into place after
  // the drop (the reorder "replay", most visible on a far-traveling drag like a
  // button swap). The forced reflow commits the snap before the transition returns.
  s.transition = 'none'
  s.transform = prev.transform
  s.boxShadow = prev.boxShadow
  s.zIndex = prev.zIndex
  s.opacity = prev.opacity
  s.cursor = prev.cursor
  s.willChange = prev.willChange
  void node.offsetWidth // force reflow so the cleared transform paints with no transition
  s.transition = prev.transition
}

// FALLBACK approximation (the primary path is measureReorderDisplacements' ghost measure;
// this runs only when that can't). The dragged node's destination offset along the layout
// axis: how far to translate it so its CONTENT visually lands in the slot it'll occupy after
// the reorder. Built from the frozen ORIGINAL screen-slot positions — which is only EXACT on
// near-uniform lists (it eases to a frozen sibling's leading edge, off by the difference when
// intervening elements have a different extent, and ignores margin-collapse). The measured
// path replaces it precisely; this keeps a sane landing when the measure bails.
function destOffset(frozen: Frozen, fromIndex: number, toIndex: number): number {
  const { rects, layout, draggedRect } = frozen
  const newIndex = toIndex > fromIndex ? toIndex - 1 : toIndex // dragged's final index among all N
  const lead = (r: DOMRect) => (layout.vertical ? r.top : r.left)
  // Leading edge of the ORIGINAL element at screen-slot newIndex: others[k] for
  // k<fromIndex, the dragged box at k===fromIndex (noop, filtered), else others[k-1].
  const leadingAt =
    newIndex < fromIndex ? lead(rects[newIndex]) : newIndex === fromIndex ? lead(draggedRect) : lead(rects[newIndex - 1])
  return leadingAt - lead(draggedRect)
}

// Set the dropped element DOWN into its destination slot (not its origin): drop the
// scale, ease the follow-transform to the destination offset, fade the shadow out —
// a soft "click into the gap." The made-room siblings are already at their final
// positions, so the whole arrangement now equals the post-reorder layout, held until
// the content swaps. Reduced-motion never lifted/made-room, so it no-ops. `measuredOff`,
// when supplied, is the EXACT post-reorder displacement (from a ghost measure) and is used
// in place of the uniform-extent `destOffset` approximation — which lands non-uniform
// content (a tall embed among short paragraphs) far off the real spot, causing a snap when
// the transforms clear on repaint.
function landToDestination(node: HTMLElement, frozen: Frozen, fromIndex: number, toIndex: number, prev: SavedStyle, measuredOff?: number) {
  if (!node.isConnected || prefersReducedMotion()) return
  const off = measuredOff ?? destOffset(frozen, fromIndex, toIndex)
  const s = node.style
  s.transition = `transform ${SLIDE_MS}ms ${EASE_OUT}, box-shadow ${SLIDE_MS}ms ${EASE_OUT}, opacity ${SLIDE_MS}ms ${EASE_OUT}`
  s.transform = off === 0 ? prev.transform : frozen.layout.vertical ? `translateY(${off}px)` : `translateX(${off}px)`
  s.boxShadow = prev.boxShadow
  s.opacity = prev.opacity
}

// Measure the EXACT post-reorder geometry by performing the reorder in the DOM (a "ghost"
// move), reading the reflowed positions, then moving the node back — all SYNCHRONOUSLY, so
// the browser never paints the intermediate state (getBoundingClientRect/offsetWidth force
// layout, not paint). This replaces the uniform-extent approximation (destOffset +
// applyMakeRoom's single step + median gap), which is only correct on near-uniform lists:
// with a tall embed among short paragraphs the held arrangement lands far off the real
// layout (margin-collapse + size mismatch), and the gap shows as a snap the instant the
// transforms clear on repaint. Returns per-element axis displacements (the dragged node +
// each frozen sibling, index-aligned to frozen.nodes), or null if it can't measure cleanly
// (caller falls back to the approximation). Transforms are cleared for the read and restored
// after, so there is no visual change once it returns.
function measureReorderDisplacements(
  parent: HTMLElement,
  node: HTMLElement,
  frozen: Frozen,
  members: HTMLElement[],
  toIndex: number,
): { dragged: number; others: number[] } | null {
  if (!node.isConnected || node.parentElement !== parent) return null
  const ref = members[toIndex] ?? null // the member to land BEFORE (null = end); see spliceReorder
  // `ref` must be a live child of `parent`, else insertBefore throws. `members` was captured at
  // pickup, so on a host that re-rendered mid-drag (RSC replacing the subtree) the target can be
  // stale/detached — bail to the approximation rather than risk a throw mid-mutation.
  if (ref === node || (ref !== null && ref.parentNode !== parent)) return null
  const lead = (r: DOMRect) => (frozen.layout.vertical ? r.top : r.left)
  // Save every member's live transform; the read needs PURE LAYOUT (no drag follow / make-room
  // offsets). The DOM move + the cleared transforms are reverted in `finally` so that even a
  // throw mid-measure can't strand the host with a displaced node or cleared transforms (which
  // — with press.current already nulled upstream — would leave the element permanently lifted).
  const savedNode = node.style.transform
  const savedOthers = frozen.nodes.map((n) => n.style.transform)
  const back = node.nextSibling // restore point, captured before any move
  let moved = false
  try {
    node.style.transform = 'none'
    frozen.nodes.forEach((n) => (n.style.transform = 'none'))
    void parent.offsetWidth // reflow with transforms cleared → fresh "before" layout
    const beforeNode = lead(node.getBoundingClientRect())
    const beforeOthers = frozen.nodes.map((n) => lead(n.getBoundingClientRect()))
    // Ghost-reorder: move to the target, reflow, read the TRUE post-reorder positions.
    // React never sees it (direct DOM, reverted synchronously below — no paint in between).
    parent.insertBefore(node, ref)
    moved = true
    void parent.offsetWidth
    const dragged = lead(node.getBoundingClientRect()) - beforeNode
    const others = frozen.nodes.map((n, i) => lead(n.getBoundingClientRect()) - beforeOthers[i])
    return { dragged, others }
  } catch {
    return null // fall back to the approximation; `finally` still restores DOM + transforms
  } finally {
    // Revert the ghost move. `back` is `node`'s original nextSibling — a live child of `parent`
    // (or null = end), because the measure is fully SYNCHRONOUS so no host mutation can interleave
    // mid-revert. Guarded + try-wrapped anyway so the revert can NEVER throw and strand `node` at
    // the ghost slot (this is the user's LIVE DOM), and so the transform restore below always runs.
    if (moved) {
      try {
        if (back === null || back.parentNode === parent) parent.insertBefore(node, back)
        else parent.appendChild(node) // defensive: `back` gone — re-attach in-parent (self-heals on render)
      } catch {
        /* practically unreachable (synchronous) — leave it to the next host render to reconcile */
      }
    }
    node.style.transform = savedNode
    frozen.nodes.forEach((n, i) => (n.style.transform = savedOthers[i]))
  }
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
//  • draggedRect — the dragged element's own rect; the make-room step = its extent + `gap`.
//  • gap — the layout gap LOCAL to the dragged element (to its adjacent sibling), NOT a median
//    over all siblings: the siblings all shuffle past the one dragged element, so they shift by
//    ITS footprint. The median mis-fits non-uniform content (a tall embed skews it).
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

// The parent's visible children that are IN FLOW (excludes position:absolute/fixed —
// out-of-flow nodes overlap the flow run and would corrupt the nearest-neighbour drop
// search). Used to build the self-anchor member set.
function inFlowChildren(parent: HTMLElement): HTMLElement[] {
  return movableSiblings(parent).filter((c) => {
    const pos = getComputedStyle(c).position
    return pos !== 'absolute' && pos !== 'fixed'
  })
}

// SELF-ANCHOR: reconcile the parent's in-flow children to the engine's source-child run
// (the probe's `children` key-list, in source order). The parent here is a component-internal
// host (e.g. Section's <motion.div>) that may INJECT its own nodes (a `<p class="section-label">`)
// beside the projected source children, so a raw child list mis-counts / mis-indexes.
//
// The injected node can't be told apart by tag (it shares the tag) OR by className (real content
// is often `style={obj}` with NO className, and a real child's live className can diverge from its
// authored one). The robust signal is the SOURCE FILE: a self-anchor source child is authored at
// the USAGE site, so its `data-muse-loc` file equals the dragged element's file; a component-
// injected node is authored in the COMPONENT file → a different file. So we keep only in-flow
// children stamped to `anchorFile` (the dragged element's file). This drops the injected label
// regardless of its className/count, and keeps style-object AND dynamic-className content alike.
// Then the remainder must be 1:1 with the keys, same tags in source order (DOM order === source
// order is the reorder invariant). Returns the run, or null (caller fails closed — no drag) on any
// unreconcilable divergence, rather than risk moving the wrong element. (A same-file inline
// injecting component can't be separated this way → it fails closed, which is safe.)
function matchMovableMembers(parent: HTMLElement, sourceKeys: ReorderChild[], anchorFile: string | null): HTMLElement[] | null {
  const kids = inFlowChildren(parent)
  // Without a file to anchor on we can't tell injected from real → only the clean no-injection
  // case (exact count) is safe; anything else fails closed below.
  const run = anchorFile ? kids.filter((c) => getSourceLocation(c)?.fileName === anchorFile) : kids
  if (run.length !== sourceKeys.length) return null // injected/hidden/foreign node → fail closed
  for (let i = 0; i < run.length; i++) {
    if (run[i].tagName.toLowerCase() !== sourceKeys[i].tag) return null // tag drift → fail closed
  }
  return run
}

// The movable sibling run in source order: matched members for self-anchor (sourceKeys
// present), else every visible child (the proven raw path). [] when matching diverges.
// `anchorNode` is the dragged/selected element — its source file anchors the self-anchor
// member match (injected nodes live in a different file). Exported so the client's keyboard
// reorder + post-commit re-select read the SAME run.
export function resolveMembers(
  parent: HTMLElement,
  sourceKeys: ReorderChild[] | null | undefined,
  anchorNode?: HTMLElement | null,
): HTMLElement[] {
  if (sourceKeys && sourceKeys.length) {
    const anchorFile = anchorNode ? getSourceLocation(anchorNode)?.fileName ?? null : null
    return matchMovableMembers(parent, sourceKeys, anchorFile) ?? []
  }
  return movableSiblings(parent)
}

// Snapshot at pickup: the OTHER siblings (nodes + rects, dragged excluded), the
// dragged element's own rect, the inter-sibling gap, the axis, and whether this is
// a genuine single line (so make-room is geometrically valid). `all` is the movable
// run (matched members or raw), computed once at press start and passed in so the
// geometry reads the same set the drag index was derived from.
function freezeSiblings(parent: HTMLElement, all: HTMLElement[], dragged: HTMLElement): Frozen {
  const layout = readLayout(parent)
  const draggedRect = dragged.getBoundingClientRect()
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

  // make-room slides every sibling by the DRAGGED element's FOOTPRINT (its extent + the gap
  // adjacent to it) — they all shuffle PAST the one dragged element, so they shift by ITS
  // footprint, not by some average sibling spacing. Earlier this used the MEDIAN inter-sibling
  // gap, which is the wrong proxy on non-uniform content: a tall embed's large margins skew the
  // median away from the dragged paragraph's own gap, so the slide overshoots — then #91's exact
  // on-drop measure eases the difference, reading as a ~`median − localGap`px settle of the
  // surrounding content. Use the dragged element's local gap (below it, or above if it's last)
  // so the drag-time slide already matches the real reflow and there's nothing left to ease.
  let gap = 0
  const di = all.indexOf(dragged) // index-aligned with allRects
  if (di >= 0) {
    const lead = (r: DOMRect) => (layout.vertical ? r.top : r.left)
    const tail = (r: DOMRect) => (layout.vertical ? r.bottom : r.right)
    if (di + 1 < allRects.length) gap = lead(allRects[di + 1]) - tail(allRects[di]) // gap below
    else if (di - 1 >= 0) gap = lead(allRects[di]) - tail(allRects[di - 1]) // gap above (dragged is last)
    gap = Math.max(0, gap)
  }

  return { nodes, rects, layout, draggedRect, gap, oneAxis }
}

// Map a position to an insertion slot among the FROZEN (other) siblings: nearest
// neighbor by center distance (handles 2D), then leading/trailing edge along the
// reading axis. `slot` is an index in OTHER-sibling space (0..others); lift it back
// into full source order using `fromIndex` (the dragged node's slot). NB: (px,py) is
// the dragged element's projected MIDPOINT (see dropPoint), not the raw cursor — so
// the swap fires when the card's center crosses a neighbor's center, regardless of
// where on the card it was grabbed (a cursor-only rule felt stuck over tall neighbors).
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

// The project's one motion curve (EASE.out, tailwind.config.js / Decision #21) —
// mirrored here because these are imperative inline-style transitions, not classes.
// Keep in sync with the token; do not invent a second curve.
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const SLIDE_MS = 160 // DUR.base — make-room slide + landing set-down (<300ms easeOut)
const LIFT_MS = 140 // pickup depth cue (shadow + fade) easing in

// Save each sibling's inline transition/transform and prime the transition so the
// per-move shifts animate instead of snapping. Returns the saved map for restore.
function primeMakeRoom(frozen: Frozen): Map<HTMLElement, { transition: string; transform: string }> {
  const saved = new Map<HTMLElement, { transition: string; transform: string }>()
  for (const n of frozen.nodes) {
    saved.set(n, { transition: n.style.transition, transform: n.style.transform })
    n.style.transition = `transform ${SLIDE_MS}ms ${EASE_OUT}`
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

// Make-room driven by the EXACT post-reorder geometry (ghost measure) instead of the analytic
// uniform-step applyMakeRoom: slides each sibling to its REAL position for the hovered slot, so
// the held drop arrangement equals the real layout and nothing settles afterward (margin-collapse
// included — which no analytic step can model). The measure (~1ms) runs only on a slot-CHANGE and
// is cached per `toIndex`, so re-hovering a slot is free; the cost is a few sub-ms reflows per
// user-paced drag, not per frame. Falls back to applyMakeRoom for a pathologically large group
// (guard) or if a measure can't run (e.g. a stale target after a mid-drag host re-render).
function exactMakeRoom(
  parent: HTMLElement,
  node: HTMLElement,
  frozen: Frozen,
  members: HTMLElement[],
  toIndex: number,
  slot: number,
  fromIndex: number,
  cache: Map<number, number[]>,
) {
  if (members.length > MAX_MEASURE_MEMBERS) return applyMakeRoom(frozen, slot, fromIndex)
  let disps = cache.get(toIndex)
  if (!disps) {
    const m = measureReorderDisplacements(parent, node, frozen, members, toIndex)
    if (!m) return applyMakeRoom(frozen, slot, fromIndex) // measure bailed → analytic fallback
    disps = m.others
    cache.set(toIndex, disps)
  }
  for (let i = 0; i < frozen.nodes.length; i++) {
    const d = disps[i]
    frozen.nodes[i].style.transform = d === 0 ? '' : frozen.layout.vertical ? `translateY(${d}px)` : `translateX(${d}px)`
  }
}

function restoreMakeRoom(saved: Map<HTMLElement, { transition: string; transform: string }>) {
  // Same snap as restoreLift: clear each sibling's make-room transform with the
  // transition suppressed so a class-level `transition: transform` can't animate
  // them back into place on drop. One reflow commits all the snaps, then the saved
  // transitions are restored. (The during-drag make-room slide is unaffected — it
  // runs off the inline transition primeMakeRoom sets; this is only the clear.)
  for (const [n, prev] of saved) {
    if (!n.isConnected) continue
    n.style.transition = 'none'
    n.style.transform = prev.transform
    n.style.willChange = ''
  }
  for (const n of saved.keys()) {
    if (n.isConnected) {
      void n.offsetWidth // single forced reflow commits the snapped transforms
      break
    }
  }
  for (const [n, prev] of saved) {
    if (n.isConnected) n.style.transition = prev.transition
  }
}
