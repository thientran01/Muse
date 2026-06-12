// ============================================================
//  computeStyleEdit — the engine's routing contract, per strategy
// ------------------------------------------------------------
//  Pins how a mutation is expressed for every styling system the engine claims
//  to support: Tailwind utilities (replace/append/author/arbitrary), the inline
//  fallback (literal merge, spread-override, attribute authoring, shorthand
//  expansion), CSS-variable deferral (VarEdit), CSS-Modules deferral
//  (ModuleEdit), and styled/emotion (same-file template + object edits, and
//  cross-file StyledEdit deferral). CRLF twins assert byte-exact splices on
//  Windows-authored sources.
// ============================================================
import { describe, expect, it } from 'vitest'
import { computeStyleEdit, type Mutation } from '../styleEdit'

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

// The 1-based line and 0-based column of `needle`'s first occurrence — the same
// coordinates a data-muse-loc stamp / _debugSource would report for the element.
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

// ---- Tailwind (tailwind-first) -------------------------------------------------

describe('tailwind-first', () => {
  it('replaces an on-scale utility in place', () => {
    const src = `export const C = () => (\n  <div className="p-4 text-sm">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px' }])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('className="p-6 text-sm"')
  })

  it('writes an arbitrary token for an off-scale value', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '17px' }])
    expect(r.newContent).toContain('className="p-[17px]"')
  })

  it('appends when the element has no utility of that family', () => {
    const src = `export const C = () => (\n  <div className="flex">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'marginTop', value: '16px' }])
    expect(r.newContent).toContain('className="flex mt-4"')
  })

  it('authors a className on a classless, style-less element', () => {
    const src = `export const C = () => (\n  <div>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '16px' }])
    expect(r.newContent).toContain('<div className="p-4">')
  })

  it('replaces a w-full keyword token instead of letting it duel a px width', () => {
    const src = `export const C = () => (\n  <div className="w-full p-2">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'width', value: '320px' }])
    expect(r.newContent).toContain('className="w-80 p-2"')
    expect(r.newContent).not.toContain('w-full')
  })

  it('falls back to inline (and strips the dueling class) for an inexpressible value', () => {
    const src = `export const C = () => (\n  <div className="text-red-500 p-2">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: 'oklch(0.5 0.1 200)' }])
    expect(r.newContent).not.toContain('text-red-500')
    expect(r.newContent).toContain('style={{ color: "oklch(0.5 0.1 200)" }}')
    expect(r.newContent).toContain('p-2') // unrelated family untouched
  })

  it('routes inline with a note when className is a dynamic expression', () => {
    const src = `export const C = ({ on }: { on: boolean }) => (\n  <div className={on ? 'a' : 'b'}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '16px' }])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain(`style={{ padding: "16px" }}`)
    expect(r.newContent).toContain(`className={on ? 'a' : 'b'}`)
    expect(r.warnings.some((w) => w.includes('dynamic className'))).toBe(true)
  })

  it('preserves CRLF byte-for-byte around a className splice', () => {
    const src = crlf(`export const C = () => (\n  <div className="p-4">hi</div>\n)\n`)
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px' }])
    expect(r.newContent).toBe(src.replace('p-4', 'p-6'))
    expect(r.newContent).not.toMatch(/[^\r]\n/)
  })

  it('handles a paste-sized batch (15+ mixed mutations) in one call', () => {
    const src = `export const C = () => (\n  <div className="p-4 text-sm">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [
      { property: 'paddingTop', value: '8px' },
      { property: 'paddingRight', value: '8px' },
      { property: 'paddingBottom', value: '8px' },
      { property: 'paddingLeft', value: '8px' },
      { property: 'marginTop', value: '16px' },
      { property: 'marginBottom', value: '16px' },
      { property: 'borderTopLeftRadius', value: '8px' },
      { property: 'borderTopRightRadius', value: '8px' },
      { property: 'borderBottomRightRadius', value: '8px' },
      { property: 'borderBottomLeftRadius', value: '8px' },
      { property: 'borderWidth', value: '1px' },
      { property: 'borderStyle', value: 'solid' },
      { property: 'opacity', value: '100%' },
      { property: 'color', value: '#111111' },
      { property: 'fontSize', value: '14px' },
      { property: 'fontWeight', value: '600' },
      { property: 'textAlign', value: 'center' },
    ])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('mt-4')
    expect(r.newContent).toContain('rounded-tl-lg')
    expect(r.newContent).toContain('border-solid')
    expect(r.newContent).toContain('font-semibold')
    expect(r.newContent).toContain('text-center')
  })
})

// ---- Inline strategy -------------------------------------------------------------

describe('inline strategy', () => {
  it('merges into an existing literal style object', () => {
    const src = `export const C = () => (\n  <p style={{ color: "red" }}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'fontSize', value: '18px' }], 'inline')
    expect(r.newContent).toContain(`style={{ color: "red", fontSize: "18px" }}`)
  })

  it('creates a style attribute after className when none exists', () => {
    const src = `export const C = () => (\n  <p className="intro">hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'color', value: '#ff0000' }], 'inline')
    expect(r.newContent).toContain(`className="intro" style={{ color: "#ff0000" }}`)
  })

  it('spread-overrides a non-literal style expression', () => {
    const src = `const body = getStyles()\nexport const C = () => (\n  <p style={body}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'marginTop', value: '16px' }], 'inline')
    expect(r.newContent).toContain(`style={{ ...body, marginTop: "16px" }}`)
  })

  it('round-trips its own spread-override shape on a re-edit', () => {
    const src = `const body = getStyles()\nexport const C = () => (\n  <p style={{ ...body, marginTop: "16px" }}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'marginTop', value: '24px' }], 'inline')
    expect(r.newContent).toContain(`style={{ ...body, marginTop: "24px" }}`)
  })

  it('expands a box shorthand the edit collides with (React 19 mix warning)', () => {
    const src = `export const C = () => (\n  <p style={{ margin: "0 0 24px" }}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'marginTop', value: '12px' }], 'inline')
    expect(r.newContent).toContain(
      `style={{ marginTop: "12px", marginRight: "0", marginBottom: "24px", marginLeft: "0" }}`,
    )
  })

  it('maps an axis property to both longhand keys', () => {
    const src = `export const C = () => (\n  <p style={{ color: "red" }}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'paddingX', value: '8px' }], 'inline')
    expect(r.newContent).toContain(`paddingLeft: "8px", paddingRight: "8px"`)
  })

  it('preserves CRLF byte-for-byte around a style splice', () => {
    const src = crlf(`export const C = () => (\n  <p style={{ color: "red" }}>hi</p>\n)\n`)
    const r = edit(src, '<p', 'p', [{ property: 'fontSize', value: '18px' }], 'inline')
    expect(r.newContent).toBe(src.replace(`{ color: "red" }`, `{ color: "red", fontSize: "18px" }`))
  })
})

// ---- CSS-variable deferral (VarEdit) ----------------------------------------------

describe('CSS-variable deferral', () => {
  it('defers an inline var-bound property to a VarEdit, leaving the JSX alone', () => {
    const src = `export const C = () => (\n  <div style={{ color: 'var(--accent)' }}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: '#123456' }])
    expect(r.changed).toBe(false)
    expect(r.varEdits).toEqual([{ property: 'color', varName: '--accent', value: '#123456' }])
    expect(r.warnings).not.toContain('nothing to change')
  })

  it('defers a themed Tailwind arbitrary token to a VarEdit', () => {
    const src = `export const C = () => (\n  <div className="text-[color:var(--accent)]">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'color', value: '#123456' }])
    expect(r.changed).toBe(false)
    expect(r.varEdits).toEqual([{ property: 'color', varName: '--accent', value: '#123456' }])
    expect(r.newContent).toBe(src)
  })

  it('warns and skips an asymmetric var binding on an axis property', () => {
    const src = `export const C = () => (\n  <div style={{ paddingLeft: 'var(--pad)', paddingRight: '8px' }}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'paddingX', value: '12px' }])
    expect(r.varEdits).toEqual([])
    expect(r.warnings.some((w) => w.includes('mixed/asymmetric'))).toBe(true)
  })
})

