import type { ElementInfo } from '../sourceLocation'
import type { Rect } from '../types'

export function HoverHighlight({
  rect,
  cursor,
  info,
}: {
  rect: Rect
  cursor?: { x: number; y: number } | null
  info?: ElementInfo | null
}) {
  const OFFSET = 14
  const EST_W = 280
  const EST_H = 40
  let tipLeft = (cursor?.x ?? rect.left) + OFFSET
  let tipTop = (cursor?.y ?? rect.top) + OFFSET
  if (typeof window !== 'undefined' && cursor) {
    if (tipLeft + EST_W > window.innerWidth) tipLeft = cursor.x - OFFSET - EST_W
    if (tipTop + EST_H > window.innerHeight) tipTop = cursor.y - OFFSET - EST_H
    tipLeft = Math.max(4, tipLeft)
    tipTop = Math.max(4, tipTop)
  }
  return (
    <>
      <div
        // 90ms = DUR.fast (this follows every hover, so it stays at the floor of
        // the scale) on the system's in-out — movement between two on-screen
        // positions, not an enter/exit, and the stock ease-in-out is too weak.
        className="pointer-events-none absolute rounded-field bg-tint ring-2 ring-accent transition-[top,left,width,height,background-color] duration-[90ms] ease-[var(--muse-ease-in-out)] motion-reduce:transition-none"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
      {info && cursor && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-field bg-surface/95 px-2 py-1 font-mono text-chip leading-snug shadow-dock ring-1 ring-hairline backdrop-blur-overlay"
          style={{ top: tipTop, left: tipLeft }}
        >
          {info.crumbs.length > 0 && (
            <div className="text-fg-faint">{info.crumbs.map((c) => `<${c}>`).join(' ')}</div>
          )}
          <div className="truncate text-fg">
            {info.tag}
            {info.text && <span className="text-fg-faint"> "{info.text}"</span>}
          </div>
        </div>
      )}
    </>
  )
}
