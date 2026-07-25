import { useCallback, useEffect, useRef, useState } from 'react'
import { getElementInfo, getSourceLocation, type ElementInfo } from './sourceLocation'
import type { CanvasElement, Rect, SelectedElement } from './types'

// How many Canvas instances are currently active. Module-level so the
// `data-muse-active` marker survives one overlay closing while another is still
// open — see the effect that maintains it.
let activeInstances = 0

function isMuseUI(el: Element | null): boolean {
  if (!el) return false
  // Dogfooding escape hatch: a `[data-muse-canvas-host]` region is selectable even
  // though it carries `data-muse-ui` (which it needs only to resolve Muse's scoped
  // CSS tokens — e.g. the gallery's preview frames). Production host apps never set
  // this attribute, so the normal "skip Muse's own overlay chrome" guard below is
  // unchanged there.
  if (el.closest('[data-muse-canvas-host]')) return false
  return !!el.closest('[data-muse-ui]')
}

// Resolve a DOM node to an editable Canvas target. Returns null when the node has
// no React source (can't be mapped to a file) — those can be highlighted but not
// edited. SVG: the <svg> ROOT is admitted (a JSX-authored root carries the same
// data-muse-loc stamp as any element; icon recolor/resize is the ask) — inner
// shapes are not, so a click on a <path> walks up to the root via canvasChain.
function toCanvas(el: Element): CanvasElement | null {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGSVGElement)) return null
  const loc = getSourceLocation(el)
  if (!loc || !loc.fileName) return null
  const tag = el.tagName.toLowerCase()
  return {
    fileName: loc.fileName,
    line: loc.lineNumber,
    column: loc.columnNumber,
    tag,
    key: `${loc.fileName}:${loc.lineNumber}:${loc.columnNumber}:${tag}`,
    node: el,
  }
}

// The mappable ancestor chain for a node, leaf-first → root-last. Each entry
// carries its OWN node's source location (so the engine locates that element, not
// the leaf). Consecutive duplicates collapse (a wrapper that resolves to the same
// _debugSource as its child). Used both to pick a click target and to render the
// breadcrumb so any container is one click away.
export function canvasChain(el: Element): CanvasElement[] {
  const out: CanvasElement[] = []
  // Any Element walks (an inner SVG shape resolves to its <svg> root ancestor —
  // toCanvas filters what's actually selectable).
  let cur: Element | null = el
  while (cur && !isMuseUI(cur) && cur !== document.body && cur !== document.documentElement) {
    const c = toCanvas(cur)
    if (c && (out.length === 0 || out[out.length - 1].key !== c.key)) out.push(c)
    cur = cur.parentElement
  }
  return out
}

// Widen a CanvasElement into a SelectedElement — it carries classNames + a text
// snippet. Used to build history entries (the elements an edit re-selects on undo).
export function asSelected(el: CanvasElement): SelectedElement {
  return {
    fileName: el.fileName,
    line: el.line,
    tag: el.tag,
    classNames: el.node.getAttribute('class') ?? '',
    text: (el.node.textContent ?? '').trim().slice(0, 80),
    key: el.key,
    node: el.node,
  }
}

/**
 * Drives Canvas Mode's element picking — the direct-manipulation cousin of
 * useSelection.
 *
 * Selection model (Figma/devtools-familiar, tuned for deep component DOMs):
 * - Click selects exactly what you point at (the leaf under the cursor). Clicking
 *   a child of the current target naturally drills in; clicking a sibling/anything
 *   else retargets — so there's never a stranded second selection.
 * - Alt-click steps OUT to the parent (grab the container around what you clicked).
 * - The panel breadcrumb jumps to any ancestor directly.
 * - Esc deselects, then exits.
 *
 * Selection is "locked" for hover: once something is selected, hovering it (or its
 * descendants, or Muse's own chrome) no longer flickers the hover highlight —
 * only hovering a *different* element highlights, for retargeting. The global
 * capture-phase listeners stay attached across selection (re-subscribing on every
 * selection would drop a frame and flicker); locking is a guard, not a re-sub.
 */
