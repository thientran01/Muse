// ============================================================
//  CONFIG — the flags are read LAZILY, and that is the whole point
// ------------------------------------------------------------
//  The REGRESSION PINS below — every test in the two describe blocks about lazy
//  reads — are written to FAIL against the pre-fix code, where MOCK and EPHEMERAL
//  were `export const` resolved once at import. That is the bar: a test that
//  passes both before and after proves nothing about the bug it claims to pin.
//  Verified by simulating the pre-fix module, not by assuming.
//
//  Exactly ONE test here is not a regression pin — "keeps an explicit empty
//  configureMuse() value" — and it says so at its site. It guards a different and
//  still-live hazard (a `||` fall-through, where '' is falsy). Labelled honestly
//  because a test file claiming a uniform bar it doesn't meet is worse than one
//  that states its mix. The other nine were each checked against a simulated
//  pre-fix module and do fail there.
//
//  The bug: the live case study's overlay chunk shipped as `<script async>`,
//  which executes as soon as it downloads regardless of parser position, so it
//  ran BEFORE the page's inline `window.__MUSE__ = { ephemeral: true }` script.
//  With the value snapshotted at import, losing that race latched the overlay
//  into real-backend mode for the entire session — 49 failed API calls on a host
//  with no backend. It never reproduced locally, because localhost parses the
//  HTML faster than a chunk arrives.
//
//  So the import below deliberately happens FIRST, before any test sets anything.
//  That import order IS the regression scenario.
// ============================================================
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEphemeral, isMock } from '../config'
import { parseJson } from '../api'

// The module is imported; nothing has been configured yet. Exactly the state the
// overlay is in when a host's config script has not run.

type MuseGlobalShape = { mock?: boolean; ephemeral?: boolean; apiBase?: string }

const setHostGlobal = (v: MuseGlobalShape | undefined) => {
  // The overlay reads `window.__MUSE__`; in the node environment there is no
  // window until a test creates one, which is the same thing a host does.
  ;(globalThis as { window?: unknown }).window = v === undefined ? undefined : { __MUSE__: v }
}

afterEach(() => {
  setHostGlobal(undefined)
  delete (globalThis as { window?: unknown }).window
  delete process.env.MUSE_EPHEMERAL
  delete process.env.MUSE_MOCK
  delete process.env.MUSE_API_BASE
})

// A configureMuse() override is module state and is deliberately permanent —
// there is no un-configure, because an explicit host decision should stick. So a
// test that needs the ambient path back gets a genuinely fresh module rather than
// a reset call the product doesn't have.
async function freshConfig() {
  vi.resetModules()
  return import('../config')
}

describe('config flags are read per call, not snapshotted at import', () => {
  it('picks up window.__MUSE__ set AFTER the module was imported', () => {
    // The production path. Pre-fix this returned false forever.
    expect(isEphemeral()).toBe(false)
    setHostGlobal({ ephemeral: true })
    expect(isEphemeral()).toBe(true)
  })

  it('picks up a host global for MOCK set after import', () => {
    expect(isMock()).toBe(false)
    setHostGlobal({ mock: true })
    expect(isMock()).toBe(true)
  })

  it('picks up process.env set after import', () => {
    expect(isEphemeral()).toBe(false)
    process.env.MUSE_EPHEMERAL = '1'
    expect(isEphemeral()).toBe(true)
  })

  it('goes back to false when the host global is removed', () => {
    setHostGlobal({ ephemeral: true })
    expect(isEphemeral()).toBe(true)
    setHostGlobal(undefined)
    expect(isEphemeral()).toBe(false)
  })

  it('lets an explicit host global of false beat an env var of 1', () => {
    // Precedence is unchanged by the lazy read and must stay unchanged: a host
    // that says `{ ephemeral: false }` means it, even under MUSE_EPHEMERAL=1.
    process.env.MUSE_EPHEMERAL = '1'
    expect(isEphemeral()).toBe(true)
    setHostGlobal({ ephemeral: false })
    expect(isEphemeral()).toBe(false)
  })

  it('treats only the exact string "1" as on', () => {
    process.env.MUSE_EPHEMERAL = 'true'
    expect(isEphemeral()).toBe(false)
    process.env.MUSE_EPHEMERAL = '1'
    expect(isEphemeral()).toBe(true)
  })
})

