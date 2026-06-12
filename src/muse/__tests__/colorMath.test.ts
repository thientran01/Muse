// Alpha plumbing in colorMath — the picker's compose/parse pair and the
// alpha-preserving input normalizer.
import { describe, expect, it } from 'vitest'
import { alphaFromHex, composeHexAlpha, normalizeHexInput } from '../style/colorMath'

describe('alphaFromHex', () => {
  it('reads the 8-digit byte and the 4-digit nibble', () => {
    expect(alphaFromHex('#11223380')).toBeCloseTo(0x80 / 255, 5)
    expect(alphaFromHex('#1238')).toBeCloseTo(0x88 / 255, 5)
  })
  it('defaults to 1 for 3/6-digit and junk', () => {
    expect(alphaFromHex('#112233')).toBe(1)
    expect(alphaFromHex('#123')).toBe(1)
    expect(alphaFromHex('nope')).toBe(1)
  })
})

describe('composeHexAlpha', () => {
  it('stays 6-digit at full opacity (no churn on existing colors)', () => {
    expect(composeHexAlpha('#112233', 1)).toBe('#112233')
  })
  it('appends the byte below 1', () => {
    expect(composeHexAlpha('#112233', 0x80 / 255)).toBe('#11223380')
    expect(composeHexAlpha('#112233', 0)).toBe('#11223300')
  })
})

describe('normalizeHexInput preserves alpha', () => {
  it('round-trips 8-digit and expands 4-digit', () => {
    expect(normalizeHexInput('11223380')).toBe('#11223380')
    expect(normalizeHexInput('#1238')).toBe('#11223388')
  })
  it('keeps 6-digit canonical and drops a redundant ff byte', () => {
    expect(normalizeHexInput('AbCdEf')).toBe('#abcdef')
    expect(normalizeHexInput('#112233ff')).toBe('#112233')
  })
})
