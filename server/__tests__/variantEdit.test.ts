// ============================================================
//  Variant-aware token model — splitVariants + the engine's variant contract
// ------------------------------------------------------------
//  Pins the two safety rules that fix the silent-misedit paths:
//    • a BASE edit never claims a variant-prefixed token (hover:p-4, md:p-6) —
//      it edits the base value and WARNS that the variant still wins;
//    • an INLINE write REFUSES when variant tokens of the family exist (inline
//      would override every state — the destructive path).
//  Plus the new targeting: mutations carry `variant` ('hover', 'md',
//  'dark:hover') and the engine replaces/appends under that exact chain only.
//  Variant edits are Tailwind-class-only: every other route (inline strategy,
//  CSS var, CSS module, styled, shared const) refuses with a warning.
// ============================================================
import { describe, expect, it } from 'vitest'
import { computeStyleEdit, type Mutation } from '../styleEdit'
import { isVariantChain, isVarColorToken, splitVariants } from '../../src/muse/style/tailwindScales'

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

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
  scope: 'element' | 'const' = 'element',
) {
  const { line, column } = locOf(source, needle)
  return computeStyleEdit(source, line, column, mutations, strategy, tag, undefined, undefined, scope)
}

// ---- splitVariants (the shared token parser) ------------------------------------

describe('splitVariants', () => {
  it('bare token has no variants', () => {
    expect(splitVariants('p-4')).toEqual({ variants: '', base: 'p-4' })
  })
  it('single variant', () => {
    expect(splitVariants('hover:p-4')).toEqual({ variants: 'hover', base: 'p-4' })
  })
  it('compound chain splits at the LAST depth-0 colon', () => {
    expect(splitVariants('dark:hover:text-white')).toEqual({ variants: 'dark:hover', base: 'text-white' })
  })
  it('a colon inside brackets is NOT a variant separator', () => {
    expect(splitVariants('text-[length:17px]')).toEqual({ variants: '', base: 'text-[length:17px]' })
  })
  it('variant chain on a bracket-colon arbitrary', () => {
    expect(splitVariants('lg:text-[color:var(--x)]')).toEqual({ variants: 'lg', base: 'text-[color:var(--x)]' })
  })
  it('arbitrary selector variant is recognized (never authored)', () => {
    expect(splitVariants('[&>li]:p-2')).toEqual({ variants: '[&>li]', base: 'p-2' })
  })
  it('negative utility keeps its dash on the base', () => {
    expect(splitVariants('md:-mt-2')).toEqual({ variants: 'md', base: '-mt-2' })
  })
})

describe('isVariantChain', () => {
  it('accepts simple and compound ident chains', () => {
    expect(isVariantChain('hover')).toBe(true)
    expect(isVariantChain('md')).toBe(true)
    expect(isVariantChain('dark:hover')).toBe(true)
    expect(isVariantChain('group-hover')).toBe(true)
  })
  it('rejects empty, bracket, and malformed chains', () => {
    expect(isVariantChain('')).toBe(false)
    expect(isVariantChain('[&>li]')).toBe(false)
    expect(isVariantChain('hover:')).toBe(false)
    expect(isVariantChain('ho ver')).toBe(false)
    expect(isVariantChain('a"b')).toBe(false)
  })
})

describe('isVarColorToken is variant-blind', () => {
  it('sees a var-bound color under a variant prefix', () => {
    expect(isVarColorToken('text', 'dark:text-[color:var(--x)]')).toBe(true)
    expect(isVarColorToken('text', 'text-[color:var(--x)]')).toBe(true)
    expect(isVarColorToken('text', 'dark:text-[#fff]')).toBe(false)
  })
})

// ---- base edits never claim variant tokens ---------------------------------------

describe('base edit with variant tokens present', () => {
  it('edits the base token, leaves the variant token, and warns', () => {
    const src = `export const C = () => (\n  <div className="p-4 hover:p-6">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '8px' }])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('className="p-2 hover:p-6"')
    expect(r.warnings.some((w) => w.includes('also set by hover:'))).toBe(true)
  })

  it('appends a base token (not a duplicate of the variant) when no base exists, and warns', () => {
    const src = `export const C = () => (\n  <div className="md:p-6">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '16px' }])
    expect(r.newContent).toContain('className="md:p-6 p-4"')
    expect(r.warnings.some((w) => w.includes('also set by md:'))).toBe(true)
  })

  it('base edit on an element whose ONLY var-bound color lives under a variant writes the base (no var defer)', () => {
    // dark:text-[color:var(--x)] binds DARK mode to the theme var; the base slot is
    // free. Deferring to the var would mutate dark mode globally — writing a base
    // token (+ the variant warning) is the correct, intentional behavior. The
    // panel separately marks the channel read-only (isVarColorToken is
    // variant-blind), so this path is for variant-aware clients.
    const src = `export const C = () => (\n  <div className="dark:text-[color:var(--x)]">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: '#112233' }])
    expect(r.varEdits).toEqual([])
    expect(r.newContent).toContain('className="dark:text-[color:var(--x)] text-[#112233]"')
    expect(r.warnings.some((w) => w.includes('also set by dark:'))).toBe(true)
  })

  it('does NOT warn when the variant token is a different family (bracket-colon)', () => {
    const src = `export const C = () => (\n  <div className="lg:text-[color:var(--x)]">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'fontSize', value: '20px' }])
    // The lg: token is a COLOR, not a size — a fontSize edit must neither claim it
    // nor warn about it.
    expect(r.newContent).toContain('lg:text-[color:var(--x)]')
    expect(r.newContent).toContain('text-[length:20px]')
    expect(r.warnings).toEqual([])
  })
})

