// ============================================================
//  museCore handlers — integration over throwaway fixture projects
// ------------------------------------------------------------
//  Drives the real HTTP handlers (createMuseHandlers) against tmp-dir projects,
//  pinning the cross-file behavior the pure suites can't reach: deferred
//  VarEdit/ModuleEdit/StyledEdit resolution to the right file, the multi-file
//  `originals` undo contract (replaying originals through /write reverts every
//  touched file byte-exact), styled re-export chains + the cycle guard,
//  strategy auto-detection, and /write's src/ boundary.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMuseContext, createMuseHandlers, type MuseHandlers } from '../museCore'

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

// ---- fixture project + fake req/res helpers ------------------------------------

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

function makeProject(files: Record<string, string>): { root: string; handlers: MuseHandlers; read: (rel: string) => string; abs: (rel: string) => string } {
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
  return {
    root,
    handlers,
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    abs: (rel) => path.join(root, rel),
  }
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

// The 1-based line and 0-based column of `needle` in a fixture file's content.
function locOf(source: string, needle: string): { line: number; column: number } {
  const idx = source.indexOf(needle)
  if (idx === -1) throw new Error(`needle not found: ${needle}`)
  const before = source.slice(0, idx)
  return { line: before.split('\n').length, column: idx - (before.lastIndexOf('\n') + 1) }
}

function styleEditBody(p: { abs: (rel: string) => string }, rel: string, content: string, needle: string, tag: string, mutations: unknown, strategy?: string) {
  const { line, column } = locOf(content, needle)
  return {
    ...(strategy ? { strategy } : {}),
    edits: [{ fileName: p.abs(rel), line, column, tag, mutations }],
  }
}

// ---- CSS Modules: cross-file edit + multi-file undo ------------------------------

describe('CSS Modules (ModuleEdit) end to end', () => {
  const cardTsx = `import styles from './Card.module.css'\nexport const Card = () => (\n  <div className={styles.card}>hi</div>\n)\n`
  const cardCss = `.card {\n  padding: 16px;\n  color: red;\n}\n`

  it('routes the edit into the .module.css and captures originals for undo', async () => {
    const p = makeProject({ 'src/Card.tsx': cardTsx, 'src/Card.module.css': cardCss })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', cardTsx, '<div', 'div', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.status).toBe(200)
    expect(r.body.edits).toHaveLength(1)
    expect(r.body.edits[0].fileName).toBe('src/Card.module.css')
    expect(r.body.edits[0].newContent).toContain('padding: 24px;')
    // The undo contract: originals carries the touched file's prior bytes.
    expect(r.body.originals['src/Card.module.css']).toBe(cardCss)

    // Apply (the client immediately /writes the edits) …
    const w = await call(p.handlers.write, { files: r.body.edits })
    expect(w.body.ok).toBe(true)
    expect(p.read('src/Card.module.css')).toContain('padding: 24px;')

    // … then undo by replaying originals through /write — byte-exact revert.
    const undoFiles = Object.entries(r.body.originals).map(([fileName, newContent]) => ({ fileName, newContent }))
    const u = await call(p.handlers.write, { files: undoFiles })
    expect(u.body.ok).toBe(true)
    expect(p.read('src/Card.module.css')).toBe(cardCss)
  })

  it('preserves CRLF in a Windows-authored module stylesheet', async () => {
    const p = makeProject({ 'src/Card.tsx': crlf(cardTsx), 'src/Card.module.css': crlf(cardCss) })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', crlf(cardTsx), '<div', 'div', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.body.edits[0].newContent).toBe(crlf(cardCss).replace('padding: 16px;', 'padding: 24px;'))
  })

  it('warns and leaves an alias module import unchanged', async () => {
    const aliased = cardTsx.replace(`'./Card.module.css'`, `'@/Card.module.css'`)
    const p = makeProject({ 'src/Card.tsx': aliased, 'src/Card.module.css': cardCss })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', aliased, '<div', 'div', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.body.edits).toHaveLength(0)
    expect(r.body.warnings.join(' ')).toContain('alias/package import')
  })

  it('warns when the rule is missing from the sheet', async () => {
    const p = makeProject({ 'src/Card.tsx': cardTsx, 'src/Card.module.css': `.other { color: blue; }\n` })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/Card.tsx', cardTsx, '<div', 'div', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.body.edits).toHaveLength(0)
    expect(r.body.warnings.join(' ')).toContain('no .card rule')
  })
})

// ---- CSS variables: discovery + theme overrides ----------------------------------

describe('CSS variables (VarEdit) end to end', () => {
  const appTsx = `export const App = () => (\n  <div style={{ color: 'var(--accent)' }}>hi</div>\n)\n`
  const themeCss = `:root {\n  --accent: #ff0000;\n}\n.dark {\n  --accent: #00ff00;\n}\n`

  it('edits the defining stylesheet and warns about theme overrides', async () => {
    const p = makeProject({ 'src/App.tsx': appTsx, 'src/styles/theme.css': themeCss })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'color', value: '#123456' }], 'inline'))
    expect(r.body.edits).toHaveLength(1)
    expect(r.body.edits[0].fileName).toBe('src/styles/theme.css')
    expect(r.body.edits[0].newContent).toContain('--accent: #123456;')
    expect(r.body.edits[0].newContent).toContain('--accent: #00ff00;')
    expect(r.body.originals['src/styles/theme.css']).toBe(themeCss)
    expect(r.body.warnings.join(' ')).toContain('themed in 2 selectors')
  })

  it('is not decoyed by a commented-out definition in an earlier-sorting file', async () => {
    // `a-comment.css` sorts before `theme.css`; pre-fix, its commented `--accent`
    // matched the discovery regex, won the pick, and the edit silently no-opped.
    const p = makeProject({
      'src/App.tsx': appTsx,
      'src/styles/a-comment.css': `/* legacy: --accent: #000; */\n.x { color: blue; }\n`,
      'src/styles/theme.css': themeCss,
    })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'color', value: '#123456' }], 'inline'))
    expect(r.body.edits).toHaveLength(1)
    expect(r.body.edits[0].fileName).toBe('src/styles/theme.css')
    expect(r.body.edits[0].newContent).toContain('--accent: #123456;')
  })

  it('warns when the var is defined nowhere', async () => {
    const p = makeProject({ 'src/App.tsx': appTsx })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'color', value: '#123456' }], 'inline'))
    expect(r.body.edits).toHaveLength(0)
    expect(r.body.warnings.join(' ')).toContain("couldn't find where --accent is defined")
  })
})

