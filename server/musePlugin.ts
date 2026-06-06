// ============================================================
//  MUSE BACKEND  —  Vite dev-server adapter
// ------------------------------------------------------------
//  Thin wrapper over server/museCore.ts. Registers the /api/muse/* endpoints
//  as Connect middleware on the Vite dev server (same-origin, no CORS).
//
//  For non-Vite hosts (Next.js, webpack, …) use server/standaloneServer.ts
//  instead, which wraps the same core with a standalone Node http server and
//  CORS support.
// ============================================================
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { createMuseContext, createMuseHandlers } from './museCore'

export function musePlugin(): Plugin {
  let ctx: ReturnType<typeof createMuseContext> | null = null

  return {
    name: 'muse-backend',
    apply: 'serve', // dev server only
    configResolved(config) {
      const viteEnv = loadEnv(config.mode, config.root, '')
      // Vite .env files take precedence over the ambient process.env (same as
      // the previous implementation's `env.X || process.env.X || ''` pattern).
      const env: Record<string, string | undefined> = { ...process.env, ...viteEnv }
      ctx = createMuseContext(env, config.root)
    },
    configureServer(server) {
      if (!ctx) return
      const handlers = createMuseHandlers(ctx)

      server.middlewares.use('/api/muse/write', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.write(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/style-edit', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.styleEdit(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/style-scope', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.styleScope(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/text-edit', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.textEdit(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/text-editable', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.textEditable(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/reorder', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.reorder(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/reorderable', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.reorderable(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/token-edit', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.tokenEdit(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/tokens', (req, res, next) => {
        if (req.method !== 'GET') return next()
        handlers.tokens(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/flag', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.flag(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/flags', (req, res, next) => {
        if (req.method !== 'GET') return next()
        handlers.flags(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/flag-resolve', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.flagResolve(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/flag-delete', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.flagDelete(req, res).catch(() => {})
      })
    },
  }
}
