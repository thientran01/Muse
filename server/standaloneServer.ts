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
//    MUSE_CORS_ORIGIN   Allowed origin (default: "*", restrict in production)
//    ANTHROPIC_API_KEY  For the /observe endpoint (Haiku) and api backend /chat
//    MUSE_BACKEND       "claude-cli" (default) | "anthropic"
//    MUSE_MODEL         Model for /chat anthropic backend
//    MUSE_CLI_MODEL     Model alias for /chat claude-cli backend
//    MUSE_OBSERVE_MODEL Model for /observe
//    MUSE_DESIGN_MD     Path to DESIGN.md override
//    MUSE_DESIGN_EXCLUDE Comma-separated terms to drop from design brief evidence
// ============================================================
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMuseContext, createMuseHandlers, type Handler } from './museCore'

const port = parseInt(process.env.MUSE_PORT ?? '4747', 10)
const root = process.env.MUSE_ROOT ?? process.cwd()
const corsOrigin = process.env.MUSE_CORS_ORIGIN ?? '*'

const ctx = createMuseContext(process.env as Record<string, string | undefined>, root)
const handlers = createMuseHandlers(ctx)

function addCors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// Map "METHOD /path" → handler. /design/generate must come before /design so the
// longer prefix wins (unlike Connect middleware, we do an exact key lookup).
const ROUTES = new Map<string, Handler>([
  ['POST /api/muse/chat',            handlers.chat],
  ['POST /api/muse/observe',         handlers.observe],
  ['POST /api/muse/write',           handlers.write],
  ['POST /api/muse/style-edit',      handlers.styleEdit],
  ['POST /api/muse/text-edit',       handlers.textEdit],
  ['POST /api/muse/text-editable',   handlers.textEditable],
  ['POST /api/muse/reorder',         handlers.reorder],
  ['POST /api/muse/reorderable',     handlers.reorderable],
  ['POST /api/muse/design/generate', handlers.designGenerate],
  ['GET /api/muse/design',           handlers.design],
])

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  addCors(res)

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

server.listen(port, () => {
  console.log(`[muse] standalone server  http://localhost:${port}`)
  console.log(`[muse] root              ${root}`)
  console.log(`[muse] backend           ${ctx.backend}`)
  console.log(`[muse] cors origin       ${corsOrigin}`)
})
