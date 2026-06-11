import { describe, expect, it } from 'vitest'
import { neuterSelectorText } from '../animationFreeze'

// Pure selector-transform tests — the DOM-touching freeze/restore path is
// verified live (the docs site under npm run dev); these pin the token swap
// that makes :hover/:active/:focus* rules stop matching while frozen.
describe('neuterSelectorText', () => {
  it('neuters a plain :hover', () => {
    expect(neuterSelectorText('.a:hover')).toBe('.a:not(*)')
  })

  it('neuters :active and the :focus family', () => {
    expect(neuterSelectorText('.a:active')).toBe('.a:not(*)')
    expect(neuterSelectorText('.a:focus')).toBe('.a:not(*)')
    expect(neuterSelectorText('.a:focus-visible')).toBe('.a:not(*)')
    expect(neuterSelectorText('.a:focus-within')).toBe('.a:not(*)')
  })

  it('rewrites only the real pseudo on a Tailwind escaped class', () => {
    // `.hover\:bg-red-500:hover` — the `\:` inside the class name is an escaped
    // ident character, not a pseudo-class.
    expect(neuterSelectorText('.hover\\:bg-red-500:hover')).toBe('.hover\\:bg-red-500:not(*)')
  })

  it('handles Tailwind group-hover', () => {
    expect(neuterSelectorText('.group:hover .group-hover\\:scale-105')).toBe(
      '.group:not(*) .group-hover\\:scale-105',
    )
  })

  it('keeps the non-hover arm of a selector list intact', () => {
    expect(neuterSelectorText('.a:hover, .b')).toBe('.a:not(*), .b')
  })

  it('keeps the non-hover arm inside :is()', () => {
    expect(neuterSelectorText(':is(.a:hover, .b) .c')).toBe(':is(.a:not(*), .b) .c')
  })

  it('turns :not(:hover) into always-match ("as if never hovered")', () => {
    expect(neuterSelectorText('.a:not(:hover)')).toBe('.a:not(:not(*))')
  })

  it('neuters a CSS-nesting child selector', () => {
    expect(neuterSelectorText('&:hover')).toBe('&:not(*)')
  })

  it('does not let :focus eat :focus-visible / :focus-within', () => {
    expect(neuterSelectorText('.a:focus-visible:hover')).toBe('.a:not(*):not(*)')
    expect(neuterSelectorText('.a:focus-within > .b')).toBe('.a:not(*) > .b')
  })

  it('leaves a fully escaped ident untouched', () => {
    // A literal class named `.foo:hover` is serialized as `.foo\:hover` —
    // its colon is escaped, so it is NOT a pseudo-class.
    expect(neuterSelectorText('.foo\\:hover')).toBeNull()
  })

  it('returns null when there is nothing to neuter', () => {
    expect(neuterSelectorText('.a .b > #c[data-x="1"]')).toBeNull()
    expect(neuterSelectorText('.a:hover-card')).toBeNull() // not a frozen pseudo
  })
})
