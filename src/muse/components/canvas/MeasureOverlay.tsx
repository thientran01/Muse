// Alt-hover distance readouts between the selection and the hovered element —
// Figma muscle memory, read-only. Replaces the retarget hover highlight while
// Alt is down (the click behavior underneath is untouched: Alt-click still
// steps out to the parent). Accent lines + px pills; the hovered counterpart
// gets a thin outline so it's clear what's being measured to. Geometry is two
// live rects through the pure measureBetween — recomputed per hover move, same
// fixed-layer conventions as BoxModelOverlay.
import { Fragment } from 'react'
import { measureBetween } from '../../measure'
import type { Rect } from '../../types'

export function MeasureOverlay({ node, hoverRect }: { node: HTMLElement; hoverRect: Rect }) {
  const a = node.getBoundingClientRect()
  const segs = measureBetween(
    { top: a.top, left: a.left, right: a.right, bottom: a.bottom },
    { top: hoverRect.top, left: hoverRect.left, right: hoverRect.left + hoverRect.width, bottom: hoverRect.top + hoverRect.height },
  )
  return (
    <>
      <div
        className="pointer-events-none absolute ring-1 ring-accent/40"
        style={{ top: hoverRect.top, left: hoverRect.left, width: hoverRect.width, height: hoverRect.height }}
      />
      {segs.map((s, i) => {
        const horizontal = s.y1 === s.y2
        return (
          <Fragment key={i}>
            <div
              className="pointer-events-none absolute bg-accent"
              style={
                horizontal
                  ? { left: Math.min(s.x1, s.x2), top: s.y1 - 0.5, width: Math.abs(s.x2 - s.x1), height: 1 }
                  : { left: s.x1 - 0.5, top: Math.min(s.y1, s.y2), width: 1, height: Math.abs(s.y2 - s.y1) }
              }
            />
            {/* white-on-accent reads on both themes — the accent triplet is constant */}
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-accent px-1 py-px font-mono text-[10px] leading-4 text-white"
              style={{ left: (s.x1 + s.x2) / 2, top: (s.y1 + s.y2) / 2 }}
            >
              {s.label}
            </div>
          </Fragment>
        )
      })}
    </>
  )
}