// ---- CSS Modules deferral (ModuleEdit) --------------------------------------------

describe('CSS Modules deferral', () => {
  const src = `import styles from './Card.module.css'\nexport const C = () => (\n  <div className={styles.card}>hi</div>\n)\n`

  it('defers a module-bound element to a ModuleEdit per css key', () => {
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px' }])
    expect(r.changed).toBe(false)
    expect(r.moduleEdits).toEqual([
      { specifier: './Card.module.css', className: 'card', cssProp: 'padding', value: '24px' },
    ])
  })

  it('maps an axis property to two ModuleEdits', () => {
    const r = edit(src, '<div', 'div', [{ property: 'paddingX', value: '8px' }])
    expect(r.moduleEdits.map((m) => m.cssProp)).toEqual(['paddingLeft', 'paddingRight'])
  })

  it('handles the computed styles["card"] binding form', () => {
    const s = `import styles from './Card.module.css'\nexport const C = () => (\n  <div className={styles['card']}>hi</div>\n)\n`
    const r = edit(s, '<div', 'div', [{ property: 'padding', value: '24px' }])
    expect(r.moduleEdits[0]?.className).toBe('card')
  })

  it('supports the namespace import form', () => {
    const s = `import * as styles from './Card.module.css'\nexport const C = () => (\n  <div className={styles.card}>hi</div>\n)\n`
    const r = edit(s, '<div', 'div', [{ property: 'padding', value: '24px' }])
    expect(r.moduleEdits[0]?.specifier).toBe('./Card.module.css')
  })
})