// ---- styled-components: import resolution, barrels, cycle guard -------------------

describe('imported styled components (StyledEdit) end to end', () => {
  const appTsx = `import { Card } from './components'\nexport const App = () => (\n  <Card>hi</Card>\n)\n`

  it('follows a re-export barrel to the defining file and edits its template', async () => {
    const p = makeProject({
      'src/App.tsx': appTsx,
      'src/components/index.ts': `export { Card } from './card'\n`,
      'src/components/card.tsx': `import styled from 'styled-components'\nexport const Card = styled.div\`\n  padding: 4px;\n\`\n`,
    })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<Card>', 'Card', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.body.edits).toHaveLength(1)
    expect(r.body.edits[0].fileName).toBe('src/components/card.tsx')
    expect(r.body.edits[0].newContent).toContain('padding: 24px;')
    expect(r.body.originals['src/components/card.tsx']).toContain('padding: 4px;')
  })

  it('survives a re-export cycle (guarded, warns, terminates)', async () => {
    const p = makeProject({
      'src/App.tsx': appTsx,
      'src/components/index.ts': `export { Card } from './loop'\n`,
      'src/components/loop.ts': `export { Card } from './index'\n`,
    })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<Card>', 'Card', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.body.edits).toHaveLength(0)
    expect(r.body.warnings.join(' ')).toContain("couldn't resolve styled import")
  })

  it('warns when the resolved export is not a styled component', async () => {
    const p = makeProject({
      'src/App.tsx': appTsx,
      'src/components/index.ts': `export const Card = () => null\n`,
    })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<Card>', 'Card', [{ property: 'padding', value: '24px' }], 'inline'))
    expect(r.body.edits).toHaveLength(0)
    expect(r.body.warnings.join(' ')).toContain('no styled "Card" found')
  })
})

// ---- mixed deferrals in one request ------------------------------------------------

describe('mixed multi-file edits', () => {
  it('collects edits + originals across every touched file in one response', async () => {
    const appTsx = `import styles from './Card.module.css'\nexport const App = () => (\n  <main>\n    <div style={{ color: 'var(--accent)' }}>a</div>\n    <section className={styles.card}>b</section>\n  </main>\n)\n`
    const themeCss = `:root { --accent: #ff0000; }\n`
    const cardCss = `.card {\n  padding: 16px;\n}\n`
    const p = makeProject({ 'src/Card.module.css': cardCss, 'src/App.tsx': appTsx, 'src/theme.css': themeCss })
    const a = locOf(appTsx, '<div')
    const b = locOf(appTsx, '<section')
    const r = await call(p.handlers.styleEdit, {
      strategy: 'inline',
      edits: [
        { fileName: p.abs('src/App.tsx'), line: a.line, column: a.column, tag: 'div', mutations: [{ property: 'color', value: '#123456' }] },
        { fileName: p.abs('src/App.tsx'), line: b.line, column: b.column, tag: 'section', mutations: [{ property: 'padding', value: '24px' }] },
      ],
    })
    const byFile = Object.fromEntries(r.body.edits.map((e: { fileName: string; newContent: string }) => [e.fileName, e.newContent]))
    expect(byFile['src/theme.css']).toContain('--accent: #123456;')
    expect(byFile['src/Card.module.css']).toContain('padding: 24px;')
    expect(Object.keys(r.body.originals).sort()).toEqual(['src/Card.module.css', 'src/theme.css'])
    expect(r.body.originals['src/theme.css']).toBe(themeCss)
    expect(r.body.originals['src/Card.module.css']).toBe(cardCss)
  })
})

