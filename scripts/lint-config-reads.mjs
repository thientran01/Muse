// ============================================================
//  CONFIG-READ SCOPE LINT
// ------------------------------------------------------------
//  Guards the lazy-config invariant (docs/specs/2026-07-25-case-study-engine-fixes.md).
//  isMock() / isEphemeral() must never be called at MODULE SCOPE — a call that
//  runs at import time snapshots the answer, which is the bug this whole change
//  removed: the live case study's overlay chunk shipped as `<script async>`,
//  executed before the page's inline `window.__MUSE__` script, and latched
//  EPHEMERAL to false for the session (49 failed API calls on a backend-less host).
//
//  Why this matters MORE than the original bug: a partial regression is worse than
//  the old behavior. If one module-scope read survives while the rest read lazily,
//  the overlay goes half-ephemeral — the Share UI resolves at import while edits
//  resolve per call — and the failure no longer has one explanation.
//
//  Scope is Muse's own chrome, matching lint-tokens.mjs. Excluded:
//    • src/muse/config.ts — defines them; its own module-scope code is the reader.
//    • generated/, __tests__/
//    • everything outside src/muse (src/site + src/main.tsx are the docs SITE, not
//      the overlay, and ship in no package). src/main.tsx is still written to the
//      rule anyway — see its Root component — because an exception nobody checks
//      is how a rule quietly stops being true.
//
//  MECHANISM — a real parser, deliberately, unlike lint-tokens.mjs's regex. That
//  script matches CLASS STRINGS, where a regex is exactly right. This one asks
//  whether a call site is lexically inside a function, which is a structural
//  question: a regex would have to proxy it through indentation, and a false
//  negative here silently reinstalls the bug. Concretely, CanvasMode.tsx has a
//  read inside an IIFE inside returned JSX — legitimately per-render, and an
//  indentation heuristic cannot tell it apart from a top-level one.
//
//  Run: npm run lint:config
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

// @babel/traverse is CJS; under ESM the callable lands on .default.
const traverse = _traverse.default ?? _traverse

const root = process.cwd()
const scanDir = path.join(root, 'src/muse')
const GUARDED = new Set(['isMock', 'isEphemeral'])

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'generated' && e.name !== '__tests__') walk(p)
    } else if (/\.tsx?$/.test(e.name) && p !== path.join(scanDir, 'config.ts')) {
      files.push(p)
    }
  }
})(scanDir)

// True when `fn` is invoked immediately where it sits — `(() => …)()`. Such a
// function body DOES run at import time, so having a function parent is not
// sufficient to prove a call is deferred; walk past IIFEs before deciding.
const isImmediatelyInvoked = (fnPath) =>
  fnPath.parentPath?.isCallExpression() && fnPath.parentPath.node.callee === fnPath.node

let violations = 0
for (const file of files) {
  const ast = parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })

  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee
      if (callee.type !== 'Identifier' || !GUARDED.has(callee.name)) return

      // Walk out through every enclosing function. An ordinary function stops the
      // walk (the call is deferred until someone invokes it); an IIFE does not,
      // because it runs right here.
      let fn = p.getFunctionParent()
      while (fn && isImmediatelyInvoked(fn)) fn = fn.getFunctionParent()
      if (fn) return

      violations++
      console.error(
        `${path.relative(root, file)}:${p.node.loc.start.line}  ${callee.name}()\n` +
          '    module-scope config read — the value is snapshotted at import.\n' +
          '    Move it into the component/function body that uses it.',
      )
    },
  })
}

if (violations > 0) {
  console.error(
    `\n[lint-config] ${violations} module-scope read${violations === 1 ? '' : 's'}.\n` +
      'See docs/specs/2026-07-25-case-study-engine-fixes.md § "Lazy config reads".',
  )
  process.exit(1)
}
console.log(`[lint-config] ${files.length} files clean — no module-scope config reads.`)
