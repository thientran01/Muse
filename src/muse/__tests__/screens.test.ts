// The breakpoint-target switcher's pure model: Tailwind default screens,
// mobile-first current-breakpoint resolution, target-applies gating (live
// preview honesty), and the responsive-first variant chain composition.
import { describe, expect, it } from 'vitest'
import { composeVariant, currentBreakpoint, SCREEN_MIN, targetApplies } from '../style/screens'

describe('currentBreakpoint', () => {
  it('is base below sm', () => {
    expect(currentBreakpoint(320)).toBe('')
    expect(currentBreakpoint(639)).toBe('')
  })
  it('steps mobile-first through the scale', () => {
    expect(currentBreakpoint(640)).toBe('sm')
    expect(currentBreakpoint(767)).toBe('sm')
    expect(currentBreakpoint(768)).toBe('md')
    expect(currentBreakpoint(1024)).toBe('lg')
    expect(currentBreakpoint(1280)).toBe('xl')
    expect(currentBreakpoint(1536)).toBe('2xl')
    expect(currentBreakpoint(3840)).toBe('2xl')
  })
})

describe('targetApplies', () => {
  it('base always applies', () => {
    expect(targetApplies('', 100)).toBe(true)
  })
  it('a min-width target applies at and above its screen', () => {
    expect(targetApplies('md', SCREEN_MIN.md)).toBe(true)
    expect(targetApplies('md', SCREEN_MIN.md - 1)).toBe(false)
    expect(targetApplies('md', 1920)).toBe(true)
  })
})

describe('composeVariant', () => {
  it('base + no state = no variant', () => {
    expect(composeVariant('', null)).toBe('')
  })
  it('breakpoint alone', () => {
    expect(composeVariant('md', null)).toBe('md')
  })
  it('state alone', () => {
    expect(composeVariant('', 'hover')).toBe('hover')
  })
  it('responsive before state, Tailwind order', () => {
    expect(composeVariant('md', 'hover')).toBe('md:hover')
    expect(composeVariant('lg', 'dark:hover')).toBe('lg:dark:hover')
  })
})
