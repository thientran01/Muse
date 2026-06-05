// ============================================================
//  MUSE STANDALONE SERVER  —  framework-agnostic backend
// ------------------------------------------------------------
//  A thin Node http server wrapping server/museCore.ts. Run this as a separate
//  process alongside any bundler/framework (Next.js, webpack, Parcel, …). The
//  host app fetches /api/muse/* cross-origin; this server adds CORS headers so
//  any localhost origin can call it.
//
//  Usage:
//    MUSE_ROOT=/path/to/your/project npx tsx server/standaloneServer.ts
//    # or after compiling:
//    node dist-server/standaloneServer.js
//
//  Environment variables (all optional except MUSE_ROOT if cwd ≠ project root):
//    MUSE_ROOT          Project root (default: cwd)
//    MUSE_PORT          Port to listen on (default: 4747)
//    MUSE_HOST          Interface to bind (default: 127.0.0.1 — localhost only)
//    MUSE_CORS_ORIGIN   Allowed origin (default: localhost-only; set to "*" to allow any)
// ============================================================
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMuseContext, createMuseHandlers, type Handler } from './museCore'

const port = parseInt(process.env.MUSE_PORT ?? '4747', 10)
// Bind to localhost by default. This server has NO authentication and rewrites
// source files on disk, so binding all interfaces (0.0.0.0/::) would let anyone on
// the same network hit the write endpoints. MUSE_HOST opts into a wider bind (e.g.
// '0.0.0.0' for a remote dev box) only when the user explicitly needs LAN access.
const host = process.env.MUSE_HOST ?? '127.0.0.1'
// Loopback binds are safe (reachable only from this machine); anything else is
// exposed on a network interface and gets a warning. ::1 is IPv6 loopback — an
// escape hatch on systems where `localhost` resolves to ::1 before 127.0.0.1.
const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
const root = process.env.MUSE_ROOT ?? process.cwd()
// MUSE_CORS_ORIGIN overrides the default. Without it, only localhost/127.0.0.1 origins
// are allowed — this prevents a malicious tab from writing to source files via the
// write endpoints. Set MUSE_CORS_ORIGIN='*' to revert to permissive (old default).
const corsOverride = process.env.MUSE_CORS_ORIGIN ?? null
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const ctx = createMuseContext(process.env as Record<string, string | undefined>, root)
const handlers = createMuseHandlers(ctx)

function addCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin ?? ''
  if (corsOverride) {
    // Explicit env override: use as-is (e.g. MUSE_CORS_ORIGIN='*' for permissive dev).
    res.setHeader('Access-Control-Allow-Origin', corsOverride)
  } else if (!origin || LOCALHOST_RE.test(origin)) {
    // Default: allow localhost origins only; no-origin (same-origin) requests pass too.
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  // No ACAO header for other origins → browser blocks the request.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// Map "METHOD /path" → handler (exact key lookup).
const ROUTES = new Map<string, Handler>([
  ['POST /api/muse/write',           handlers.write],
  ['POST /api/muse/style-edit',      handlers.styleEdit],
  ['POST /api/muse/style-scope',     handlers.styleScope],
  ['POST /api/muse/text-edit',       handlers.textEdit],
  ['POST /api/muse/text-editable',   handlers.textEditable],
  ['POST /api/muse/reorder',         handlers.reorder],
  ['POST /api/muse/reorderable',     handlers.reorderable],
  ['GET /api/muse/tokens',           handlers.tokens],
  ['POST /api/muse/token-edit',      handlers.tokenEdit],
])

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  addCors(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = (req.url ?? '/').split('?')[0]
  const handler = ROUTES.get(`${req.method} ${url}`)

  if (!handler) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  try {
    await handler(req, res)
  } catch (err) {
    // Handlers catch their own errors internally; this is a last-resort guard.
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: (err as Error).message ?? String(err) }))
    }
  }
})

server.listen(port, host, () => {
  console.log(`[muse] standalone server  http://${host}:${port}`)
  console.log(`[muse] bind              ${host}${isLoopback ? ' (localhost only)' : ''}`)
  console.log(`[muse] root              ${root}`)
  console.log(`[muse] cors origin       ${corsOverride ?? 'localhost-only (default)'}`)
  if (!corsOverride) console.log(`[muse] tip: set MUSE_CORS_ORIGIN='*' to allow any dev origin`)
  if (!isLoopback) {
    console.log(`[muse] warning: bound to ${host} — no auth + writes to disk; expose only on trusted networks`)
  }
})