// ---- styled-components / emotion ---------------------------------------------------

describe('styled / emotion', () => {
  it('edits a same-file styled template in place', () => {
    const src = `import styled from 'styled-components'\nconst Card = styled.div\`\n  padding: 16px;\n\`\nexport const C = () => (\n  <Card>hi</Card>\n)\n`
    const r = edit(src, '<Card>', 'Card', [{ property: 'padding', value: '24px' }])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('padding: 24px;')
    expect(r.newContent).not.toContain('padding: 16px;')
  })

  it('patches a same-file styled object surgically', () => {
    const src = `import styled from 'styled-components'\nconst Card = styled.div({ padding: '16px', margin: 4 })\nexport const C = () => (\n  <Card>hi</Card>\n)\n`
    const r = edit(src, '<Card>', 'Card', [{ property: 'padding', value: '24px' }])
    expect(r.newContent).toContain(`padding: "24px"`)
    expect(r.newContent).toContain(`margin: 4`) // untouched prop stays byte-identical
  })

  it('edits an emotion css-prop template at the JSX site', () => {
    const src = `/** @jsxImportSource @emotion/react */\nimport { css } from '@emotion/react'\nexport const C = () => (\n  <div css={css\`\n    padding: 16px;\n  \`}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px' }])
    expect(r.newContent).toContain('padding: 24px;')
  })

  it('falls back to inline for an interpolated template, with a warning', () => {
    const src = `import styled from 'styled-components'\nconst Card = styled.div\`\n  color: \${(p: { c: string }) => p.c};\n\`\nexport const C = () => (\n  <Card>hi</Card>\n)\n`
    const r = edit(src, '<Card>', 'Card', [{ property: 'padding', value: '16px' }])
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain(`style={{ padding: "16px" }}`)
    expect(r.warnings.some((w) => w.includes('interpolations'))).toBe(true)
  })

  it('defers a relatively-imported component to a StyledEdit', () => {
    const src = `import { Card } from './ui'\nexport const C = () => (\n  <Card>hi</Card>\n)\n`
    const r = edit(src, '<Card>', 'Card', [{ property: 'padding', value: '24px' }])
    expect(r.changed).toBe(false)
    expect(r.styledEdits).toEqual([
      { specifier: './ui', exportName: 'Card', cssProp: 'padding', value: '24px' },
    ])
  })

  it('routes a package-imported component normally (out of styled scope)', () => {
    const src = `import { Button } from '@mui/material'\nexport const C = () => (\n  <Button>hi</Button>\n)\n`
    const r = edit(src, '<Button>', 'Button', [{ property: 'padding', value: '16px' }])
    expect(r.styledEdits).toEqual([])
    // tailwind-first authors a utility class on the usage site (whether it lands
    // visually depends on the component forwarding className — the host's contract).
    expect(r.newContent).toContain(`<Button className="p-4">`)
  })

  it('keeps Tailwind utilities primary when the styled element also carries them', () => {
    const src = `import styled from 'styled-components'\nconst Card = styled.div\`\n  padding: 16px;\n\`\nexport const C = () => (\n  <Card className="mt-2">hi</Card>\n)\n`
    const r = edit(src, '<Card', 'Card', [{ property: 'marginTop', value: '16px' }])
    expect(r.newContent).toContain('className="mt-4"')
    expect(r.newContent).toContain('padding: 16px;') // template untouched
  })

  it('preserves CRLF in a styled template splice', () => {
    const src = crlf(`import styled from 'styled-components'\nconst Card = styled.div\`\n  padding: 16px;\n\`\nexport const C = () => (\n  <Card>hi</Card>\n)\n`)
    const r = edit(src, '<Card>', 'Card', [{ property: 'padding', value: '24px' }])
    expect(r.newContent).toBe(src.replace('padding: 16px;', 'padding: 24px;'))
  })
})

