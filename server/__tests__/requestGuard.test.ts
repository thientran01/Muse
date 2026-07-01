// ============================================================
//  Request guard — Origin allowlist + Content-Type on writes
// ------------------------------------------------------------
//  Muse rewrites source on POST while loaded next to a dev server, so a drive-by
//  page must not be able to reach the write endpoints. Two layers:
//    • guardRequest / isAllowedOrigin — the pure decision (vectors below).
//    • createMuseHandlers wiring — a blocked request returns 403/415 and NEVER
//      touches disk; an allowed one writes. Proven end to end on a tmp project.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createMuseContext,
  createMuseHandlers,
  guardRequest,
  isAllowedOrigin,
  type MuseHandlers,
  type OriginPolicy,
} from '../museCore'
import { createMuseWebRouter } from '../webAdapter'

const LOOPBACK: OriginPolicy = { allowAnyOrigin: false, extraOrigin: null }

// ---- pure decision --------------------------------------------------------------

describe('isAllowedOrigin', () => {
  it('accepts every loopback origin form (host, port, scheme, ::1)', () => {
    for (const o of [
      'http://localhost',
      'http://localhost:5173',
      'https://localhost:3000',
      'http://127.0.0.1',
      'http://127.0.0.1:4747',
      'http://[::1]:8080',
    ]) {
      expect(isAllowedOrigin(o, LOOPBACK)).toBe(true)
    }
  })

  it('rejects non-loopback and loopback-lookalike origins', () => {
    for (const o of [
      'http://evil.com',
      'https://myapp.com',
      'http://localhost.evil.com', // suffix attack — must not match
      'http://127.0.0.1.evil.com',
      'http://notlocalhost:5173',
      'null', // opaque origin (sandboxed iframe / file://)
    ]) {
      expect(isAllowedOrigin(o, LOOPBACK)).toBe(false)
    }
  })

  it('honors the operator opt-ins (allowAnyOrigin, extraOrigin)', () => {
    expect(isAllowedOrigin('http://evil.com', { allowAnyOrigin: true, extraOrigin: null })).toBe(true)
    const lan: OriginPolicy = { allowAnyOrigin: false, extraOrigin: 'http://192.168.1.5:5173' }
    expect(isAllowedOrigin('http://192.168.1.5:5173', lan)).toBe(true)
    expect(isAllowedOrigin('http://192.168.1.6:5173', lan)).toBe(false) // only the exact one
  })
})

describe('guardRequest', () => {
  const json = { 'content-type': 'application/json' } as IncomingMessage['headers']

  it('allows a same-origin loopback POST with JSON', () => {
    expect(guardRequest('POST', { origin: 'http://localhost:5173', ...json }, LOOPBACK)).toEqual({ ok: true })
  })

  it('allows a POST with no Origin (curl / non-browser) — not a CSRF vector', () => {
    expect(guardRequest('POST', json, LOOPBACK)).toEqual({ ok: true })
  })

  it('rejects a cross-origin POST with 403 even when the body is JSON', () => {
    const r = guardRequest('POST', { origin: 'http://evil.com', ...json }, LOOPBACK)
    expect(r).toEqual({ ok: false, status: 403, error: 'Origin not allowed.' })
  })

  it('rejects a non-JSON POST with 415 (the text/plain preflight-skip vector)', () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', undefined]) {
      const r = guardRequest('POST', { origin: 'http://localhost:5173', 'content-type': ct } as IncomingMessage['headers'], LOOPBACK)
      expect(r).toEqual({ ok: false, status: 415, error: 'Content-Type must be application/json.' })
    }
  })

  it('accepts a charset-suffixed JSON content-type, case-insensitively', () => {
    expect(guardRequest('POST', { 'content-type': 'Application/JSON; charset=utf-8' } as IncomingMessage['headers'], LOOPBACK)).toEqual({ ok: true })
  })

  it('rejects a non-json media type whose token merely starts with application/json', () => {
    // `\b` would let these through; the media type must END at `application/json`.
    for (const ct of ['application/json-patch+json', 'application/jsonx', 'application/json5']) {
      const r = guardRequest('POST', { 'content-type': ct } as IncomingMessage['headers'], LOOPBACK)
      expect(r).toEqual({ ok: false, status: 415, error: 'Content-Type must be application/json.' })
    }
  })

  it('applies the Origin check to GET but skips the content-type requirement', () => {
    expect(guardRequest('GET', {}, LOOPBACK)).toEqual({ ok: true }) // same-origin GET omits Origin
    expect(guardRequest('GET', { origin: 'http://evil.com' }, LOOPBACK)).toEqual({ ok: false, status: 403, error: 'Origin not allowed.' })
  })

  it('checks Origin before Content-Type (403 wins on a doubly-bad request)', () => {
    const r = guardRequest('POST', { origin: 'http://evil.com', 'content-type': 'text/plain' } as IncomingMessage['headers'], LOOPBACK)
    expect(r.ok).toBe(false)
    expect((r as { status: number }).status).toBe(403)
  })
})

