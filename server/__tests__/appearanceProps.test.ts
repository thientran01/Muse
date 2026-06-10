// ============================================================
//  Appearance properties — radius / border width+style / opacity
// ------------------------------------------------------------
//  Pure token builders + matchers (the border- prefix is triple-overloaded:
//  width vs style vs color — an edit of one must never touch the others), and
//  handler-level integration over fixture projects: Tailwind in-place family
//  replacement (including a whole-radius scrub absorbing a per-corner token),
//  the inline fallback, and the CSS Modules cross-file route.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMuseContext, createMuseHandlers, type MuseHandlers } from '../museCore'
import {
  borderStyleToken,
  borderWidthToken,
  isBorderStyleToken,
  isBorderWidthToken,
  isOpacityToken,
  opacityToken,
  radiusFamilyMatch,
  radiusToken,
} from '../../src/muse/style/tailwindScales'

// ---- pure builders ----------------------------------------------------------------

describe('radiusToken', () => {
  it('maps the Tailwind rounded scale, bare step included', () => {
    expect(radiusToken('rounded', '0px')).toBe('rounded-none')
    expect(radiusToken('rounded', '2px')).toBe('rounded-sm')
    expect(radiusToken('rounded', '4px')).toBe('rounded') // the bare 0.25rem step
    expect(radiusToken('rounded', '6px')).toBe('rounded-md')
    expect(radiusToken('rounded', '8px')).toBe('rounded-lg')
    expect(radiusToken('rounded', '12px')).toBe('rounded-xl')
    expect(radiusToken('rounded', '16px')).toBe('rounded-2xl')
    expect(radiusToken('rounded', '24px')).toBe('rounded-3xl')
    expect(radiusToken('rounded', '9999px')).toBe('rounded-full')
    expect(radiusToken('rounded', '10px')).toBe('rounded-[10px]')
    expect(radiusToken('rounded', '0.5rem')).toBe('rounded-lg')
  })
  it('handles corner prefixes and refuses what it cannot express', () => {
    expect(radiusToken('rounded-tl', '8px')).toBe('rounded-tl-lg')
    expect(radiusToken('rounded-tl', '4px')).toBe('rounded-tl')
    expect(radiusToken('rounded', '50%')).toBeNull() // % radius → inline fallback
    expect(radiusToken('rounded', '-4px')).toBeNull()
  })
})

describe('radiusFamilyMatch', () => {
  it('the all-corners family absorbs side and corner variants', () => {
    for (const tok of ['rounded', 'rounded-lg', 'rounded-full', 'rounded-[10px]', 'rounded-tl-none', 'rounded-t-lg', 'rounded-bl']) {
      expect(radiusFamilyMatch('rounded', tok)).toBe(true)
    }
    for (const tok of ['border', 'rounded-md-x', 'p-4', 'roundedish']) {
      expect(radiusFamilyMatch('rounded', tok)).toBe(false)
    }
  })
  it('a corner family stays corner-scoped', () => {
    expect(radiusFamilyMatch('rounded-tl', 'rounded-tl')).toBe(true)
    expect(radiusFamilyMatch('rounded-tl', 'rounded-tl-lg')).toBe(true)
    expect(radiusFamilyMatch('rounded-tl', 'rounded-tl-[3px]')).toBe(true)
    expect(radiusFamilyMatch('rounded-tl', 'rounded')).toBe(false)
    expect(radiusFamilyMatch('rounded-tl', 'rounded-tr-lg')).toBe(false)
  })
})

describe('border width / style tokens (the triple-overloaded border- prefix)', () => {
  it('builds width tokens, bare border = 1px', () => {
    expect(borderWidthToken('1px')).toBe('border')
    expect(borderWidthToken('0px')).toBe('border-0')
    expect(borderWidthToken('2px')).toBe('border-2')
    expect(borderWidthToken('8px')).toBe('border-8')
    expect(borderWidthToken('3px')).toBe('border-[3px]')
    expect(borderWidthToken('medium')).toBeNull()
  })
  it('width matcher never claims color or style tokens', () => {
    for (const tok of ['border', 'border-0', 'border-2', 'border-[3px]']) {
      expect(isBorderWidthToken(tok)).toBe(true)
    }
    for (const tok of ['border-red-500', 'border-[#fff]', 'border-[var(--x)]', 'border-solid', 'border-t-2', 'border-x']) {
      expect(isBorderWidthToken(tok)).toBe(false)
    }
  })
  it('style tokens build and match their own slice only', () => {
    expect(borderStyleToken('solid')).toBe('border-solid')
    expect(borderStyleToken('dashed')).toBe('border-dashed')
    expect(borderStyleToken('groove')).toBeNull()
    expect(isBorderStyleToken('border-solid')).toBe(true)
    expect(isBorderStyleToken('border-2')).toBe(false)
    expect(isBorderStyleToken('border-red-500')).toBe(false)
  })
})

describe('opacityToken', () => {
  it('named steps for the Tailwind scale, arbitrary otherwise', () => {
    expect(opacityToken('0.8')).toBe('opacity-80')
    expect(opacityToken('80%')).toBe('opacity-80')
    expect(opacityToken('1')).toBe('opacity-100')
    expect(opacityToken('0')).toBe('opacity-0')
    expect(opacityToken('0.83')).toBe('opacity-[0.83]')
    expect(opacityToken('0.15')).toBe('opacity-[0.15]') // 15 is not a v3 step
    expect(opacityToken('1.2')).toBeNull()
    expect(opacityToken('-0.1')).toBeNull()
  })
  it('matches only opacity utilities', () => {
    expect(isOpacityToken('opacity-80')).toBe(true)
    expect(isOpacityToken('opacity-[0.83]')).toBe(true)
    expect(isOpacityToken('opacity')).toBe(false)
    expect(isOpacityToken('bg-black/80')).toBe(false)
  })
})

