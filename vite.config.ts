import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { musePlugin } from './server/musePlugin'

// @vitejs/plugin-react injects JSX source info in dev mode, so every React
// fiber carries `_debugSource` (fileName/lineNumber). Muse uses that for
// element -> source mapping. See src/muse/sourceLocation.ts.
// musePlugin() adds the /api/muse/* endpoints to the dev server.
//
// `--mode demo` builds the HOSTED demo (a static site, no backend). Canvas
// selection still needs `_debugSource`, which a normal production build strips
// (it switches React to the prod jsx runtime). Forcing NODE_ENV=development for
// this build keeps the dev jsx runtime (jsxDEV) + dev React, so fibers carry
// `_debugSource` at runtime even in the built `dist/`. Verified: a built
// `vite preview` resolves real file/line/column on fibers. Cost: dev React in
// the bundle (larger, unminified) — fine for a demo. Edits are ephemeral anyway
// (VITE_MUSE_EPHEMERAL in .env.demo), so the absolute paths never hit disk.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  // Force the dev jsx runtime two ways for robustness: set NODE_ENV before Vite
  // computes isProduction (picks dev React + the jsxDEV transform that carries
  // _debugSource), AND pin the client-side replacement so React's own runtime
  // checks stay in dev even if Vite's env-timing changes across versions.
  if (demo) process.env.NODE_ENV = 'development'
  return {
    plugins: [react(), musePlugin()],
    ...(demo ? { define: { 'process.env.NODE_ENV': '"development"' } } : {}),
  }
})
