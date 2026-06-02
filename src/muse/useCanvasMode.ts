import { useCallback, useEffect, useRef, useState } from 'react'
import { getElementInfo, getSourceLocation, type ElementInfo } from './sourceLocation'
import type { CanvasElement, Rect, SelectedElement } from './types'

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
// edited.
function toCanvas(el: Element): CanvasElement | null {
  if (!(el instanceof HTMLElement)) return null
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
  let cur: Element | null = el instanceof HTMLElement ? el : null
  while (cur && !isMuseUI(cur) && cur !== document.body && cur !== document.documentElement) {
    const c = toCanvas(cur)
    if (c && (out.length === 0 || out[out.length - 1].key !== c.key)) out.push(c)
    cur = cur.parentElement
  }
  return out
}

// Widen a CanvasElement into the SelectedElement the agent/chat side speaks — it
// carries classNames + a text snippet the observe call reads. Used when a
// Shift-click hands the canvas target over to the agent, and for history entries.
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
export function useCanvasMode(opts?: { onEscalate?: (el: SelectedElement) => void }) {
  const [active, setActive] = useState(false)
  // Read inside the click listener via a ref so the listener effect doesn't
  // re-subscribe when the parent passes a fresh callback each render.
  const onEscalateRef = useRef(opts?.onEscalate)
  onEscalateRef.current = opts?.onEscalate
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  const [hoverInfo, setHoverInfo] = useState<ElementInfo | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<CanvasElement | null>(null)
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
  // Select a specific element (breadcrumb crumb, or a programmatic retarget).
  const selectElement = useCallback((c: CanvasElement) => {
    setSelected(c)
    setHoverRect(null)
    setHoverInfo(null)
  }, [])

  useEffect(() => {
    if (!active) {
      setHoverRect(null)
      setHoverInfo(null)
      setCursor(null)
      return
    }

    const onMove = (e: MouseEvent) => {
      if (editingRef.current) return // typing — leave the page alone
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
      // clicking away just blurs+commits the editor (handled on the node).
      if (editingRef.current) return
      const el = e.target as Element | null
      if (!el || isMuseUI(el)) return // let the controls popover handle its own clicks
      e.preventDefault()
      e.stopPropagation()
      const chain = el instanceof HTMLElement ? canvasChain(el) : []
      if (chain.length === 0) {
        // Mappable-looking click that has no source — tell the user why nothing happened.
        setMiss({ x: e.clientX, y: e.clientY, id: ++missId.current })
        return
      }
      const leaf = chain[0]
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
      // Shift escalates the picked element to the agent — the intentional gesture,
      // and the ONLY thing that fires an observe call. Composes with Alt (Shift+Alt
      // escalates the parent). Plain clicks stay canvas-only and never reach the agent.
      if (e.shiftKey) onEscalateRef.current?.(asSelected(picked))
    }

    const onKey = (e: KeyboardEvent) => {
      if (editingRef.current) return // the editor owns the keyboard (Enter/Esc handled on the node)
      if (e.key === 'Escape') {
        // Esc steps back: a selected element first, then canvas mode itself.
        if (selectedRef.current) setSelected(null)
        else setActive(false)
      }
    }

    // Double-click an element → enter text edit on it (CanvasMode gates on whether
    // it actually renders editable text, so a double-click on a non-text element is
    // a no-op). The dblclick's own first click has already selected it.
    const onDblClick = (e: MouseEvent) => {
      if (editingRef.current) return // already editing — don't start a second session
      const el = e.target as Element | null
      if (!el || isMuseUI(el) || !(el instanceof HTMLElement)) return
      const leaf = canvasChain(el)[0]
      if (!leaf) return
      e.preventDefault()
      e.stopPropagation()
      setEditing(leaf)
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onDblClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDblClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [active, selectElement])

  return { active, setActive, hoverRect, hoverInfo, cursor, selected, setSelected, selectElement, clearSelected, editing, exitEditing, miss }
}
