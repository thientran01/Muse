import { useCallback, useEffect, useState } from 'react'
import { getElementInfo, getSourceLocation, type ElementInfo } from './sourceLocation'
import type { CanvasElement } from './types'
import type { Rect } from './useSelection'

function isMuseUI(el: Element | null): boolean {
  return !!el && !!el.closest('[data-muse-ui]')
}

// Resolve a hovered/clicked DOM node to an editable Canvas target. Returns null
// when the node has no React source (can't be mapped to a file) — those can be
// highlighted but not edited.
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

/**
 * Drives Canvas Mode's element picking — the direct-manipulation cousin of
 * useSelection. Hover highlights any element; a click selects a single one and
 * STAYS in canvas mode (so you can keep editing or click a different element).
 * Clicks on Muse's own chrome (the controls popover) pass through untouched.
 */
export function useCanvasMode() {
  const [active, setActive] = useState(false)
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  const [hoverInfo, setHoverInfo] = useState<ElementInfo | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<CanvasElement | null>(null)

  const clearSelected = useCallback(() => setSelected(null), [])

  useEffect(() => {
    if (!active) {
      setHoverRect(null)
      setHoverInfo(null)
      setCursor(null)
      return
    }

    const onMove = (e: MouseEvent) => {
      setCursor({ x: e.clientX, y: e.clientY })
      const el = e.target as Element | null
      if (!el || isMuseUI(el)) {
        setHoverRect(null)
        setHoverInfo(null)
        return
      }
      const r = el.getBoundingClientRect()
      setHoverRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      setHoverInfo(getElementInfo(el))
    }

    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (!el || isMuseUI(el)) return // let the controls popover handle its own clicks
      e.preventDefault()
      e.stopPropagation()
      const picked = toCanvas(el)
      if (picked) {
        setSelected(picked)
        setHoverRect(null)
        setHoverInfo(null)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc steps back: a selected element first, then canvas mode itself.
        if (selected) setSelected(null)
        else setActive(false)
      }
    }

    document.body.classList.add('muse-selecting')
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.classList.remove('muse-selecting')
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [active, selected])

  return { active, setActive, hoverRect, hoverInfo, cursor, selected, setSelected, clearSelected }
}