// ---- end to end through createMuseHandlers -------------------------------------

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

function newRoot(): { root: string; read: () => string; abs: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-guard-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), ORIGINAL)
  return {
    root,
    read: () => fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8'),
    abs: path.join(root, 'src', 'App.tsx'),
  }
}

function makeProject(env: Record<string, string | undefined> = {}): {
  handlers: MuseHandlers
  read: () => string
  abs: string
} {
  const r = newRoot()
  return { handlers: createMuseHandlers(createMuseContext(env, r.root)), read: r.read, abs: r.abs }
}

const ORIGINAL = 'export const x = 1\n'
const EDITED = 'export const x = 2\n'

function fakeReq(body: unknown, method: string, headers: Record<string, string>): IncomingMessage {
  const r = new Readable({ read() {} })
  r.push(JSON.stringify(body))
  r.push(null)
  const im = r as unknown as IncomingMessage
  im.method = method
  im.headers = headers as IncomingMessage['headers']
  return im
}

async function callWrite(
  p: ReturnType<typeof makeProject>,
  headers: Record<string, string>,
  method = 'POST',
): Promise<{ status: number; body: any }> {
  const out = { status: 0, body: null as any }
  const res = {
    statusCode: 200,
    setHeader() {},
    end(s: string) {
      out.status = (res as { statusCode: number }).statusCode
      out.body = s ? JSON.parse(s) : null
    },
  } as unknown as ServerResponse
  const body = { files: [{ fileName: p.abs, newContent: EDITED }] }
  await p.handlers.write(fakeReq(body, method, headers), res)
  return out
}

describe('createMuseHandlers wiring — a blocked write never reaches disk', () => {
  it('writes when the request is a loopback JSON POST', async () => {
    const p = makeProject()
    const r = await callWrite(p, { origin: 'http://localhost:5173', 'content-type': 'application/json' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(p.read()).toBe(EDITED)
  })

  it('rejects a cross-origin POST with 403 and leaves the file untouched', async () => {
    const p = makeProject()
    const r = await callWrite(p, { origin: 'http://evil.com', 'content-type': 'application/json' })
    expect(r.status).toBe(403)
    expect(p.read()).toBe(ORIGINAL) // the whole point: no drive-by write
  })

  it('rejects a text/plain POST with 415 and leaves the file untouched', async () => {
    const p = makeProject()
    const r = await callWrite(p, { origin: 'http://localhost:5173', 'content-type': 'text/plain' })
    expect(r.status).toBe(415)
    expect(p.read()).toBe(ORIGINAL)
  })

  it('rejects a POST with no Content-Type at all', async () => {
    const p = makeProject()
    const r = await callWrite(p, { origin: 'http://localhost:5173' })
    expect(r.status).toBe(415)
    expect(p.read()).toBe(ORIGINAL)
  })

  it("MUSE_CORS_ORIGIN='*' opts into any origin", async () => {
    const p = makeProject({ MUSE_CORS_ORIGIN: '*' })
    const r = await callWrite(p, { origin: 'http://evil.com', 'content-type': 'application/json' })
    expect(r.status).toBe(200)
    expect(p.read()).toBe(EDITED)
  })

  it('MUSE_CORS_ORIGIN=<url> allowlists exactly that origin', async () => {
    const p = makeProject({ MUSE_CORS_ORIGIN: 'http://192.168.1.5:5173' })
    const ok = await callWrite(p, { origin: 'http://192.168.1.5:5173', 'content-type': 'application/json' })
    expect(ok.status).toBe(200)
    expect(p.read()).toBe(EDITED)

    const p2 = makeProject({ MUSE_CORS_ORIGIN: 'http://192.168.1.5:5173' })
    const blocked = await callWrite(p2, { origin: 'http://192.168.1.6:5173', 'content-type': 'application/json' })
    expect(blocked.status).toBe(403)
    expect(p2.read()).toBe(ORIGINAL)
  })
})

// ---- Next.js / Web adapter path (createMuseWebRouter → runHandlerWeb) -----------
// The guard is wired in createMuseHandlers, so the web adapter inherits it. This
// proves the rejection survives the Web Request → Node-shim → Web Response round-trip.

describe('web adapter (Next) inherits the guard', () => {
  const webWrite = async (env: Record<string, string | undefined>, origin: string) => {
    const r = newRoot()
    const router = createMuseWebRouter(createMuseContext(env, r.root))
    const res = await router(
      new Request('http://localhost/api/muse/write', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ files: [{ fileName: r.abs, newContent: EDITED }] }),
      }),
    )
    return { status: res.status, read: r.read }
  }

  it('returns a 403 Web Response for a cross-origin write and never touches disk', async () => {
    const { status, read } = await webWrite({}, 'http://evil.com')
    expect(status).toBe(403)
    expect(read()).toBe(ORIGINAL)
  })

  it('lets a loopback write through to a 200 Web Response', async () => {
    const { status, read } = await webWrite({}, 'http://localhost:5173')
    expect(status).toBe(200)
    expect(read()).toBe(EDITED)
  })
})
