// ============================================================
//  MUSE STANDALONE SERVER  —  framework-agnostic backend
// ------------------------------------------------------------
//  A thin Node http server wrapping server/museCore.ts. Run this as a separate
//  process alongside any bundler/framework (Next.js, webpack, Parcel, …). The
//  host app fetches /api/muse/* cross-origin; this server adds CORS headers so
//  any localhost origin can call it.
//
//  Two ways to use it:
//    • As a script (dev):
//        MUSE_ROOT=/path/to/your/project npx tsx server/standaloneServer.ts
//      It auto-starts (see the main-module guard at the bottom).
//    • Programmatically — `startStandaloneServer({ root, port })` — which is what
//      the `@thientran01/muse/standalone` package entry re-exports. Importing this
//      module does NOT start a server (the guard only fires when run directly).
//
//  Environment variables (used as fallbacks when the matching option is omitted):
//    MUSE_ROOT          Project root (default: cwd)
//    MUSE_PORT          Port to listen on (default: 4747)
//    MUSE_HOST          Interface to bind (default: 127.0.0.1 — localhost only)
//    MUSE_CORS_ORIGIN   Allowed origin (default: localhost-only; set to "*" to allow any)
// ============================================================
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createMuseContext, createMuseHandlers, isAllowedOrigin, type Handler } from './museCore'

export type StandaloneOptions = {
  /** Port to listen on. Default: MUSE_PORT or 4747. */
  port?: number
  /** Interface to bind. Default: MUSE_HOST or 127.0.0.1 (localhost only). */
  host?: string
  /** Project root Muse reads/writes under. Default: MUSE_ROOT or process.cwd(). */
  root?: string
  /** Allowed request origin ('*' for any). Default: MUSE_CORS_ORIGIN or localhost-only. */
  corsOrigin?: string | null
}

/**
 * Start the framework-agnostic Muse backend on a Node http server and return it
 * (so the caller can `.close()`). Every option falls back to its env var, then a
 * default. NO authentication — it rewrites source on disk; keep it on localhost.
 */
export function startStandaloneServer(opts: StandaloneOptions = {}): http.Server {
  const port = opts.port ?? parseInt(process.env.MUSE_PORT ?? '4747', 10)
  // Bind to localhost by default. This server has NO authentication and rewrites
  // source files on disk, so binding all interfaces (0.0.0.0/::) would let anyone on
  // the same network hit the write endpoints. Opt into a wider bind (e.g. '0.0.0.0'
  // for a remote dev box) only when LAN access is genuinely needed.
  const host = opts.host ?? process.env.MUSE_HOST ?? '127.0.0.1'
  // Loopback binds are safe (reachable only from this machine); anything else is
  // exposed on a network interface and gets a warning. ::1 is IPv6 loopback.
  const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  const root = opts.root ?? process.env.MUSE_ROOT ?? process.cwd()
  const corsSetting = opts.corsOrigin ?? process.env.MUSE_CORS_ORIGIN ?? null

  // The allow/deny decision lives in ctx.originPolicy, derived from MUSE_CORS_ORIGIN
  // inside createMuseContext — thread an explicit opts.corsOrigin through that key so
  // there is ONE source of origin truth shared by this CORS layer and the guard.
  const env = { ...process.env } as Record<string, string | undefined>
  if (corsSetting !== null) env.MUSE_CORS_ORIGIN = corsSetting
  const ctx = createMuseContext(env, root)
  const handlers = createMuseHandlers(ctx)

  // Echo Access-Control-Allow-Origin only for origins the shared policy allows (from
  // MUSE_CORS_ORIGIN; loopback — incl. [::1] — always allowed). A disallowed origin gets
  // no ACAO (browser blocks the response) AND is rejected server-side by createMuseHandlers'
  // guard, so the two layers agree. Muse sends no cookies, so '*' for the same-origin /
  // non-browser (no Origin) case is safe.
  function addCors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin
    if (ctx.originPolicy.allowAnyOrigin) {
      res.setHeader('Access-Control-Allow-Origin', '*')
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', '*')
    } else if (isAllowedOrigin(origin, ctx.originPolicy)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
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
    ['POST /api/muse/flag',            handlers.flag],
    ['GET /api/muse/flags',            handlers.flags],
    ['POST /api/muse/flag-resolve',    handlers.flagResolve],
    ['POST /api/muse/flag-delete',     handlers.flagDelete],
    ['POST /api/muse/share-probe',     handlers.shareProbe],
    ['POST /api/muse/share',           handlers.share],
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
    console.log(`[muse] cors origin       ${corsSetting ?? 'localhost-only (default)'}`)
    if (!corsSetting) console.log(`[muse] tip: set MUSE_CORS_ORIGIN='*' to allow any dev origin`)
    if (!isLoopback) {
      console.log(`[muse] warning: bound to ${host} — no auth + writes to disk; expose only on trusted networks`)
    }
  })

  return server
}

// Auto-start ONLY when executed directly (`npm run muse-server` / `npx tsx
// server/standaloneServer.ts`), never when imported — so re-exporting the factory
// from the npm package (@thientran01/muse/standalone) doesn't spin up a server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandaloneServer()
}
