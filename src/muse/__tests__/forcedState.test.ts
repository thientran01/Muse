// pinSelectorText — the pure selector rewrite under the forced-:hover pin.
// Same discipline as animationFreeze's neuterSelectorText tests: escaped idents
// (Tailwind's `.hover\:bg-x`) keep their names; only a real :hover pseudo is
// rewritten; selectors without one return null (nothing to clone).
import { describe, expect, it } from 'vitest'
import { PIN_HOVER_ATTR, pinSelectorText } from '../forcedState'

const PIN = `[${PIN_HOVER_ATTR}]`

describe('pinSelectorText', () => {
  it('rewrites a plain :hover', () => {
    expect(pinSelectorText('.a:hover')).toBe(`.a${PIN}`)
  })

  it('rewrites :hover on an ancestor in a descendant selector', () => {
    expect(pinSelectorText('.a:hover .b')).toBe(`.a${PIN} .b`)
  })

  it('rewrites only the :hover arm inside :is()', () => {
    expect(pinSelectorText(':is(:hover, :focus)')).toBe(`:is(${PIN}, :focus)`)
  })

  it('keeps an escaped Tailwind ident and rewrites only the trailing pseudo', () => {
    expect(pinSelectorText('.hover\\:bg-x:hover')).toBe(`.hover\\:bg-x${PIN}`)
  })

  it('rewrites every :hover in a selector list', () => {
    expect(pinSelectorText('.a:hover, .b:hover > span')).toBe(`.a${PIN}, .b${PIN} > span`)
  })

  it('returns null when there is nothing to pin', () => {
    expect(pinSelectorText('.a:active')).toBeNull()
    expect(pinSelectorText('.a')).toBeNull()
  })

  it('does not match a longer ident that merely starts with hover', () => {
    expect(pinSelectorText('.a:hover-card')).toBeNull()
  })

  it('handles :not(:hover) (clone matches when pinned-not — boolean composition holds)', () => {
    expect(pinSelectorText('.a:not(:hover)')).toBe(`.a:not(${PIN})`)
  })
})
