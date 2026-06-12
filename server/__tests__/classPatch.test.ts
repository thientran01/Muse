// classPatch — the freeform class field's verbatim add/remove op, and
// isSafeClassToken, the user-text → source-file security boundary. Removes
// match whole tokens exactly (variants included); adds dedupe and are
// individually gated; a patch may ride alone (mutations []) or with property
// mutations in one edit.
import { describe, expect, it } from 'vitest'
import { computeStyleEdit, type Mutation, type ClassPatch } from '../styleEdit'
import { isSafeClassToken } from '../../src/muse/style/tailwindScales'

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
  classPatch?: ClassPatch,
  scope: 'element' | 'const' = 'element',
) {
  const { line, column } = locOf(source, needle)
  return computeStyleEdit(source, line, column, mutations, 'tailwind-first', tag, undefined, undefined, scope, classPatch)
}

describe('isSafeClassToken', () => {
  it('accepts real Tailwind shapes', () => {
    for (const t of [
      'p-4',
      'hover:bg-stone-700',
      'md:dark:flex',
      'w-[calc(100%-2rem)]',
      "content-['»']",
      'bg-white/60',
      'w-1/2',
      '!mt-0',
      '-mt-2',
      'text-[color:var(--x)]',
      'rounded-md',
    ]) {
      expect(isSafeClassToken(t), t).toBe(true)
    }
  })
  it('rejects everything that could escape a className emit', () => {
    for (const t of [
      '',
      'a b',
      'a"b',
      'a`b',
      'a${b}',
      'a{b}',
      'a<b>',
      'a;b',
      'a\\:b',
      'w-[calc(100%', // unbalanced
      'a]b[', // closes before opening
      'x'.repeat(129),
    ]) {
      expect(isSafeClassToken(t), JSON.stringify(t)).toBe(false)
    }
  })
})

describe('classPatch', () => {
  it('adds verbatim tokens (variants included) to a literal className', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [], { add: ['flex', 'hover:p-2'], remove: [] })
    expect(r.changed).toBe(true)
    expect(r.newContent).toContain('className="p-4 flex hover:p-2"')
  })

  it('removes exact whole tokens only', () => {
    const src = `export const C = () => (\n  <div className="p-4 hover:p-6 px-2">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [], { add: [], remove: ['hover:p-6'] })
    expect(r.newContent).toContain('className="p-4 px-2"')
  })

  it('authors a className on a classless element', () => {
    const src = `export const C = () => (\n  <div>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [], { add: ['flex', 'gap-2'], remove: [] })
    expect(r.newContent).toContain('<div className="flex gap-2">')
  })

  it('dedupes an add that already exists (no-op edit reports nothing to change)', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [], { add: ['p-4'], remove: [] })
    expect(r.changed).toBe(false)
    expect(r.warnings).toContain('nothing to change')
  })

  it('refuses a dynamic className with a warning', () => {
    const src = `export const C = ({ on }: { on: boolean }) => (\n  <div className={on ? 'a' : 'b'}>hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [], { add: ['flex'], remove: [] })
    expect(r.changed).toBe(false)
    expect(r.warnings.some((w) => w.includes('dynamic expression'))).toBe(true)
  })

  it('skips an unsafe token with a warning, applies the rest', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [], { add: ['flex', 'a"b'], remove: [] })
    expect(r.newContent).toContain('className="p-4 flex"')
    expect(r.warnings.some((w) => w.includes("isn't a safe class token"))).toBe(true)
  })

  it('rides alongside property mutations in one edit', () => {
    const src = `export const C = () => (\n  <div className="p-4">hi</div>\n)\n`
    const r = edit(src, '<div', 'div', [{ property: 'padding', value: '24px' }], { add: ['flex'], remove: [] })
    expect(r.newContent).toContain('className="p-6 flex"')
  })

  it('is refused on a const-scope edit with a warning', () => {
    const src = `const body = { padding: "8px" }\nexport const C = () => (\n  <p style={body}>hi</p>\n)\n`
    const r = edit(src, '<p', 'p', [{ property: 'padding', value: '24px' }], { add: ['flex'], remove: [] }, 'const')
    expect(r.warnings.some((w) => w.includes('per-element'))).toBe(true)
    expect(r.newContent).not.toContain('flex')
  })

  it('preserves CRLF byte-for-byte around a class-patch splice', () => {
    const src = crlf(`export const C = () => (\n  <div className="p-4">hi</div>\n)\n`)
    const r = edit(src, '<div', 'div', [], { add: ['flex'], remove: [] })
    expect(r.newContent).toBe(src.replace('className="p-4"', 'className="p-4 flex"'))
    expect(r.newContent).not.toMatch(/[^\r]\n/)
  })
})
