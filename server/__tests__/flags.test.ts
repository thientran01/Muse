// ============================================================
//  Flags — the /flag handler contract + the instance-context derivation
// ------------------------------------------------------------
//  First direct coverage of the flag capture path. Pins the instance-aware-flag
//  contract (spec: docs/specs/2026-07-23-flag-instance-context.md): a flag on an
//  element authored inside a shared component persists the usage-site container
//  loc + instance index alongside the authored loc — the assertion that would
//  have failed on the real bug (a FigureCaption flag that pinned only the
//  component file, with the instance riding on rendered text alone).
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMuseContext, createMuseHandlers, type MuseHandlers } from '../museCore'
import { pickUsage } from '../../src/muse/flagContext'

// ---- fixture project + fake req/res helpers (same shape as handlers.test.ts) ----

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

function makeProject(files: Record<string, string>): { root: string; handlers: MuseHandlers; abs: (rel: string) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-test-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  const handlers = createMuseHandlers(createMuseContext({}, root))
  return { root, handlers, abs: (rel) => path.join(root, rel) }
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

const captionTsx = `export const FigureCaption = ({ children }) => (\n  <figcaption className="mt-2 text-sm">{children}</figcaption>\n)\n`
const pageTsx = `import { FigureCaption } from './FigureCaption'\nexport const Page = () => (\n  <div className="prose">\n    <FigureCaption>Start here.</FigureCaption>\n  </div>\n)\n`

const sharedComponentDraft = (p: { abs: (rel: string) => string }) => ({
  fileName: p.abs('src/FigureCaption.tsx'),
  line: 2,
  column: 2,
  tag: 'figcaption',
  className: 'mt-2 text-sm',
  text: 'Start here.',
  comment: 'delete this one',
})

describe('flag capture — instance context', () => {
  it('persists the usage-site container loc (consuming file, repo-relative) alongside the authored component loc', async () => {
    const p = makeProject({ 'src/FigureCaption.tsx': captionTsx, 'src/Page.tsx': pageTsx })
    const r = await call(p.handlers.flag, {
      ...sharedComponentDraft(p),
      crumbs: ['Page', 'FigureCaption'],
      usage: { fileName: p.abs('src/Page.tsx'), line: 3, column: 2, tag: 'div' },
      instanceIndex: 2,
      instanceCount: 3,
    })
    expect(r.status).toBe(200)
    // Authored loc = the component file (where the pixels live) …
    expect(r.body.flag.file).toBe('src/FigureCaption.tsx')
    // … and usage = the CONSUMING file — the field the FigureCaption bug was missing.
    expect(r.body.flag.usage).toEqual({ file: 'src/Page.tsx', line: 3, column: 2, tag: 'div' })
    expect(r.body.flag.crumbs).toEqual(['Page', 'FigureCaption'])
    expect(r.body.flag.instanceIndex).toBe(2)
    expect(r.body.flag.instanceCount).toBe(3)
    // Round-trip: the persisted file serves the same context back.
    const list = await call(p.handlers.flags, {})
    expect(list.body.flags[0].usage.file).toBe('src/Page.tsx')
    expect(list.body.flags[0].instanceCount).toBe(3)
  })

  it('accepts an old-client draft without instance fields and invents none', async () => {
    const p = makeProject({ 'src/FigureCaption.tsx': captionTsx })
    const r = await call(p.handlers.flag, sharedComponentDraft(p))
    expect(r.status).toBe(200)
    expect(r.body.flag).not.toHaveProperty('usage')
    expect(r.body.flag).not.toHaveProperty('crumbs')
    expect(r.body.flag).not.toHaveProperty('instanceIndex')
  })

  it('drops (never rejects on) advisory context that fails validation', async () => {
    const p = makeProject({ 'src/FigureCaption.tsx': captionTsx })
    const r = await call(p.handlers.flag, {
      ...sharedComponentDraft(p),
      // usage outside src/ fails the resolveInSrc gate; instance 0-of-0 is nonsense.
      usage: { fileName: path.join(p.abs(''), 'vite.config.ts'), line: 1, column: 0, tag: 'div' },
      instanceIndex: 0,
      instanceCount: 0,
      crumbs: ['Page', 42, null],
    })
    expect(r.status).toBe(200) // the work-order still lands
    expect(r.body.flag).not.toHaveProperty('usage')
    expect(r.body.flag).not.toHaveProperty('instanceIndex')
    expect(r.body.flag.crumbs).toEqual(['Page']) // non-strings filtered
  })

  it('drops an instance whose count is smaller than its index', async () => {
    const p = makeProject({ 'src/FigureCaption.tsx': captionTsx })
    const r = await call(p.handlers.flag, { ...sharedComponentDraft(p), instanceIndex: 3, instanceCount: 2 })
    expect(r.status).toBe(200)
    expect(r.body.flag).not.toHaveProperty('instanceIndex')
  })
})

describe('pickUsage — nearest cross-file ancestor', () => {
  const loc = (fileName: string, line: number, tag: string) => ({ fileName, line, column: 0, tag })

  it('finds the first chain entry authored in a different file than the leaf', () => {
    const chain = [
      loc('src/FigureCaption.tsx', 2, 'figcaption'),
      loc('src/FigureCaption.tsx', 1, 'div'),
      loc('src/Page.tsx', 3, 'div'), // the consuming page's bare wrapper
      loc('src/App.tsx', 8, 'main'),
    ]
    expect(pickUsage(chain)).toEqual({ fileName: 'src/Page.tsx', line: 3, column: 0, tag: 'div' })
  })

  it('returns undefined when the whole chain is one file (element authored in place)', () => {
    expect(pickUsage([loc('src/Page.tsx', 3, 'p'), loc('src/Page.tsx', 2, 'div')])).toBeUndefined()
    expect(pickUsage([])).toBeUndefined()
  })

  it('does not count an absolute vs repo-relative spelling of the SAME file as cross-file', () => {
    // Mixed locator strategies: the leaf resolved via the repo-relative data-muse-loc
    // stamp, an ancestor via the fiber fallback's absolute win32 path.
    const chain = [
      loc('src/FigureCaption.tsx', 2, 'figcaption'),
      loc('C:\\proj\\src\\FigureCaption.tsx', 1, 'div'),
      loc('C:\\proj\\src\\Page.tsx', 3, 'div'),
    ]
    expect(pickUsage(chain)?.fileName).toBe('C:\\proj\\src\\Page.tsx')
  })
})
