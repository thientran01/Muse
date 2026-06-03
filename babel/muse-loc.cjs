// ============================================================
//  MUSE ELEMENT LOCATOR  —  universal Babel plugin (data-muse-loc stamp)
// ------------------------------------------------------------
//  Stamps data-muse-loc="file:line:col" on every JSX opening element so the
//  Canvas locator can read exact disk coordinates from the DOM attribute instead
//  of walking React fibers (React 19 removed `_debugSource`; fibers also carry a
//  Fast-Refresh line offset). This is the ONE element-locator mechanism Muse uses
//  across every bundler, because Babel plugs into all three dominant React stacks:
//
//    • Vite             — via @vitejs/plugin-react's `babel.plugins`
//    • Next.js 16 / Turbopack — via `turbopack.rules` running babel-loader
//    • webpack          — via babel-loader
//
//  An SWC plugin would only cover the SWC/webpack path (not Turbopack, not Vite),
//  so a Babel plugin is deliberately the most portable choice. See docs/HOSTING.md.
//
//  Format: "<absPath>:<line>:<col>" — line 1-based (Babel AST), col 0-based (raw
//  Babel AST column). Parse by taking the last two colon-separated tokens as
//  col/line and rejoining the rest as the path (Windows-safe: one drive colon).
//
//  Dev-only: this plugin self-gates to non-production so a host can wire it once
//  and never leak the attribute into a production build (NODE_ENV='production').
//  CommonJS so any babel-loader host can reference it by path; the Vite path uses
//  the typed twin server/babelPluginMuseLoc.ts (identical logic, drift-guarded by
//  a test). Both collapse into one export when Muse ships to npm (Phase 2).
// ============================================================

/** @typedef {{ types: typeof import('@babel/types') }} BabelAPI */

function museLoc({ types: t }) {
  return {
    name: 'muse-loc',
    visitor: {
      JSXOpeningElement(path, state) {
        // Never ship the attribute to production, even if a host wires the plugin
        // into every build. (Vite gates externally; hosts gate via this guard.)
        if (process.env.NODE_ENV === 'production') return

        const node = path.node
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
        ) {
          return
        }
        if (!node.loc) return
        const filename = (state && state.filename) || ''
        if (!filename) return

        // Normalize to forward slashes so Windows paths parse cleanly.
        const file = filename.replace(/\\/g, '/')
        const line = node.loc.start.line // 1-based (Babel AST convention)
        const col = node.loc.start.column // 0-based

        // Idempotent: skip if already stamped (multiple transform passes).
        for (const attr of node.attributes) {
          if (
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name) &&
            attr.name.name === 'data-muse-loc'
          ) {
            return
          }
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

module.exports = museLoc
module.exports.museLoc = museLoc
module.exports.default = museLoc