describe('getApiBase reads ambient config lazily too', () => {
  it('picks up window.__MUSE__.apiBase set after import', async () => {
    // This one was NOT in the incident report — apiBase was snapshotted in the
    // same object literal as the flags, so a host setting both after load got
    // ephemeral honored and apiBase silently dropped.
    const { getApiBase } = await freshConfig()
    expect(getApiBase()).toBe('')
    setHostGlobal({ apiBase: 'http://localhost:4747' })
    expect(getApiBase()).toBe('http://localhost:4747')
  })

  it('strips trailing slashes from an ambient value', async () => {
    const { getApiBase } = await freshConfig()
    setHostGlobal({ apiBase: 'http://localhost:4747///' })
    expect(getApiBase()).toBe('http://localhost:4747')
  })

  it('lets an explicit configureMuse() call win over the ambient value', async () => {
    const { configureMuse, getApiBase } = await freshConfig()
    setHostGlobal({ apiBase: 'http://ambient:1111' })
    expect(getApiBase()).toBe('http://ambient:1111')
    configureMuse({ apiBase: 'http://explicit:2222' })
    expect(getApiBase()).toBe('http://explicit:2222')
  })

  it('keeps an explicit empty configureMuse() value rather than falling back', async () => {
    // NOT a regression pin — this passes against the pre-fix module too (verified
    // by simulating it: the old code snapshotted '' at import, then configureMuse
    // overwrote it with '', so the ambient value never got a chance to matter).
    //
    // It guards a DIFFERENT hazard, and a live one: '' is a meaningful choice
    // (same-origin), not "unset". Write the fall-through as `state.apiBase || …`
    // instead of the null check and this goes red, because '' is falsy and the
    // ambient 'http://ambient:1111' wins — a real bug, and the obvious refactor.
    // The fresh module matters too: without it the previous test's override would
    // still be set and this would pass for the wrong reason.
    const { configureMuse, getApiBase } = await freshConfig()
    setHostGlobal({ apiBase: 'http://ambient:1111' })
    configureMuse({ apiBase: '' })
    expect(getApiBase()).toBe('')
  })
})

describe('parseJson turns a non-JSON body into something a designer can act on', () => {
  it('does not leak a raw SyntaxError for a plain-text body', async () => {
    // The live failure: the host's catch-all route answered `Not found` as
    // text/plain, res.json() threw, and CanvasMode piped the raw message into its
    // toast — the user saw "JSON.parse: unexpected character at line 1 column 1".
    const mk = () =>
      new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    await expect(parseJson(mk())).rejects.toThrow(/non-JSON response \(HTTP 404\)/)
    // A body can only be read once, so this needs its own Response, not a clone.
    await expect(parseJson(mk())).rejects.not.toThrow(
      /JSON\.parse|unexpected character|Unexpected token/,
    )
  })

  it('names the status so the failure stays diagnosable', async () => {
    const res = new Response('<!doctype html><title>502</title>', { status: 502 })
    await expect(parseJson(res)).rejects.toThrow(/HTTP 502/)
  })

  it('rejects an empty body rather than returning undefined', async () => {
    // A 204 with no body would otherwise resolve to undefined and surface as a
    // confusing property access downstream. (The Response constructor requires a
    // null body for 204 — an empty string is not a legal 204.)
    await expect(parseJson(new Response(null, { status: 204 }))).rejects.toThrow(/non-JSON response/)
  })

  it('gives a readable message when the body cannot be read at all', async () => {
    // An aborted fetch or a stream error rejects res.text() itself. That happens
    // BEFORE any parsing, so it is not covered by the JSON.parse guard — it needs
    // its own, or the raw rejection reaches the toast exactly like the original bug.
    const broken = {
      status: 500,
      text: () => Promise.reject(new TypeError('network error')),
    } as unknown as Response
    await expect(parseJson(broken)).rejects.toThrow(/could not be read \(HTTP 500\)/)
    await expect(parseJson(broken)).rejects.not.toThrow(/network error/)
  })

  it('returns the parsed value for a valid JSON body', async () => {
    const res = new Response(JSON.stringify({ ok: true, edits: [] }), { status: 200 })
    await expect(parseJson<{ ok: boolean; edits: unknown[] }>(res)).resolves.toEqual({ ok: true, edits: [] })
  })

  it('passes a JSON error body through so the caller can read its error field', async () => {
    // A 400 from the engine still carries the designed { error } shape — parseJson
    // must not swallow it just because the status is not ok.
    const res = new Response(JSON.stringify({ error: 'not an editable file under src/' }), { status: 400 })
    await expect(parseJson<{ error: string }>(res)).resolves.toEqual({
      error: 'not an editable file under src/',
    })
  })
})
