// ============================================================
//  CONFIG-READ SCOPE LINT
// ------------------------------------------------------------
//  Guards the lazy-config invariant (docs/specs/2026-07-25-case-study-engine-fixes.md).
//  isMock() / isEphemeral() / getApiBase() must never run at MODULE SCOPE — a call
//  that runs at import time snapshots the answer, which is the bug this change
//  removed: the live case study's overlay chunk shipped as `<script async>`,
//  executed before the page's inline `window.__MUSE__` script, and latched
//  EPHEMERAL to false for the session (49 failed API calls on a backend-less host).
//
//  Why this matters MORE than the original bug: a partial regression is worse than
//  the old behavior. If one module-scope read survives while the rest read lazily,
//  the overlay goes half-ephemeral — the Share UI resolving at import while edits
//  resolve per call — and the failure no longer has one explanation.
//
//  MECHANISM — a real parser, deliberately, unlike lint-tokens.mjs's regex. That
//  script matches CLASS STRINGS, where a regex is exactly right. This one asks
//  whether a call site runs at import, which is structural. CanvasMode has a read
//  inside an IIFE inside returned JSX — legitimately per-render, and no
//  indentation heuristic can tell it from a top-level one.
//
//  Three things it does that a naive "is there a function parent?" check misses,
//  each found by review probing this script rather than reading it:
//    • BINDINGS, not names. `import { isMock as demoMode }` and
//      `import * as cfg; cfg.isMock()` are the same read. Resolved through the
//      import declarations, so a local helper coincidentally named isMock is NOT
//      flagged and an alias IS.
//    • INDIRECTION. `const f = isMock; f()` and, more realistically,
//      `const read = () => isMock(); const X = read()` both run at import. Module-
//      scope functions that transitively reach a guarded call are computed to a
//      fixpoint, then their module-scope call sites are flagged.
//    • IIFEs and callbacks. `(() => isMock())()` and `[0].forEach(() => isMock())`
//      both run at import even though the call has a function parent.
//
//  RESIDUAL LIMITS — stated because a guarantee nobody can describe the edges of
//  is not a guarantee. This is per-file and static, so it cannot see: a wrapper
//  exported from module A and called at module scope in module B; dynamic dispatch
//  through an object property or array; `eval`; or a call reached via a class
//  method. Those are all far from the shape that caused the incident (a top-level
//  `const X = !EPHEMERAL && !MOCK`), which is what this must catch every time.
//
//  SCOPE — every file that can import the config, not just the overlay chrome.
//  An earlier revision scanned only src/muse "to match lint-tokens.mjs"; that was
//  a bad transfer. The token lint's scope exists because design tokens genuinely
//  don't apply to the docs site. The config invariant applies wherever config is
//  imported — including packages/overlay/src/index.ts, the published entry the
//  spec itself names as the worst place to reinstall the latch.
//  Excluded: config.ts (it defines them), generated/, __tests__/, node_modules/, dist/.
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
const GUARDED = new Set(['isMock', 'isEphemeral', 'getApiBase'])
// The module that exports them, however a file spells the path to it.
const CONFIG_MODULE = /(^|\/)muse\/config$|(^|\/)config$/

const SKIP_DIRS = new Set(['generated', '__tests__', 'node_modules', 'dist', '.tmp'])
const roots = [path.join(root, 'src'), path.join(root, 'packages')]

const files = []
for (const dir of roots) {
  if (!fs.existsSync(dir)) continue
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p)
      } else if (/\.tsx?$/.test(e.name) && path.resolve(p) !== path.join(root, 'src/muse/config.ts')) {
        files.push(p)
      }
    }
  })(dir)
}

