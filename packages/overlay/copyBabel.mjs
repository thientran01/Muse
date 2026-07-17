// Copies the self-contained Babel locator plugin into dist so `@thientran01/muse/babel`
// resolves to it. It has no requires, so a plain file copy is enough.
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../babel/muse-loc.cjs')
const dest = resolve(here, 'dist/muse-loc.cjs')
copyFileSync(src, dest)
console.log('[overlay] copied muse-loc.cjs -> dist/muse-loc.cjs')
