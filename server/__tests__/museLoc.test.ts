// relativizeLoc drift guard: server/babelPluginMuseLoc.ts and babel/muse-loc.cjs
// are hand-synced twins (Vite host vs babel-loader host). The stamped path is the
// contract the whole locator chain rests on — a behavioral drift between the twins
// means two host classes stamp different paths for the same file. Every case runs
// against BOTH implementations and asserts they agree with each other AND with the
// expected value.
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { relativizeLoc as tsTwin } from '../babelPluginMuseLoc'

const require = createRequire(import.meta.url)
const cjsTwin = require('../../babel/muse-loc.cjs').relativizeLoc as typeof tsTwin

const CASES: Array<{ name: string; filename: string; cwd: string | undefined; expected: string }> = [
  {
    name: 'file under root → repo-relative',
    filename: 'C:/proj/src/site/pages/Overview.tsx',
    cwd: 'C:/proj',
    expected: 'src/site/pages/Overview.tsx',
  },
  {
    name: 'backslash filename + backslash cwd normalize before matching',
    filename: 'C:\\proj\\src\\App.tsx',
    cwd: 'C:\\proj',
    expected: 'src/App.tsx',
  },
  {
    name: 'trailing slash on cwd is tolerated',
    filename: 'C:/proj/src/App.tsx',
    cwd: 'C:/proj/',
    expected: 'src/App.tsx',
  },
  {
    name: 'drive-letter case mismatch (lowercase filename) still relativizes',
    filename: 'c:/proj/src/App.tsx',
    cwd: 'C:/proj',
    expected: 'src/App.tsx',
  },
  {
    name: 'drive-letter case mismatch (lowercase cwd) still relativizes',
    filename: 'C:/proj/src/App.tsx',
    cwd: 'c:/proj',
    expected: 'src/App.tsx',
  },
  {
    name: 'sibling directory sharing the root as a name prefix is NOT relativized',
    filename: 'C:/proj-other/src/App.tsx',
    cwd: 'C:/proj',
    expected: 'C:/proj-other/src/App.tsx',
  },
  {
    name: 'file outside the root falls back to the absolute path',
    filename: 'D:/elsewhere/src/App.tsx',
    cwd: 'C:/proj',
    expected: 'D:/elsewhere/src/App.tsx',
  },
  {
    name: 'missing cwd falls back to the absolute path',
    filename: 'C:/proj/src/App.tsx',
    cwd: undefined,
    expected: 'C:/proj/src/App.tsx',
  },
  {
    name: 'empty cwd falls back to the absolute path',
    filename: 'C:/proj/src/App.tsx',
    cwd: '',
    expected: 'C:/proj/src/App.tsx',
  },
  {
    name: 'filename equal to the root relativizes to empty (degenerate, never a real JSX file)',
    filename: 'C:/proj',
    cwd: 'C:/proj',
    expected: '',
  },
  {
    name: 'POSIX paths (Linux/macOS CI) relativize without drive handling',
    filename: '/home/u/proj/src/App.tsx',
    cwd: '/home/u/proj',
    expected: 'src/App.tsx',
  },
  {
    name: 'POSIX path case stays significant beyond the drive letter',
    filename: '/home/u/Proj/src/App.tsx',
    cwd: '/home/u/proj',
    expected: '/home/u/Proj/src/App.tsx',
  },
]

describe('relativizeLoc (both twins)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(tsTwin(c.filename, c.cwd)).toBe(c.expected)
      expect(cjsTwin(c.filename, c.cwd)).toBe(c.expected)
    })
  }

  it('twins agree on every case (drift guard)', () => {
    for (const c of CASES) {
      expect(cjsTwin(c.filename, c.cwd)).toBe(tsTwin(c.filename, c.cwd))
    }
  })
})