export function useCanvasMode(opts?: {
  suspended?: boolean
  // Shift-click hands the clicked element off to a flag instead of selecting it (the
  // overflow valve — annotate intent in place for the user's own agent). Read via a
  // ref so the listener effect doesn't re-subscribe when the callback identity changes.
  onFlag?: (el: CanvasElement, at: { x: number; y: number }) => void
}) {
  const [active, setActive] = useState(false)
  const onFlagRef = useRef(opts?.onFlag)
  onFlagRef.current = opts?.onFlag
  // While a reorder drag is in flight the parent sets `suspended` — Canvas stands
  // down (no hover, no select/drill, no dblclick) so dragging the cursor across other
  // elements can't re-hover or re-select them mid-drag. A mid-drag selection change
  // would remount ReorderOverlay on a new node and abort the drag (and the passed-over
  // element would stay un-passable until reselected). Read via a ref so the listener
  // effect doesn't re-subscribe each time the flag flips.
  const suspendedRef = useRef(opts?.suspended)
  suspendedRef.current = opts?.suspended
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  const [hoverInfo, setHoverInfo] = useState<ElementInfo | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<CanvasElement | null>(null)
  // True while Shift is held — surfaces the "shift-click to flag" affordance (the
  // gesture is otherwise undiscoverable). Reset on keyup / blur / leaving canvas.
  const [shiftHeld, setShiftHeld] = useState(false)
  // True while Alt is held — with a selection, hover becomes the measurement
  // overlay (distance readouts to the hovered element). Hover-only: Alt-CLICK
  // still steps out to the parent, untouched. Same reset discipline as Shift.
  const [altHeld, setAltHeld] = useState(false)
  // A click that couldn't be mapped to source (no _debugSource — a non-React node,
  // an SVG, etc.). Surfaced so the UI can show a quiet "can't edit this" hint
  // instead of silently doing nothing. `id` makes each miss distinct so a repeat
  // click on the same spot re-triggers the hint.
  const [miss, setMiss] = useState<{ x: number; y: number; id: number } | null>(null)
  const missId = useRef(0)
  // Read inside the listener effect via a ref so the effect only re-subscribes on
  // `active` (like useSelection) — re-attaching on every selection would leave a
  // frame with no mousemove listener and flicker the hover highlight.
  const selectedRef = useRef<CanvasElement | null>(selected)
  selectedRef.current = selected
  // The element being text-edited (double-click). While set, Canvas's own
  // capture-phase handlers stand down so the contentEditable caret/typing works.
  const [editing, setEditing] = useState<CanvasElement | null>(null)
  const editingRef = useRef<CanvasElement | null>(editing)
  editingRef.current = editing

  const clearSelected = useCallback(() => setSelected(null), [])
  const exitEditing = useCallback(() => setEditing(null), [])
  // Select a specific element (a click, a breadcrumb crumb, or a programmatic
  // retarget). The properties card reveals beside it.
  const selectElement = useCallback((c: CanvasElement) => {
    setSelected(c)
    setHoverRect(null)
    setHoverInfo(null)
  }, [])

  // Tell the HOST that Canvas is on, so it can stand down its own pointer UI.
  //
  // Muse had no document-level signal at all, so a host with a custom cursor,
  // command palette, or global hotkeys had no way to scope them to "Muse is idle".
  // Portfolio v2 ships a cursor that sets `!cursor-none` on <html> (replacing the
  // native one) plus a spring-lagged ring and a 46px hover state — all three fight
  // Canvas: the ring trails the true pointer through a gap drag, and the hover
  // state covers the element you're trying to select. The only workaround was
  // blanket-disabling the cursor for the whole route.
  //
  // Presence IS the contract — no value, no states. It is a public host-integration
  // API; docs/HOSTING.md is its spec. Hosts scope with `html:not([data-muse-active])`.
  //
  // Deliberately NOT gated on the demo modes. The live case study is ephemeral, and
  // that is the only place this has actually been reported — gating it on a real
  // backend would miss the whole reported case.
  //
  // REFCOUNTED, because a bare set/remove is wrong the moment a host mounts two
  // overlays: the first one to close would removeAttribute while the second is
  // still active, silently handing the host its cursor back mid-session — exactly
  // the failure this attribute exists to prevent. That is not hypothetical here;
  // Portfolio v2 ran two overlay instances in dev, which is why its MUSE_DEMO=off
  // toggle exists. The count is module-level so every instance shares it.
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    if (++activeInstances === 1) root.setAttribute('data-muse-active', '')
    // Runs when Canvas closes AND on unmount, so the host is never left stood down.
    return () => {
      if (--activeInstances <= 0) {
        activeInstances = 0 // never go negative if cleanups ever double-fire
        root.removeAttribute('data-muse-active')
      }
    }
  }, [active])

  useEffect(() => {
    if (!active) {
      setHoverRect(null)
      setHoverInfo(null)
      setCursor(null)
      setShiftHeld(false)
      setAltHeld(false)
      return
    }

    const onMove = (e: MouseEvent) => {
      if (editingRef.current || suspendedRef.current) return // typing or mid-drag — leave the page alone
      setCursor({ x: e.clientX, y: e.clientY })
      const el = e.target as Element | null
      const sel = selectedRef.current
      // Lock: don't churn the hover highlight over the active target (or its
      // descendants, or Muse's own chrome). Hovering a *different* element still
      // highlights so you can retarget.
      if (!el || isMuseUI(el) || (sel && sel.node.contains(el))) {
        setHoverRect(null)
        setHoverInfo(null)
        return
      }
      const r = el.getBoundingClientRect()
      setHoverRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      setHoverInfo(getElementInfo(el))
    }

    const onClick = (e: MouseEvent) => {
      // While editing text, let clicks through untouched (native caret placement);
      // clicking away just blurs+commits the editor (handled on the node). While a
      // reorder drag is in flight, ignore clicks so the trailing drop-click (or any
      // stray click) can't change the selection out from under the drag.
      if (editingRef.current || suspendedRef.current) return
      const el = e.target as Element | null
      if (!el || isMuseUI(el)) return // let the controls popover handle its own clicks
      e.preventDefault()
      e.stopPropagation()
      // Any Element starts the walk — an inner SVG shape climbs to its <svg> root.
      const chain = canvasChain(el)
      if (chain.length === 0) {
        // Mappable-looking click that has no source — tell the user why nothing happened.
        setMiss({ x: e.clientX, y: e.clientY, id: ++missId.current })
        return
      }
      const leaf = chain[0]
      // Shift-click → drop a flag on the clicked element (don't select/drill). Takes
      // precedence over Alt so the gesture is unambiguous.
      if (e.shiftKey && onFlagRef.current) {
        onFlagRef.current(leaf, { x: e.clientX, y: e.clientY })
        return
      }
      let picked = leaf
      if (e.altKey) {
        // Step OUT to the parent of what's under the cursor (or of the current
        // selection, if we Alt-clicked back inside it).
        const sel = selectedRef.current
        const anchor = sel && chain.some((c) => c.key === sel.key) ? sel : leaf
        const idx = chain.findIndex((c) => c.key === anchor.key)
        picked = chain[idx + 1] ?? anchor
      }
      selectElement(picked)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true)
      if (e.key === 'Alt') setAltHeld(true)
      if (editingRef.current) return // the editor owns the keyboard (Enter/Esc handled on the node)
      if (e.key === 'Escape') {
        // Escape pressed in a Muse TEXT-ENTRY control belongs to that control —
        // a ScrubField cancels its typed value, the class input clears, a color
        // field reverts. This listener is capture-phase on document, so it fires
        // BEFORE those field handlers (their stopPropagation can't reach us);
        // skip here or the whole element deselects mid-edit. Scoped to entry
        // controls only: on a plain panel button (breadcrumb, chevron) nothing
        // owns Escape, so it must keep meaning deselect. composedPath()[0] sees
        // the real target inside the (open) shadow root — e.target is retargeted
        // to the shadow host at the boundary, which carries no data-muse-ui.
        const inner = (e.composedPath?.()[0] ?? e.target) as Element | null
        if (
          inner instanceof Element &&
          isMuseUI(inner) &&
          inner.closest('input, textarea, select, [contenteditable]')
        )
          return
        // Esc steps back: a selected element first, then canvas mode itself.
        if (selectedRef.current) setSelected(null)
        else setActive(false)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false)
      if (e.key === 'Alt') setAltHeld(false)
    }
    const onBlur = () => {
      setShiftHeld(false)
      setAltHeld(false)
    }

    // Double-click an element → enter text edit on it (CanvasMode gates on whether
    // it actually renders editable text, so a double-click on a non-text element is
    // a no-op). The dblclick's own first click has already selected it.
    const onDblClick = (e: MouseEvent) => {
      if (editingRef.current || suspendedRef.current) return // already editing or mid-drag — don't start a session
      const el = e.target as Element | null
      if (!el || isMuseUI(el) || !(el instanceof HTMLElement)) return
      const leaf = canvasChain(el)[0]
      if (!leaf) return
      e.preventDefault()
      e.stopPropagation()
      setEditing(leaf)
    }

    // Suppress the browser's native HTML5 drag while Canvas is active. Links and
    // images are `draggable` by default, so pressing one to reorder it starts a
    // native link/image drag (the URL ghost) that hijacks the pointer-based
    // reorder — you'd pick up the <a> instead of moving the element. Killing
    // dragstart at the capture phase lets the reorder's pointer drag own the
    // gesture. Stand down while editing text so in-field text drag still works.
    const onDragStart = (e: DragEvent) => {
      if (editingRef.current) return
      e.preventDefault()
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onDblClick, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('dragstart', onDragStart, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDblClick, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('dragstart', onDragStart, true)
    }
  }, [active, selectElement])

  return { active, setActive, hoverRect, hoverInfo, cursor, selected, setSelected, selectElement, clearSelected, editing, exitEditing, miss, shiftHeld, altHeld }
}
