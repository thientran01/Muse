// measureBetween — the Alt-hover measurement math. Pure rects in, segments out.
import { describe, expect, it } from 'vitest'
import { measureBetween } from '../measure'

const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('measureBetween', () => {
  it('horizontal gap between side-by-side rects, at the vertical overlap midpoint', () => {
    const segs = measureBetween(r(0, 0, 100, 100), r(140, 20, 200, 80))
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ x1: 100, y1: 50, x2: 140, y2: 50, label: 40 })
  })

  it('vertical gap between stacked rects', () => {
    const segs = measureBetween(r(0, 0, 100, 50), r(10, 90, 90, 140))
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ x1: 50, y1: 50, x2: 50, y2: 90, label: 40 })
  })

  it('diagonal rects draw both axes, anchored on the selection center lines', () => {
    const segs = measureBetween(r(0, 0, 100, 100), r(200, 200, 300, 300))
    expect(segs).toHaveLength(2)
    const h = segs.find((s) => s.y1 === s.y2)!
    const v = segs.find((s) => s.x1 === s.x2)!
    expect(h).toEqual({ x1: 100, y1: 50, x2: 200, y2: 50, label: 100 })
    expect(v).toEqual({ x1: 50, y1: 100, x2: 50, y2: 200, label: 100 })
  })

  it('reversed order (b before a) measures the same gap', () => {
    const segs = measureBetween(r(140, 20, 200, 80), r(0, 0, 100, 100))
    expect(segs[0].label).toBe(40)
  })

  it('containment yields four inset segments', () => {
    const segs = measureBetween(r(0, 0, 200, 200), r(50, 40, 150, 160))
    expect(segs).toHaveLength(4)
    const labels = segs.map((s) => s.label).sort((x, y) => x - y)
    expect(labels).toEqual([40, 40, 50, 50]) // top 40, bottom 40, left 50, right 50
  })

  it('partial overlap yields per-side edge deltas, zero-length sides dropped', () => {
    // share the same top edge — that side's segment is zero and dropped
    const segs = measureBetween(r(0, 0, 100, 100), r(50, 0, 150, 80))
    expect(segs.every((s) => s.label > 0)).toBe(true)
    expect(segs).toHaveLength(3)
  })

  it('identical rects measure nothing', () => {
    expect(measureBetween(r(0, 0, 100, 100), r(0, 0, 100, 100))).toEqual([])
  })
})
