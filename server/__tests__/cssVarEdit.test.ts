// ============================================================
//  cssVarEdit — extractVarName / editCssVar / listCssVars
// ------------------------------------------------------------
//  Pins the CSS-variable editor's contract: value-only splice, first definition
//  wins (theme overrides untouched but counted), comments blanked, unsafe values
//  refused, and byte-exact output — including CRLF line endings, which every
//  fixture here re-asserts via a CRLF twin.
// ============================================================
import { describe, expect, it } from 'vitest'
import { editCssVar, extractVarName, isVarValue, listCssVars } from '../../src/muse/style/cssVarEdit'

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

describe('extractVarName', () => {
  it('pulls the name from a bare var()', () => {
    expect(extractVarName('var(--accent)')).toBe('--accent')
  })
  it('handles a fallback value', () => {
    expect(extractVarName('var(--accent, #fff)')).toBe('--accent')
  })
  it('handles a Tailwind arbitrary wrapper prefix', () => {
    expect(extractVarName('color:var(--accent)')).toBe('--accent')
    expect(extractVarName('length:var(--lh)')).toBe('--lh')
  })
  it('tolerates !important', () => {
    expect(extractVarName('var(--accent) !important')).toBe('--accent')
  })
  it('rejects compound values', () => {
    expect(extractVarName('calc(var(--a) + var(--b))')).toBeNull()
    expect(extractVarName('1px solid var(--line)')).toBeNull()
    expect(extractVarName('#fff')).toBeNull()
  })
  it('isVarValue mirrors extractVarName', () => {
    expect(isVarValue('var(--x)')).toBe(true)
    expect(isVarValue('red')).toBe(false)
  })
})

describe('editCssVar', () => {
  const sheet = `:root {\n  --accent: #ff0000;\n  --space: 8px;\n}\n.dark {\n  --accent: #00ff00;\n}\n`

  it('replaces only the value of the first definition', () => {
    const r = editCssVar(sheet, '--accent', '#123456')
    expect(r.changed).toBe(true)
    expect(r.matches).toBe(2)
    expect(r.newContent).toBe(sheet.replace('#ff0000', '#123456'))
    // The .dark override is untouched.
    expect(r.newContent).toContain('--accent: #00ff00;')
  })

  it('preserves CRLF line endings byte-for-byte', () => {
    const r = editCssVar(crlf(sheet), '--accent', '#123456')
    expect(r.changed).toBe(true)
    expect(r.newContent).toBe(crlf(sheet).replace('#ff0000', '#123456'))
    expect(r.newContent).not.toMatch(/[^\r]\n/) // no lone LF introduced
  })

  it('ignores a commented-out definition', () => {
    const css = `/* --accent: #000; */\n:root { --accent: #ff0000; }\n`
    const r = editCssVar(css, '--accent', '#123456')
    expect(r.matches).toBe(1)
    expect(r.newContent).toContain('/* --accent: #000; */')
    expect(r.newContent).toContain('--accent: #123456;')
  })

  it('returns unchanged when the var is not defined here', () => {
    const r = editCssVar(sheet, '--nope', 'red')
    expect(r.changed).toBe(false)
    expect(r.matches).toBe(0)
    expect(r.newContent).toBe(sheet)
  })

  it('returns unchanged when the value already matches', () => {
    const r = editCssVar(sheet, '--space', '8px')
    expect(r.changed).toBe(false)
    expect(r.matches).toBe(1)
  })

  it('refuses values that could escape the declaration', () => {
    for (const bad of ['red; color: blue', 'red}', '{', '<script>', 'a\nb', 'a\r\nb']) {
      const r = editCssVar(sheet, '--accent', bad)
      expect(r.changed).toBe(false)
      expect(r.newContent).toBe(sheet)
    }
  })

  it('matches a declaration terminated by } instead of ;', () => {
    const css = `:root { --accent: #ff0000 }\n`
    const r = editCssVar(css, '--accent', '#123456')
    expect(r.changed).toBe(true)
    expect(r.newContent).toBe(`:root { --accent: #123456 }\n`)
  })
})

describe('listCssVars', () => {
  it('lists each var once, first definition wins, comments skipped', () => {
    const css = `/* --ghost: #000; */\n:root {\n  --accent: #ff0000;\n  --space: 8px;\n}\n.dark { --accent: #00ff00; }\n`
    const vars = listCssVars(css)
    expect(vars).toEqual([
      { name: '--accent', value: '#ff0000' },
      { name: '--space', value: '8px' },
    ])
  })
})
