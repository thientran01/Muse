// Post-build smoke test (run in CI after `npm run build`). Imports the BUILT dist
// directly and asserts each entry exports its public surface — so a broken bundle
// or a renamed/removed export fails CI, not just a silently-successful build.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const root = await import('./dist/index.js')
assert.equal(typeof root.MuseOverlay, 'function', '. → MuseOverlay')
assert.equal(typeof root.configureMuse, 'function', '. → configureMuse')

const { musePlugin } = await import('./dist/vite.js')
const p = musePlugin()
assert.equal(p.name, 'muse-backend', '/vite → musePlugin().name')
assert.equal(p.apply, 'serve', '/vite → musePlugin().apply')

const nx = await import('./dist/next.js')
const ctx = nx.createMuseContext({}, process.cwd())
assert.ok(ctx.originPolicy, '/next → createMuseContext(...).originPolicy')
assert.equal(typeof nx.createMuseWebRouter(ctx), 'function', '/next → createMuseWebRouter')

// Importing the standalone entry must NOT start a server (the module's main-guard
// only fires when run directly) — just assert the factory export resolves.
const sa = await import('./dist/standalone.js')
assert.equal(typeof sa.startStandaloneServer, 'function', '/standalone → startStandaloneServer')

const babel = require('./dist/muse-loc.cjs')
assert.equal(typeof (babel.default ?? babel), 'function', '/babel → plugin')

console.log('[overlay] smoke OK — . / vite / next / standalone / babel all export the expected surface')
