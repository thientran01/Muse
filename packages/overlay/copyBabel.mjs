// Copies the self-contained Babel locator plugin into dist so `@thientran01/muse/babel`
// resolves to it. It has no requires, so a plain file copy is enough.
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// The self-contained Babel locator (no requires) + its hand-written type twin,
// so `@thientran01/muse/babel` resolves both a runtime module and declarations.
copyFileSync(resolve(here, '../../babel/muse-loc.cjs'), resolve(here, 'dist/muse-loc.cjs'))
copyFileSync(resolve(here, 'muse-loc.d.ts'), resolve(here, 'dist/muse-loc.d.ts'))
console.log('[overlay] copied muse-loc.cjs + muse-loc.d.ts -> dist/')
