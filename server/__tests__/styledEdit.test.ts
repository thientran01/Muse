// ============================================================
//  styledEdit — setTemplateProperty (styled/emotion template bodies)
// ------------------------------------------------------------
//  Pins top-level-only editing: nested &:hover/@media blocks are masked (the
//  base declaration is edited, the override untouched), comments are blanked,
//  the documented brace-in-value worst case stays benign (a duplicate insert,
//  never corruption), unsafe values are refused — with CRLF twins.
// ============================================================
import { describe, expect, it } from 'vitest'
import { blankNestedBlocks, setTemplateProperty } from '../../src/muse/style/styledEdit'

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

describe('blankNestedBlocks', () => {
  it('masks nested blocks but keeps offsets and newlines', () => {
    const body = `\n  color: red;\n  &:hover { color: blue; }\n`
    const masked = blankNestedBlocks(body)
    expect(masked.length).toBe(body.length)
    expect(masked).toContain('color: red;')
    expect(masked).not.toContain('color: blue;')
    expect(masked.split('\n').length).toBe(body.split('\n').length)
  })
})

describe('setTemplateProperty', () => {
  const body = `\n  padding: 16px;\n  color: red;\n  &:hover {\n    color: blue;\n  }\n`

  it('replaces a top-level declaration in place', () => {
    const r = setTemplateProperty(body, 'padding', '24px')
    expect(r.changed).toBe(true)
    expect(r.newContent).toBe(body.replace('padding: 16px;', 'padding: 24px;'))
  })

  it('preserves CRLF byte-for-byte', () => {
    const r = setTemplateProperty(crlf(body), 'padding', '24px')
    expect(r.newContent).toBe(crlf(body).replace('padding: 16px;', 'padding: 24px;'))
  })

  it('edits the base declaration, never the one inside &:hover', () => {
    const r = setTemplateProperty(body, 'color', 'green')
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('color: green;')
    expect(r.newContent).toContain('color: blue;') // hover override untouched
  })

  it('inserts a missing declaration at the end of the top level', () => {
    const r = setTemplateProperty(body, 'marginTop', '8px')
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('margin-top: 8px;')
    // Inserted after the closing } of the nested block, no stray leading semicolon.
    expect(r.newContent).not.toContain('};')
  })

  it('maps camelCase css keys to kebab declarations', () => {
    const r = setTemplateProperty(`\n  background-color: red;\n`, 'backgroundColor', 'blue')
    expect(r.newContent).toContain('background-color: blue;')
    expect(r.newContent).not.toContain('backgroundColor')
  })

  it('ignores a commented-out declaration', () => {
    const b = `\n  /* padding: 1px; */\n  padding: 16px;\n`
    const r = setTemplateProperty(b, 'padding', '24px')
    expect(r.newContent).toContain('/* padding: 1px; */')
    expect(r.newContent).toContain('padding: 24px;')
  })

  it('brace-in-value worst case is a benign duplicate insert, not corruption', () => {
    // The literal `{` in content masks the rest of the body, so the existing
    // padding after it is not found → a fresh declaration is inserted. The new
    // value still wins the cascade and the body stays valid CSS (documented
    // LIMITATION in styledEdit.ts).
    const b = `\n  content: "{";\n  padding: 16px;\n`
    const r = setTemplateProperty(b, 'padding', '24px')
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('padding: 16px;') // original left in place
    expect(r.newContent).toContain('padding: 24px;') // duplicate appended, wins cascade
    const opens = (r.newContent.match(/\{/g) ?? []).length
    const closes = (r.newContent.match(/\}/g) ?? []).length
    expect(opens).toBe(closes + 1) // only the literal `{` from the content value remains unbalanced, as before
  })

  it('refuses values that could escape the declaration', () => {
    for (const bad of ['red; padding: 0', '}', '{', '<x>', 'a\nb']) {
      const r = setTemplateProperty(body, 'color', bad)
      expect(r.changed).toBe(false)
      expect(r.newContent).toBe(body)
    }
  })

  it('returns unchanged when the value already matches', () => {
    const r = setTemplateProperty(body, 'padding', '16px')
    expect(r.changed).toBe(false)
  })
})
