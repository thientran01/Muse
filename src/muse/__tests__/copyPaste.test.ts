// snapshotMutations / pasteDiff — the copy/paste model. Pure: a CanvasValues
// fixture in, a mutation list out. The invariants that matter: width/height/
// display never transfer, themed color channels stay home, a transparent
// own-background can't become paint, Type props need a text target, container
// props need a flex/grid target, and a paste writes ONLY differing values.
import { describe, expect, it } from 'vitest'
import { pasteDiff, snapshotMutations } from '../style/copyPaste'
import type { CanvasValues } from '../components/canvas/PropertiesPanel'

const base = (over: Partial<CanvasValues> = {}): CanvasValues => ({
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  gap: null,
  layout: null,
  display: 'block',
  flex: null,
  size: { width: 200, height: 100 },
  type: { fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0, align: 'left' },
  rendersText: true,
  color: { text: '#111111', background: '#ffffff', border: '#000000', ownBackground: '#ffffff' },
  colorThemed: { text: false, background: false, border: false },
  appearance: {
    radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
    borderWidth: 1,
    borderStyleNone: false,
    opacity: 100,
    shadow: 'md',
    shadowParts: null,
  },
  ...over,
})

describe('snapshotMutations', () => {
  it('never serializes width, height, or display', () => {
    const props = snapshotMutations(base()).map((m) => m.property)
    expect(props).not.toContain('width')
    expect(props).not.toContain('height')
    expect(props).not.toContain('display')
  })

  it('skips themed color channels and a transparent own-background', () => {
    const muts = snapshotMutations(
      base({
        colorThemed: { text: true, background: false, border: false },
        color: { text: '#111111', background: '#ffffff', border: '#000000', ownBackground: null },
      }),
    )
    const props = muts.map((m) => m.property)
    expect(props).not.toContain('color') // themed
    expect(props).not.toContain('backgroundColor') // transparent own-bg
  })

  it('borderStyle/borderColor ride only a painted border', () => {
    const none = snapshotMutations(base({ appearance: { ...base().appearance, borderWidth: 0 } })).map((m) => m.property)
    expect(none).not.toContain('borderStyle')
    expect(none).not.toContain('borderColor')
    const some = snapshotMutations(base()).map((m) => m.property)
    expect(some).toContain('borderStyle')
    expect(some).toContain('borderColor')
  })

  it('serializes a preset shadow as its real CSS and a custom one from parts', () => {
    const preset = snapshotMutations(base()).find((m) => m.property === 'boxShadow')
    expect(preset?.value).toContain('0 4px 6px') // Tailwind md
    const custom = snapshotMutations(
      base({ appearance: { ...base().appearance, shadow: 'custom', shadowParts: { x: 0, y: 2, blur: 9, spread: 0, alpha: 0.3 } } }),
    ).find((m) => m.property === 'boxShadow')
    expect(custom?.value).toBe('0px 2px 9px 0px rgba(0, 0, 0, 0.3)')
  })

  it('skips Type props on a non-text source, splits unequal gap', () => {
    const noText = snapshotMutations(base({ rendersText: false })).map((m) => m.property)
    expect(noText).not.toContain('fontSize')
    const withGap = snapshotMutations(base({ gap: { row: 8, column: 12 }, layout: { justify: 'center', align: 'normal' } }))
    expect(withGap.find((m) => m.property === 'rowGap')?.value).toBe('8px')
    expect(withGap.find((m) => m.property === 'columnGap')?.value).toBe('12px')
    expect(withGap.find((m) => m.property === 'gap')).toBeUndefined()
    expect(withGap.map((m) => m.property)).not.toContain('alignItems') // normal unwritable
  })
})

describe('pasteDiff', () => {
  it('writes only differing values', () => {
    const source = snapshotMutations(base())
    const sameTarget = base()
    expect(pasteDiff(source, sameTarget)).toEqual([])
    const padded = base({ padding: { top: 24, right: 8, bottom: 8, left: 8 } })
    const diff = pasteDiff(source, padded)
    expect(diff).toEqual([{ property: 'paddingTop', value: '8px' }])
  })

  it('drops Type props for a non-text target and container props for a non-container target', () => {
    const source = snapshotMutations(base({ gap: { row: 8, column: 8 }, layout: { justify: 'center', align: 'center' } }))
    const target = base({ rendersText: false, type: { ...base().type, fontSize: 99 } })
    const diff = pasteDiff(source, target)
    const props = diff.map((m) => m.property)
    expect(props).not.toContain('fontSize') // target renders no text
    expect(props).not.toContain('gap') // target isn't a container
    expect(props).not.toContain('justifyContent')
  })

  it('resets a target value the source holds at default (opacity)', () => {
    const source = snapshotMutations(base()) // opacity 100%
    const faded = base({ appearance: { ...base().appearance, opacity: 50 } })
    expect(pasteDiff(source, faded)).toContainEqual({ property: 'opacity', value: '100%' })
  })
})
