// The measurement overlay's pure geometry — distances between the SELECTION
// (a) and a hovered element (b), Figma's Alt-hover idiom.
//
//  • Intersecting rects (containment or partial overlap): one inset segment per
//    side — corresponding edge to corresponding edge, drawn at the midpoint of
//    the overlap band on the other axis. Zero-length segments are dropped.
//  • Disjoint on an axis: the edge-to-edge gap segment, drawn at the overlap
//    band's midpoint when the OTHER axis overlaps, else anchored on the
//    selection's center line (the diagonal case draws both axes' gaps).
//
// Pure (rect-shaped inputs, no DOM) so the math is unit-testable; the overlay
// component feeds it live getBoundingClientRect values.

export type RectEdges = { top: number; left: number; right: number; bottom: number }
export type MeasureSegment = { x1: number; y1: number; x2: number; y2: number; label: number }

export function measureBetween(a: RectEdges, b: RectEdges): MeasureSegment[] {
  const segs: MeasureSegment[] = []
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    const label = Math.round(Math.hypot(x2 - x1, y2 - y1))
    if (label > 0) segs.push({ x1, y1, x2, y2, label })
  }
  const xOverlap = Math.max(a.left, b.left) < Math.min(a.right, b.right)
  const yOverlap = Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)

  if (xOverlap && yOverlap) {
    const xm = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2
    const ym = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2
    push(xm, a.top, xm, b.top)
    push(xm, a.bottom, xm, b.bottom)
    push(a.left, ym, b.left, ym)
    push(a.right, ym, b.right, ym)
    return segs
  }

  if (!xOverlap) {
    const x1 = a.right <= b.left ? a.right : b.right
    const x2 = a.right <= b.left ? b.left : a.left
    // Diagonal anchoring rule: measures ORIGINATE FROM THE SELECTION, so both
    // segments ride a's center lines. The far endpoint then floats off b's box
    // — inherent to any single straight line between diagonal rects (Figma adds
    // dashed extension lines for this; deferred).
    const y = yOverlap
      ? (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2
      : (a.top + a.bottom) / 2
    push(x1, y, x2, y)
  }
  if (!yOverlap) {
    const y1 = a.bottom <= b.top ? a.bottom : b.bottom
    const y2 = a.bottom <= b.top ? b.top : a.top
    const x = xOverlap ? (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2 : (a.left + a.right) / 2
    push(x, y1, x, y2)
  }
  return segs
}
