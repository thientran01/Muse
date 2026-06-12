// loadPrefs round-trip for the banner-lifecycle fields (hintUses /
// narrowNoticeSeen) — node env, so localStorage is absent and the SSR guard
// path also gets exercised via DEFAULT_PREFS.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, loadPrefs } from '../prefs'

describe('prefs (node / SSR path)', () => {
  it('defaults include zeroed hint counters and an unseen narrow notice', () => {
    expect(DEFAULT_PREFS.hintUses).toEqual({ select: 0, reorder: 0, text: 0 })
    expect(DEFAULT_PREFS.narrowNoticeSeen).toBe(false)
  })
  it('loadPrefs returns defaults without a window', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })
})

describe('loadPrefs validation (simulated storage)', () => {
  it('sanitizes malformed hintUses values', () => {
    const g = globalThis as { window?: unknown }
    g.window = {
      localStorage: {
        getItem: () => JSON.stringify({ zen: true, hintUses: { select: 'NaN', reorder: -3, text: 7 }, narrowNoticeSeen: 'yes' }),
      },
    }
    try {
      const p = loadPrefs()
      expect(p.zen).toBe(true)
      expect(p.hintUses).toEqual({ select: 0, reorder: 0, text: 7 })
      expect(p.narrowNoticeSeen).toBe(false) // 'yes' !== true
    } finally {
      delete g.window
    }
  })
})
