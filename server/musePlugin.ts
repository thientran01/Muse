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

      // Register more-specific paths before less-specific ones so Connect's
      // prefix matching doesn't swallow /design/generate into /design.
      server.middlewares.use('/api/muse/design/generate', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.designGenerate(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/design', (req, res, next) => {
        if (req.method !== 'GET') return next()
        handlers.design(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/chat', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.chat(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/observe', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.observe(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/write', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.write(req, res).catch(() => {})
      })
      server.middlewares.use('/api/muse/style-edit', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handlers.styleEdit(req, res).catch(() => {})
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
    },
  }
}
