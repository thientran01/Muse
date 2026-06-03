// Dev-only Babel plugin: stamp data-muse-loc="file:line:col" on every JSX
// opening element so the Canvas Mode locator can read exact disk coordinates
// from the DOM attribute instead of walking React fibers.
//
// Benefits over the _debugSource fiber approach:
//   • Works on React 19 (which removed _debugSource)
//   • Carries the exact disk line — no Fast Refresh +19 offset to compensate for
//   • Decouples element identity from React internals entirely
//
// Format: "<absPath>:<line>:<col>" where line is 1-based and col is 0-based
// (raw Babel AST column). On parse, take the last two colon-separated tokens as
// col/line and rejoin the rest as the path — safe on Windows (one drive colon).
//
// Used in vite.config.ts via @vitejs/plugin-react's babel.plugins option.
// The plugin is included only in dev/demo builds, never in production.

import type { JSXOpeningElement } from '@babel/types'
import type { NodePath } from '@babel/traverse'

type BabelTypes = typeof import('@babel/types')
type BabelAPI = { types: BabelTypes }
type PluginState = { filename?: string }

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

        // Normalize to forward slashes so Windows paths parse cleanly.
        const file = filename.replace(/\\/g, '/')
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
