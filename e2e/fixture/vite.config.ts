import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { museLoc } from '../../server/babelPluginMuseLoc'
import { musePlugin } from '../../server/musePlugin'

// The fixture is copied to e2e/.tmp-fixture/ before a run and served from there.
// The copy sits at the SAME depth as e2e/fixture/, so every relative import in
// this directory resolves identically in both locations — do not move either one
// without moving the other.
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')

export default defineConfig({
  plugins: [
    // museLoc stamps data-muse-loc="file:line:col". It relativizes the stamped
    // path against BABEL's cwd — which @vitejs/plugin-react never sets, so it is
    // process.cwd(). The server, meanwhile, anchors that path at Vite's root.
    // The two only agree when the dev server is SPAWNED with cwd = this
    // directory, which is what playwright.config.ts does. Launch it any other
    // way and every edit returns "not an editable file under src/".
    react({ babel: { plugins: [museLoc] } }),
    musePlugin(),
  ],
  resolve: {
    // The overlay is imported from the repo's own src/muse, outside this root.
    // Without deduping, Vite can hand the fixture a second React copy and the
    // overlay's hooks blow up.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Serving the overlay from outside the root goes through /@fs/, which is
    // gated on fs.allow. That defaults to the nearest package root — and this
    // fixture HAS its own package.json, so the default would resolve to the
    // fixture directory itself and 403 every repo-root import.
    fs: { allow: [repoRoot] },
  },
})