// ---- shared-const scope -------------------------------------------------------------

describe('shared-const scope', () => {
  const src = `const body = { fontSize: "15px" }\nexport const C = () => (\n  <main>\n    <p style={body}>one</p>\n    <p style={body}>two</p>\n  </main>\n)\n`

  it('surfaces sharedConst on an element-scope edit', () => {
    const r = edit(src, '<p style={body}>one', 'p', [{ property: 'fontSize', value: '18px' }], 'inline')
    expect(r.sharedConst).toEqual({ name: 'body', sameFileCount: 2, exported: false })
    expect(r.newContent).toContain(`style={{ ...body, fontSize: "18px" }}`) // per-element override
  })

  it('rewrites the const definition under scope=const', () => {
    const r = edit(src, '<p style={body}>one', 'p', [{ property: 'fontSize', value: '18px' }], 'inline', 'const')
    expect(r.newContent).toContain(`const body = { fontSize: "18px" }`)
    expect(r.newContent).toContain('<p style={body}>one') // JSX untouched
  })

  it('warns and falls back per-element when scope=const has no resolvable const', () => {
    const s = `export const C = () => (\n  <p style={{ fontSize: "15px" }}>one</p>\n)\n`
    const r = edit(s, '<p', 'p', [{ property: 'fontSize', value: '18px' }], 'inline', 'const')
    expect(r.warnings.some((w) => w.includes('scope=const'))).toBe(true)
    expect(r.newContent).toContain(`fontSize: "18px"`)
  })
})

// ---- failure modes -------------------------------------------------------------------

describe('failure modes', () => {
  it('fails closed on an unparseable file', () => {
    const r = computeStyleEdit('const x = <<<', 1, 0, [{ property: 'padding', value: '4px' }])
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.startsWith('parse failed'))).toBe(true)
  })

  it('fails closed when no element is at the location', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = computeStyleEdit(src, 99, 0, [{ property: 'padding', value: '4px' }], 'tailwind-first', 'div')
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.includes('no JSX element'))).toBe(true)
  })

  it('rejects unknown properties', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = computeStyleEdit(src, 2, 2, [{ property: 'rotate' as never, value: '45deg' }], 'tailwind-first', 'div')
    expect(r.changed).toBe(false)
    expect(r.warnings).toContain('no valid mutations')
  })
})
