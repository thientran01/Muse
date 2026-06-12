// display / flexDirection / flexWrap — the layout-restructure families. All
// three are CLOSED keyword sets; the load-bearing discipline is overload
// safety: `flex`/`grid` display keywords must never claim (or be claimed by)
// the flex-GROW shorthands (flex-1/auto/none/initial), and direction tokens
// (flex-row) must stay disjoint from wrap tokens (flex-wrap).
import { describe, expect, it } from 'vitest'
import { computeStyleEdit, type Mutation } from '../styleEdit'
import {
  displayToken,
  flexDirectionToken,
  flexWrapToken,
  isDisplayToken,
  isFlexDirectionToken,
  isFlexWrapToken,
} from '../../src/muse/style/tailwindScales'

function locOf(source: string, needle: string): { line: number; column: number } {
  const idx = source.indexOf(needle)
  if (idx === -1) throw new Error(`needle not found: ${needle}`)
  const before = source.slice(0, idx)
  const line = before.split('\n').length
  const column = idx - (before.lastIndexOf('\n') + 1)
  return { line, column }
}

function edit(
  source: string,
  needle: string,
  tag: string,
  mutations: Mutation[],
  strategy: 'tailwind-first' | 'inline' = 'tailwind-first',
) {
  const { line, column } = locOf(source, needle)
  return computeStyleEdit(source, line, column, mutations, strategy, tag)
}

describe('builders and matchers', () => {
  it('builds display keywords (hidden deliberately unsupported)', () => {
    expect(displayToken('flex')).toBe('flex')
    expect(displayToken('inline-grid')).toBe('inline-grid')
    expect(displayToken('none')).toBeNull()
    expect(displayToken('table')).toBeNull()
  })
  it('display matcher never claims flex-grow shorthands or direction/wrap', () => {
    expect(isDisplayToken('flex')).toBe(true)
    expect(isDisplayToken('grid')).toBe(true)
    expect(isDisplayToken('flex-1')).toBe(false)
    expect(isDisplayToken('flex-auto')).toBe(false)
    expect(isDisplayToken('flex-none')).toBe(false)
    expect(isDisplayToken('flex-initial')).toBe(false)
    expect(isDisplayToken('flex-row')).toBe(false)
    expect(isDisplayToken('flex-wrap')).toBe(false)
    expect(isDisplayToken('hidden')).toBe(false)
  })
  it('direction and wrap families are disjoint exact sets', () => {
    expect(flexDirectionToken('column')).toBe('flex-col')
    expect(flexDirectionToken('row-reverse')).toBe('flex-row-reverse')
    expect(isFlexDirectionToken('flex-col')).toBe(true)
    expect(isFlexDirectionToken('flex-wrap')).toBe(false)
    expect(isFlexDirectionToken('flex-1')).toBe(false)
    expect(flexWrapToken('wrap')).toBe('flex-wrap')
    expect(isFlexWrapToken('flex-nowrap')).toBe(true)
    expect(isFlexWrapToken('flex-row')).toBe(false)
  })
})

describe('engine routing', () => {
  it('replaces a display keyword in place', () => {
    const src = `export const C = () => (\n  <div className="flex gap-2 flex-1">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'display', value: 'grid' }])
    expect(r.newContent).toContain('className="grid gap-2 flex-1"') // flex-1 untouched
  })

  it('authors a display class on a classless element', () => {
    const src = `export const C = () => (\n  <div>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'display', value: 'flex' }])
    expect(r.newContent).toContain('<div className="flex">')
  })

  it('writes direction without touching display or wrap', () => {
    const src = `export const C = () => (\n  <div className="flex flex-wrap flex-row">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'flexDirection', value: 'column' }])
    expect(r.newContent).toContain('className="flex flex-wrap flex-col"')
  })

  it('a variant-targeted display edit writes the prefixed token (#136 contract)', () => {
    const src = `export const C = () => (\n  <div className="block">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'display', value: 'flex', variant: 'md' }])
    expect(r.newContent).toContain('className="block md:flex"')
  })

  it('inline strategy writes the css keys', () => {
    const src = `export const C = () => (\n  <p>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'display', value: 'flex' }], 'inline')
    expect(r.newContent).toContain('style={{ display: "flex" }}')
  })

  it('defers to a CSS module rule for a module-bound element', () => {
    const src = `import styles from './card.module.css'\nexport const C = () => (\n  <div className={styles.card}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'flexDirection', value: 'column' }])
    expect(r.moduleEdits).toEqual([{ specifier: './card.module.css', className: 'card', cssProp: 'flexDirection', value: 'column' }])
  })

  it('edits a same-file styled template in place', () => {
    const src = `import styled from 'styled-components'\nconst Card = styled.div\`\n  display: block;\n\`\nexport const C = () => (\n  <Card>hi</Card>\n)\n`
    const r = edit(src, '<Card', 'Card', [{ property: 'display', value: 'flex' }])
    expect(r.newContent).toContain('display: flex;')
  })
})