// ---- handler-level integration (same harness as handlers.test.ts) -------------------

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

function makeProject(files: Record<string, string>): { root: string; handlers: MuseHandlers; read: (rel: string) => string; abs: (rel: string) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-appearance-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  const handlers = createMuseHandlers(createMuseContext({}, root))
  return { root, handlers, read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), abs: (rel) => path.join(root, rel) }
}

function fakeReq(body: unknown): IncomingMessage {
  const r = new Readable({ read() {} })
  r.push(JSON.stringify(body))
  r.push(null)
  return r as unknown as IncomingMessage
}

async function call(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>, body: unknown) {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res = {
    statusCode: 200,
    setHeader() {},
    end(s: string) {
      out.status = (res as { statusCode: number }).statusCode
      out.body = JSON.parse(s)
    },
  } as unknown as ServerResponse
  await handler(fakeReq(body), res)
  return out
}

function locOf(source: string, needle: string): { line: number; column: number } {
  const idx = source.indexOf(needle)
  if (idx === -1) throw new Error(`needle not found: ${needle}`)
  const before = source.slice(0, idx)
  return { line: before.split('\n').length, column: idx - (before.lastIndexOf('\n') + 1) }
}

function styleEditBody(p: { abs: (rel: string) => string }, rel: string, content: string, needle: string, tag: string, mutations: unknown, strategy?: string) {
  const { line, column } = locOf(content, needle)
  return { ...(strategy ? { strategy } : {}), edits: [{ fileName: p.abs(rel), line, column, tag, mutations }] }
}

describe('appearance edits through the engine', () => {
  it('replaces a radius family token in place, absorbing a per-corner straggler', async () => {
    const src = `export const Card = () => (\n  <div className="rounded-lg rounded-tl-none p-4">hi</div>\n)\n`
    const p = makeProject({ 'src/Card.tsx': src })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', src, '<div', 'div', [{ property: 'borderRadius', value: '12px' }], 'tailwind-first'))
    expect(r.status).toBe(200)
    const out = r.body.edits[0].newContent as string
    expect(out).toContain('rounded-xl')
    expect(out).not.toContain('rounded-lg')
    expect(out).not.toContain('rounded-tl-none')
    expect(out).toContain('p-4') // neighbors untouched
  })

  it('appends a corner token without disturbing the base radius', async () => {
    const src = `export const Card = () => (\n  <div className="rounded-lg p-4">hi</div>\n)\n`
    const p = makeProject({ 'src/Card.tsx': src })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', src, '<div', 'div', [{ property: 'borderTopLeftRadius', value: '0px' }], 'tailwind-first'))
    const out = r.body.edits[0].newContent as string
    expect(out).toContain('rounded-lg')
    expect(out).toContain('rounded-tl-none')
  })

  it('writes width + style as separate border tokens without touching border color', async () => {
    const src = `export const Card = () => (\n  <div className="border-red-500 p-4">hi</div>\n)\n`
    const p = makeProject({ 'src/Card.tsx': src })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', src, '<div', 'div', [
      { property: 'borderWidth', value: '2px' },
      { property: 'borderStyle', value: 'solid' },
    ], 'tailwind-first'))
    const out = r.body.edits[0].newContent as string
    expect(out).toContain('border-2')
    expect(out).toContain('border-solid')
    expect(out).toContain('border-red-500') // the color slice of the overload survives
  })

  it('writes opacity as a named step and falls back to inline for an off-scale radius unit', async () => {
    const src = `export const Card = () => (\n  <div className="p-4">hi</div>\n)\n`
    const p = makeProject({ 'src/Card.tsx': src })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', src, '<div', 'div', [
      { property: 'opacity', value: '0.8' },
      { property: 'borderRadius', value: '50%' }, // token builder refuses % → inline style
    ], 'tailwind-first'))
    const out = r.body.edits[0].newContent as string
    expect(out).toContain('opacity-80')
    expect(out).toContain('borderRadius')
    expect(out).toContain('50%')
  })

  it('routes appearance to inline style under the inline strategy (CRLF intact)', async () => {
    const src = crlf(`export const Card = () => (\n  <div className="p-4">hi</div>\n)\n`)
    const p = makeProject({ 'src/Card.tsx': src })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', src, '<div', 'div', [{ property: 'borderRadius', value: '12px' }], 'inline'))
    const out = r.body.edits[0].newContent as string
    expect(out).toContain('borderRadius')
    expect(out).toContain('12px')
    expect(out).toContain('\r\n')
    expect(out.replace(/\r\n/g, '\n')).not.toContain('\r') // no stray lone CRs
  })

  it('routes a radius edit into a CSS Module rule', async () => {
    const cardTsx = `import styles from './Card.module.css'\nexport const Card = () => (\n  <div className={styles.card}>hi</div>\n)\n`
    const cardCss = `.card {\n  padding: 16px;\n}\n`
    const p = makeProject({ 'src/Card.tsx': cardTsx, 'src/Card.module.css': cardCss })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', cardTsx, '<div', 'div', [{ property: 'borderRadius', value: '12px' }], 'inline'))
    expect(r.body.edits[0].fileName).toBe('src/Card.module.css')
    expect(r.body.edits[0].newContent).toContain('border-radius: 12px;')
  })
})
