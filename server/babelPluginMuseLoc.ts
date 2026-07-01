// Dev-only Babel plugin: stamp data-muse-loc="file:line:col" on every JSX
// opening element so the Canvas Mode locator can read exact disk coordinates
// from the DOM attribute instead of walking React fibers.
//
// Benefits over the _debugSource fiber approach:
//   • Works on React 19 (which removed _debugSource)
//   • Carries the exact disk line — no Fast Refresh +19 offset to compensate for
//   • Decouples element identity from React internals entirely
//
// Format: "<path>:<line>:<col>" where line is 1-based and col is 0-based (raw
// Babel AST column). The path is REPO-RELATIVE when the file sits under the
// Babel cwd (project root) — e.g. "src/site/pages/Overview.tsx:14:6" — and falls
// back to the absolute path only when it can't be relativized. Relative is both
// cleaner and safer: the server's resolveInSrc anchors relative names at the
// Muse root, and a shipped demo bundle no longer bakes in the builder's absolute
// disk path on every element. On parse, take the last two colon-separated tokens
// as col/line and rejoin the rest as the path — safe on Windows (one drive colon).
//
// Used in vite.config.ts via @vitejs/plugin-react's babel.plugins option.
// The plugin is included only in dev/demo builds, never in production.

import type { JSXOpeningElement } from '@babel/types'
import type { NodePath } from '@babel/traverse'

type BabelTypes = typeof import('@babel/types')
type BabelAPI = { types: BabelTypes }
type PluginState = { filename?: string; cwd?: string }

// Make the stamped path repo-relative when the file lives under the Babel cwd
// (the project root). Degrades to the absolute path if the prefix doesn't match,
// so resolution never regresses — resolveInSrc handles both. Both inputs are
// normalized to forward slashes first (Windows-safe).
function relativizeLoc(filename: string, cwd: string | undefined): string {
  const file = filename.replace(/\\/g, '/')
  const root = (cwd ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (root && (file === root || file.startsWith(root + '/'))) return file.slice(root.length + 1)
  return file
}

export function museLoc({ types: t }: BabelAPI) {
  return {
    name: 'muse-loc',
    visitor: {
      JSXOpeningElement(path: NodePath<JSXOpeningElement>, state: PluginState): void {
        const { node } = path
        // <Fragment> / <React.Fragment> can't carry props — stamping it throws a
        // React error ("Invalid prop data-muse-loc supplied to React.Fragment").
        // (A shorthand <> is a JSXFragment, not a JSXOpeningElement, so it's never
        // visited here.) Fragments don't reach the DOM, so there's nothing to locate.
        const name = node.name
        if (
          (t.isJSXIdentifier(name) && name.name === 'Fragment') ||
          (t.isJSXMemberExpression(name) &&
            t.isJSXIdentifier(name.property) &&
            name.property.name === 'Fragment')
        )
          return
        if (!node.loc) return
        const filename = state.filename ?? ''
        if (!filename) return

        // Repo-relative when possible (see relativizeLoc); forward-slashed either way.
        const file = relativizeLoc(filename, state.cwd)
        const line = node.loc.start.line       // 1-based (Babel AST convention)
        const col = node.loc.start.column      // 0-based

        // Idempotent: skip if already stamped (multiple transform passes).
        for (const attr of node.attributes) {
          if (
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name) &&
            attr.name.name === 'data-muse-loc'
          ) return
        }

        node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-muse-loc'),
            t.stringLiteral(`${file}:${line}:${col}`),
          ),
        )
      },
    },
  }
}