let violations = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(root, file)

  let ast
  try {
    ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'], sourceFilename: rel })
  } catch (err) {
    // Name the file. A bare SyntaxError with only line/col sends you hunting.
    console.error(`${rel}  could not be parsed: ${err.message}`)
    violations++
    continue
  }

  // ---- which local names refer to the guarded exports -------------------------
  const guardedLocals = new Set() // `isMock`, or an alias like `demoMode`
  const namespaceLocals = new Set() // `cfg` from `import * as cfg from './config'`
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue
    if (!CONFIG_MODULE.test(node.source.value.replace(/\.[jt]sx?$/, ''))) continue
    for (const s of node.specifiers) {
      if (s.type === 'ImportSpecifier' && GUARDED.has(s.imported.name)) guardedLocals.add(s.local.name)
      else if (s.type === 'ImportNamespaceSpecifier') namespaceLocals.add(s.local.name)
    }
  }
  if (guardedLocals.size === 0 && namespaceLocals.size === 0) continue

  // A call node that reads config, directly. Covers optional calls (`isMock?.()`)
  // and namespace member calls (`cfg.isMock()`).
  const isDirectGuardedCall = (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return false
    const c = node.callee
    if (c.type === 'Identifier') return guardedLocals.has(c.name)
    if (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') {
      return (
        c.object.type === 'Identifier' &&
        namespaceLocals.has(c.object.name) &&
        c.property.type === 'Identifier' &&
        GUARDED.has(c.property.name)
      )
    }
    return false
  }

  // `const f = isMock` — an indirect binding that is just as good as the import.
  traverse(ast, {
    VariableDeclarator(p) {
      const { id, init } = p.node
      if (id.type === 'Identifier' && init?.type === 'Identifier' && guardedLocals.has(init.name)) {
        guardedLocals.add(id.name)
      }
    },
  })

  // ---- which module-scope functions transitively read config ------------------
  // name -> { readsDirectly, calls: Set<name> }
  const fns = new Map()
  const fnNameOf = (p) => {
    if (p.node.type === 'FunctionDeclaration' && p.node.id) return p.node.id.name
    const parent = p.parentPath
    if (parent?.node.type === 'VariableDeclarator' && parent.node.id.type === 'Identifier') {
      return parent.node.id.name
    }
    return null
  }

  traverse(ast, {
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(p) {
      const name = fnNameOf(p)
      if (!name || p.getFunctionParent()) return // module-scope-bound functions only
      const entry = { readsDirectly: false, calls: new Set() }
      p.traverse({
        'CallExpression|OptionalCallExpression'(inner) {
          if (isDirectGuardedCall(inner.node)) entry.readsDirectly = true
          const c = inner.node.callee
          if (c.type === 'Identifier') entry.calls.add(c.name)
        },
      })
      fns.set(name, entry)
    },
  })

  const reads = new Set([...fns].filter(([, v]) => v.readsDirectly).map(([k]) => k))
  for (let changed = true; changed; ) {
    changed = false
    for (const [name, v] of fns) {
      if (reads.has(name)) continue
      for (const callee of v.calls) {
        if (reads.has(callee)) {
          reads.add(name)
          changed = true
          break
        }
      }
    }
  }

  // ---- does this call site run at import? -------------------------------------
  // An immediately-invoked function runs where it sits, so it does not defer.
  // Neither does a callback handed to something invoked at module scope — the
  // callback's function parent is not its own callee, so check the enclosing call.
  const runsAtImport = (p) => {
    let cur = p
    for (;;) {
      const fn = cur.getFunctionParent()
      if (!fn) return true // nothing between here and the module body
      const parent = fn.parentPath
      const iife = parent?.isCallExpression() && parent.node.callee === fn.node
      // A function literal passed as an argument runs iff the receiving call runs.
      const asArgument = parent?.isCallExpression() && parent.node.arguments.includes(fn.node)
      if (!iife && !asArgument) return false // a real deferral (component body, handler, method)
      cur = parent
    }
  }

  const report = (line, what, why) => {
    violations++
    console.error(`${rel}:${line}  ${what}\n    ${why}\n    Move it into the function or component body that uses it.`)
  }

  traverse(ast, {
    'CallExpression|OptionalCallExpression'(p) {
      if (isDirectGuardedCall(p.node)) {
        if (runsAtImport(p)) {
          report(p.node.loc.start.line, 'config read at module scope', 'the value is snapshotted at import.')
        }
        return
      }
      // A call to a module-scope helper that reaches a guarded call.
      const c = p.node.callee
      if (c.type === 'Identifier' && reads.has(c.name) && runsAtImport(p)) {
        report(
          p.node.loc.start.line,
          `${c.name}() at module scope reads config`,
          'indirect, but it still runs at import and snapshots the answer.',
        )
      }
    },
  })
}

if (violations > 0) {
  console.error(
    `\n[lint-config] ${violations} problem${violations === 1 ? '' : 's'}.\n` +
      'See docs/specs/2026-07-25-case-study-engine-fixes.md § "Lazy config reads".',
  )
  process.exit(1)
}
console.log(`[lint-config] ${files.length} files clean — no module-scope config reads.`)