// ---- strategy auto-detection ---------------------------------------------------------

describe('detectStrategy (via an unstamped style-edit)', () => {
  const appTsx = `export const App = () => (\n  <div>hi</div>\n)\n`

  it('detects Tailwind from a CSS @tailwind directive', async () => {
    const p = makeProject({ 'src/App.tsx': appTsx, 'src/index.css': `@tailwind base;\n@tailwind utilities;\n` })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'padding', value: '16px' }]))
    expect(r.body.edits[0].newContent).toContain('className="p-4"')
  })

  it('is not fooled by a commented-out @tailwind directive', async () => {
    const p = makeProject({ 'src/App.tsx': appTsx, 'src/index.css': `/* @tailwind base; */\n.x { color: red; }\n` })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'padding', value: '16px' }]))
    expect(r.body.edits[0].newContent).toContain(`style={{ padding: "16px" }}`)
    expect(r.body.edits[0].newContent).not.toContain('className')
  })

  it('detects Tailwind v4 from package.json dependencies', async () => {
    const p = makeProject({ 'src/App.tsx': appTsx })
    fs.writeFileSync(path.join(p.root, 'package.json'), JSON.stringify({ name: 'fixture', devDependencies: { tailwindcss: '^4.0.0' } }))
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'padding', value: '16px' }]))
    expect(r.body.edits[0].newContent).toContain('className="p-4"')
  })

  it('defaults to inline when nothing marks the host as Tailwind', async () => {
    const p = makeProject({ 'src/App.tsx': appTsx })
    const r = await call(p.handlers.styleEdit, styleEditBody(p, 'src/App.tsx', appTsx, '<div', 'div', [{ property: 'padding', value: '16px' }]))
    expect(r.body.edits[0].newContent).toContain(`style={{ padding: "16px" }}`)
  })
})

// ---- /write boundary ------------------------------------------------------------------

describe('/write src/ boundary', () => {
  it('writes an existing file under src/', async () => {
    const p = makeProject({ 'src/App.tsx': 'export const x = 1\n' })
    const r = await call(p.handlers.write, { files: [{ fileName: p.abs('src/App.tsx'), newContent: 'export const x = 2\n' }] })
    expect(r.status).toBe(200)
    expect(p.read('src/App.tsx')).toBe('export const x = 2\n')
  })

  it('refuses a file outside src/', async () => {
    const p = makeProject({ 'src/App.tsx': 'export const x = 1\n' })
    const r = await call(p.handlers.write, { files: [{ fileName: path.join(p.root, 'package.json'), newContent: '{}' }] })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('must be an existing file under src/')
  })

  it('refuses a traversal that escapes src/ through a relative path', async () => {
    const p = makeProject({ 'src/App.tsx': 'export const x = 1\n' })
    const r = await call(p.handlers.write, { files: [{ fileName: p.abs('src/../package.json'), newContent: '{}' }] })
    expect(r.status).toBe(400)
  })

  it('refuses a non-existent target (no file creation through /write)', async () => {
    const p = makeProject({ 'src/App.tsx': 'export const x = 1\n' })
    const r = await call(p.handlers.write, { files: [{ fileName: p.abs('src/new.tsx'), newContent: 'x' }] })
    expect(r.status).toBe(400)
  })

  it('validates every file before writing any (all-or-nothing)', async () => {
    const p = makeProject({ 'src/App.tsx': 'export const x = 1\n' })
    const r = await call(p.handlers.write, {
      files: [
        { fileName: p.abs('src/App.tsx'), newContent: 'export const x = 2\n' },
        { fileName: path.join(p.root, 'package.json'), newContent: '{}' },
      ],
    })
    expect(r.status).toBe(400)
    expect(p.read('src/App.tsx')).toBe('export const x = 1\n') // first file untouched
  })
})

// ---- text edit: CRLF end to end ---------------------------------------------------------

describe('/text-edit CRLF preservation', () => {
  it('swaps only the visible text and keeps CRLF line breaks', async () => {
    const tsx = crlf(`export const App = () => (\n  <h1 className="title">\n    Hello world\n  </h1>\n)\n`)
    const p = makeProject({ 'src/App.tsx': tsx })
    const { line, column } = locOf(tsx, '<h1')
    const r = await call(p.handlers.textEdit, {
      edits: [{ fileName: p.abs('src/App.tsx'), line, column, tag: 'h1', text: 'Hello Muse' }],
    })
    expect(r.body.edits).toHaveLength(1)
    expect(r.body.edits[0].newContent).toBe(tsx.replace('Hello world', 'Hello Muse'))
    expect(r.body.edits[0].newContent).not.toMatch(/[^\r]\n/)
  })
})
