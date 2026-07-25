// Post-build smoke test (run in CI after `npm run build`). Imports the BUILT dist
// directly and asserts each entry exports its public surface — so a broken bundle
// or a renamed/removed export fails CI, not just a silently-successful build.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const root = await import('./dist/index.js')
assert.equal(typeof root.MuseOverlay, 'function', '. → MuseOverlay')
assert.equal(typeof root.configureMuse, 'function', '. → configureMuse')
assert.equal(typeof root.getApiBase, 'function', '. → getApiBase')
// The config flags are FUNCTIONS, not consts (0.2.0). Asserted by type, because a
// deleted export and a const export both read as "not a function" here — the whole
// point of the 0.2.0 break was that a const is a snapshot, so a regression to one
// must fail loudly rather than ship a working-looking bundle.
assert.equal(typeof root.isMock, 'function', '. → isMock')
assert.equal(typeof root.isEphemeral, 'function', '. → isEphemeral')
// And the consts must be ABSENT, not merely superseded. Checking the functions
// exist doesn't catch a back-compat `export const MOCK = isMock()` added alongside
// them — which is the specific regression the spec warns about, because a const in
// the package entry re-snapshots at import for every consumer that imports it.
for (const dead of ['MOCK', 'EPHEMERAL']) {
  assert.ok(!(dead in root), `. → ${dead} must NOT be exported (0.2.0 removed it; a const re-latches at import)`)
}

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
