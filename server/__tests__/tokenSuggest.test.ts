// ============================================================
//  tokenSuggest — the picker's top-5 token ranking (pure half)
// ------------------------------------------------------------
//  Pins the selection contract: usage-ranked, visibility only down-ranks (never
//  excludes), definition order breaks ties, identical values dedupe to the
//  stronger name, non-hex color tokens get no swatch, capped at five.
// ============================================================
import { describe, expect, it } from 'vitest'
import { TOKEN_SWATCH_LIMIT, rankTokenSwatches } from '../../src/muse/style/tokenSuggest'

const tok = (name: string, value: string, isColor = true) => ({ name, value, isColor })

describe('rankTokenSwatches', () => {
  it('ranks by page usage first', () => {
    const out = rankTokenSwatches(
      [tok('--a', '#111111'), tok('--b', '#222222'), tok('--c', '#333333')],
      { '--a': 1, '--b': 9, '--c': 4 },
    )
    expect(out.map((s) => s.name)).toEqual(['--b', '--c', '--a'])
  })

  it('falls back to definition order on equal usage', () => {
    const out = rankTokenSwatches(
      [tok('--first', '#111111'), tok('--second', '#222222')],
      {},
    )
    expect(out.map((s) => s.name)).toEqual(['--first', '--second'])
  })

  it('down-ranks a near-invisible token against the paired color without excluding it', () => {
    const out = rankTokenSwatches(
      [tok('--white', '#ffffff'), tok('--ink', '#1c1917')],
      {},
      { contrastAgainst: '#ffffff' }, // editing text over a white fill
    )
    expect(out.map((s) => s.name)).toEqual(['--ink', '--white'])
    expect(out).toHaveLength(2) // still offered, just last
  })

  it('lets usage beat visibility (a popular surface token stays on top)', () => {
    const out = rankTokenSwatches(
      [tok('--paper', '#ffffff'), tok('--rare', '#1c1917')],
      { '--paper': 12, '--rare': 0 },
      { contrastAgainst: '#ffffff' },
    )
    expect(out[0].name).toBe('--paper')
  })

  it('dedupes identical values, keeping the stronger-ranked name', () => {
    const out = rankTokenSwatches(
      [tok('--alias', '#7f2f2f'), tok('--brand', '#7F2F2F')],
      { '--brand': 5 },
    )
    expect(out).toEqual([{ name: '--brand', value: '#7f2f2f' }])
  })

  it('normalizes short hex and skips non-hex color tokens', () => {
    const out = rankTokenSwatches(
      [tok('--short', '#abc'), tok('--oklch', 'oklch(0.5 0.1 200)'), tok('--size', '16px', false)],
      {},
    )
    expect(out).toEqual([{ name: '--short', value: '#aabbcc' }])
  })

  it('caps at the swatch limit', () => {
    const tokens = Array.from({ length: 9 }, (_, i) => tok(`--t${i}`, `#00000${i}`))
    const out = rankTokenSwatches(tokens, {})
    expect(out).toHaveLength(TOKEN_SWATCH_LIMIT)
  })
})
