import type { ElementInfo } from '../sourceLocation'
import type { Rect } from '../types'

export function SelectBanner() {
  return (
    <div className="pointer-events-none rounded-full bg-surface/95 px-4 py-2 text-sm font-medium text-fg shadow-lg ring-1 ring-line/10 backdrop-blur">
      Click to select{' '}
      <span className="text-fg-faint">· Esc to cancel</span>
    </div>
  )
}

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
        className="pointer-events-none absolute rounded-md bg-accent/10 ring-2 ring-accent transition-all duration-100 ease-in-out motion-reduce:transition-none"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
      {info && cursor && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md bg-surface/95 px-2 py-1 font-mono text-[10.5px] leading-snug shadow-lg ring-1 ring-line/10 backdrop-blur"
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
