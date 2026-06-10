// ============================================================
//  cssRuleEdit — setRuleProperty (the CSS-Modules rule editor)
// ------------------------------------------------------------
//  Pins the documented sharp edges: first-rule-wins with a match count, grouped
//  selectors flagged, nested (SCSS) bodies skipped, exact-property matching
//  (padding vs padding-left), comment blanking, the benign brace-in-value
//  duplicate-insert, unsafe-value refusal — and CRLF twins throughout.
// ============================================================
import { describe, expect, it } from 'vitest'
import { kebab, setRuleProperty } from '../../src/muse/style/cssRuleEdit'

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

describe('kebab', () => {
  it('maps camelCase css keys to declarations', () => {
    expect(kebab('paddingLeft')).toBe('padding-left')
    expect(kebab('backgroundColor')).toBe('background-color')
    expect(kebab('color')).toBe('color')
  })
})

describe('setRuleProperty', () => {
  const sheet = `.card {\n  padding: 16px;\n  color: red;\n}\n.badge {\n  margin: 4px;\n}\n`

  it('replaces an existing declaration value in place', () => {
    const r = setRuleProperty(sheet, 'card', 'padding', '24px')
    expect(r.changed).toBe(true)
    expect(r.matches).toBe(1)
    expect(r.grouped).toBe(false)
    expect(r.newContent).toBe(sheet.replace('padding: 16px;', 'padding: 24px;'))
  })

  it('preserves CRLF byte-for-byte on replace', () => {
    const r = setRuleProperty(crlf(sheet), 'card', 'padding', '24px')
    expect(r.newContent).toBe(crlf(sheet).replace('padding: 16px;', 'padding: 24px;'))
  })

  it('inserts a missing declaration, matching the body indentation', () => {
    const r = setRuleProperty(sheet, 'card', 'marginTop', '8px')
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('color: red;\n  margin-top: 8px;\n}')
  })

  it('matches the exact property, not a prefix family member', () => {
    const css = `.card {\n  padding: 16px;\n}\n`
    const r = setRuleProperty(css, 'card', 'paddingLeft', '4px')
    // padding stays; padding-left is inserted, not spliced over padding.
    expect(r.newContent).toContain('padding: 16px;')
    expect(r.newContent).toContain('padding-left: 4px;')
  })

  it('does not let .card match .cardHeader or grab another rule', () => {
    const css = `.cardHeader {\n  padding: 4px;\n}\n.card {\n  padding: 16px;\n}\n`
    const r = setRuleProperty(css, 'card', 'padding', '24px')
    expect(r.matches).toBe(1)
    expect(r.newContent).toContain('.cardHeader {\n  padding: 4px;\n}')
    expect(r.newContent).toContain('.card {\n  padding: 24px;\n}')
  })

  it('edits the first rule and counts media/theme overrides', () => {
    const css = `.card {\n  padding: 16px;\n}\n@media (min-width: 640px) {\n  .card {\n    padding: 32px;\n  }\n}\n`
    const r = setRuleProperty(css, 'card', 'padding', '24px')
    expect(r.changed).toBe(true)
    expect(r.matches).toBe(2)
    expect(r.newContent).toContain('padding: 24px;')
    expect(r.newContent).toContain('padding: 32px;') // override untouched
  })

  it('flags a comma-grouped selector', () => {
    const css = `.card, .badge {\n  padding: 16px;\n}\n`
    const r = setRuleProperty(css, 'card', 'padding', '24px')
    expect(r.changed).toBe(true)
    expect(r.grouped).toBe(true)
  })

  it('skips a nested (SCSS) body entirely', () => {
    const css = `.card {\n  padding: 16px;\n  &:hover { color: blue; }\n}\n`
    const r = setRuleProperty(css, 'card', 'padding', '24px')
    expect(r.changed).toBe(false)
    expect(r.matches).toBe(0)
    expect(r.newContent).toBe(css)
  })

  it('ignores a commented-out rule', () => {
    const css = `/* .card { padding: 1px; } */\n.card {\n  padding: 16px;\n}\n`
    const r = setRuleProperty(css, 'card', 'padding', '24px')
    expect(r.matches).toBe(1)
    expect(r.newContent).toContain('/* .card { padding: 1px; } */')
    expect(r.newContent).toContain('padding: 24px;')
  })

  it('refuses values that could escape the rule', () => {
    for (const bad of ['16px; color: red', '}', '{', '<x>', 'a\nb']) {
      const r = setRuleProperty(sheet, 'card', 'padding', bad)
      expect(r.changed).toBe(false)
      expect(r.newContent).toBe(sheet)
    }
  })

  it('returns unchanged for a rule that is not in this sheet', () => {
    const r = setRuleProperty(sheet, 'missing', 'padding', '24px')
    expect(r.changed).toBe(false)
    expect(r.matches).toBe(0)
  })

  it('returns unchanged when the value already matches', () => {
    const r = setRuleProperty(sheet, 'card', 'padding', '16px')
    expect(r.changed).toBe(false)
    expect(r.matches).toBe(1)
  })
})
