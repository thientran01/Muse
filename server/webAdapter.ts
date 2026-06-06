// ============================================================
//  MUSE WEB ADAPTER  —  Web-standard Request/Response over museCore
// ------------------------------------------------------------
//  museCore's handlers are written against Node's http (IncomingMessage /
//  ServerResponse). Next.js App Router route handlers (and Remix, Hono, and any
//  WinterCG runtime) speak the Web standard instead: (req: Request) => Response.
//  This adapter bridges the two so a Next host gets a SAME-ORIGIN backend with no
//  separate process and no CORS — the cleanest dogfood path.
//
//  Usage in a Next.js app — app/api/muse/[...muse]/route.ts:
//
//    import { createMuseContext } from '@/muse-server/museCore'
//    import { createMuseWebRouter } from '@/muse-server/webAdapter'
//
//    export const runtime = 'nodejs'        // museCore uses fs/child_process
//    const ctx = createMuseContext(process.env, process.cwd())
//    const router = createMuseWebRouter(ctx)
//    export async function GET(req: Request)  { return router(req) }
//    export async function POST(req: Request) { return router(req) }
//
//  Gate the route to development in the host (Muse writes to source on disk):
//    if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 })
//
//  NOTE: this must run in the Node.js runtime, never the Edge runtime — museCore
//  reads/writes files and spawns the claude CLI. App Router defaults to Node, but
//  the explicit `export const runtime = 'nodejs'` above documents the requirement.
// ============================================================
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMuseHandlers, type MuseContext, type Handler } from './museCore'

// Method+path → handler. Mirrors standaloneServer's ROUTES so the two adapters
// expose an identical surface. Exact-match lookup (no Connect-style prefixing).
function buildRoutes(ctx: MuseContext): Map<string, Handler> {
  const h = createMuseHandlers(ctx)
  return new Map<string, Handler>([
    ['POST /api/muse/write', h.write],
    ['POST /api/muse/style-edit', h.styleEdit],
    ['POST /api/muse/style-scope', h.styleScope],
    ['POST /api/muse/text-edit', h.textEdit],
    ['POST /api/muse/text-editable', h.textEditable],
    ['POST /api/muse/reorder', h.reorder],
    ['POST /api/muse/reorderable', h.reorderable],
    ['GET /api/muse/tokens', h.tokens],
    ['POST /api/muse/token-edit', h.tokenEdit],
    ['POST /api/muse/flag', h.flag],
    ['GET /api/muse/flags', h.flags],
    ['POST /api/muse/flag-resolve', h.flagResolve],
    ['POST /api/muse/flag-delete', h.flagDelete],
  ])
}

// A ServerResponse-shaped sink that captures what a handler writes and resolves a
// `done` promise when the handler calls res.end(). museCore handlers only touch
// statusCode / setHeader / end / headersSent, so we implement exactly that subset.
class ResponseSink {
  statusCode = 200
  headersSent = false
  private headers = new Headers()
  private chunks: string[] = []
  readonly done: Promise<void>
  private resolve!: () => void

  constructor() {
    this.done = new Promise((r) => (this.resolve = r))
  }

  setHeader(name: string, value: string | number | string[]): void {
    this.headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
  }

  end(chunk?: string): void {
    if (this.headersSent) return
    if (chunk != null) this.chunks.push(String(chunk))
    this.headersSent = true
    this.resolve()
  }

  toResponse(): Response {
    return new Response(this.chunks.join('') || null, {
      status: this.statusCode,
      headers: this.headers,
    })
  }
}

// Read the Web Request body once, then expose it as a Node Readable carrying the
// extra IncomingMessage fields museCore reads. readBody() consumes the stream's
// 'data'/'end' events; the other fields are set for completeness.
async function toNodeRequest(req: Request): Promise<IncomingMessage> {
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text()
  const stream = Readable.from(body ? [body] : []) as unknown as IncomingMessage
  const url = new URL(req.url)
  stream.url = url.pathname + url.search
  stream.method = req.method
  stream.headers = Object.fromEntries(req.headers) as IncomingMessage['headers']
  return stream
}

/** Run a single museCore handler against a Web Request, returning a Web Response. */
export async function runHandlerWeb(handler: Handler, req: Request): Promise<Response> {
  const nodeReq = await toNodeRequest(req)
  const sink = new ResponseSink()
  const res = sink as unknown as ServerResponse
  // Wait on sink.done (res.end), NOT the handler's returned promise — a handler
  // can finish writing its response from a callback that fires after the async
  // function returns, so res.end is the reliable completion signal.
  handler(nodeReq, res).catch((err) => {
    if (!sink.headersSent) {
      sink.statusCode = 500
      sink.setHeader('content-type', 'application/json')
      sink.end(JSON.stringify({ error: (err as Error)?.message ?? String(err) }))
    }
  })
  await sink.done
  return sink.toResponse()
}

/**
 * Build a Web-standard router over museCore: (req: Request) => Promise<Response>.
 * Routes by "METHOD /pathname"; unknown routes 404. Same-origin (the host serves
 * it), so no CORS — for cross-origin use the standalone server instead.
 */
export function createMuseWebRouter(ctx: MuseContext): (req: Request) => Promise<Response> {
  const routes = buildRoutes(ctx)
  return async (req: Request): Promise<Response> => {
    const pathname = new URL(req.url).pathname
    const handler = routes.get(`${req.method} ${pathname}`)
    if (!handler) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    return runHandlerWeb(handler, req)
  }
}
