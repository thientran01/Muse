import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { musePlugin } from './server/musePlugin'
import { museLoc } from './server/babelPluginMuseLoc'

// musePlugin() adds the /api/muse/* endpoints to the dev server.
// museLoc stamps data-muse-loc="file:line:col" on every JSX opening element in
// dev/demo mode, giving the Canvas locator exact disk coordinates without relying
// on React's _debugSource fiber field (which React 19 removes). See Phase 6.
//
// `--mode demo` builds the HOSTED demo (a static site, no backend). Canvas
// selection still needs source mapping; forcing NODE_ENV=development keeps the
// dev jsx runtime (jsxDEV) + dev React, so fibers carry _debugSource as a
// fallback even in the built dist/. data-muse-loc is the preferred path.
// Edits are ephemeral (VITE_MUSE_EPHEMERAL in .env.demo), so absolute paths
// never hit disk.
export default defineConfig(({ command, mode }) => {
  const demo = mode === 'demo'
  // Force the dev jsx runtime two ways for robustness: set NODE_ENV before Vite
  // computes isProduction (picks dev React + the jsxDEV transform that carries
  // _debugSource), AND pin the client-side replacement so React's own runtime
  // checks stay in dev even if Vite's env-timing changes across versions.
  if (demo) process.env.NODE_ENV = 'development'

  // Include museLoc in dev server and demo builds; strip from prod builds.
  const isDev = command === 'serve' || demo
  return {
    plugins: [react({ babel: { plugins: isDev ? [museLoc] : [] } }), musePlugin()],
    ...(demo ? { define: { 'process.env.NODE_ENV': '"development"' } } : {}),
  }
})