// ---- inline refusal (the destructive path this PR closes) ------------------------

describe('inline write vs variant tokens', () => {
  it('refuses the inline fallback when a variant token of the family exists', () => {
    const src = `export const C = () => (\n  <div className="hover:bg-red-500">hi</div>\n)\n`
    // oklch can't be a class token → would route inline → must refuse instead.
    const r = edit(src, '<div', 'div', [{ property: 'backgroundColor', value: 'oklch(0.5 0.1 200)' }])
    expect(r.changed).toBe(false)
    expect(r.newContent).toBe(src)
    expect(r.warnings.some((w) => w.includes('inline style would override every state'))).toBe(true)
  })

  it('still writes inline when the css key was ALREADY inline (no new damage)', () => {
    const src = `export const C = () => (\n  <div className="hover:bg-red-500" style={{ backgroundColor: "red" }}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'backgroundColor', value: 'oklch(0.5 0.1 200)' }])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('backgroundColor: "oklch(0.5 0.1 200)"')
    expect(r.newContent).toContain('hover:bg-red-500')
  })
})

// ---- variant-targeted edits -------------------------------------------------------

describe('variant-targeted edits', () => {
  it('replaces the SAME variant token in place, base untouched', () => {
    const src = `export const C = () => (\n  <div className="p-4 md:p-6">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '32px', variant: 'md' }])
    expect(r.newContent).toContain('className="p-4 md:p-8"')
    expect(r.warnings).toEqual([])
  })

  it('appends a prefixed token when the variant has none', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px', variant: 'md' }])
    expect(r.newContent).toContain('className="p-4 md:p-6"')
  })

  it('prefixes OUTSIDE a negative utility dash', () => {
    const src = `export const C = () => (\n  <div className="flex">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'marginTop', value: '-8px', variant: 'md' }])
    expect(r.newContent).toContain('className="flex md:-mt-2"')
  })

  it('dedupes within the target variant only', () => {
    const src = `export const C = () => (\n  <div className="md:p-2 md:p-6 p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '32px', variant: 'md' }])
    expect(r.newContent).toContain('className="md:p-8 p-4"')
  })

  it('compound chain targets only the exact chain', () => {
    const src = `export const C = () => (\n  <div className="dark:hover:text-white text-black">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: '#ff0000', variant: 'dark:hover' }])
    expect(r.newContent).toContain('className="dark:hover:text-[#ff0000] text-black"')
  })

  it('does not warn about a variant THIS batch deliberately wrote (variant before base)', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [
      { property: 'padding', value: '24px', variant: 'md' },
      { property: 'padding', value: '8px' },
    ])
    expect(r.newContent).toContain('className="p-2 md:p-6"')
    expect(r.warnings).toEqual([])
  })

  it('preserves CRLF byte-for-byte around a variant splice', () => {
    const src = crlf(`export const C = () => (\n  <div className="p-4 md:p-6">hi</div>\n)\n`)
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '32px', variant: 'md' }])
    expect(r.newContent).toBe(src.replace('md:p-6', 'md:p-8'))
    expect(r.newContent).not.toMatch(/[^\r]\n/)
  })
})

// ---- variant edits are Tailwind-class-only ----------------------------------------

describe('variant edits refuse non-class routes', () => {
  it('refuses under the inline strategy', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px', variant: 'hover' }], 'inline')
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.includes('supported for Tailwind classes only'))).toBe(true)
  })

  it('refuses when the value would need the inline fallback (inexpressible)', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: 'oklch(0.5 0.1 200)', variant: 'hover' }])
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.includes("couldn't express the hover: edit"))).toBe(true)
  })

  it('refuses a theme-bound value (var token under the same variant)', () => {
    const src = `export const C = () => (\n  <div className="dark:text-[color:var(--x)]">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: '#ffffff', variant: 'dark' }])
    expect(r.changed).toBe(false)
    expect(r.varEdits).toEqual([])
    expect(r.warnings.some((w) => w.includes('theme-bound via a CSS variable'))).toBe(true)
  })

  it('refuses on a CSS-modules binding', () => {
    const src = `import styles from './card.module.css'\nexport const C = () => (\n  <div className={styles.card}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px', variant: 'md' }])
    expect(r.changed).toBe(false)
    expect(r.moduleEdits).toEqual([])
    expect(r.warnings.some((w) => w.includes('supported for Tailwind classes only'))).toBe(true)
  })

  it('refuses on a shared-const scope edit', () => {
    const src = `const body = { padding: "8px" }\nexport const C = () => (\n  <p style={body}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'padding', value: '24px', variant: 'md' }], 'tailwind-first', 'const')
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.includes('supported for Tailwind classes only'))).toBe(true)
  })

  it('drops a malformed variant chain from the wire with a warning', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px', variant: '[&>li]' }])
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.includes('unsupported variant'))).toBe(true)
  })
})
