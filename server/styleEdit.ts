// ============================================================
//  Deterministic style editor — visual edit → surgical source edit
// ------------------------------------------------------------
//  The heart of Canvas Mode. Given a source file, a JSX element pinpointed by
//  its React `_debugSource` (line/column), and a list of CSS-property mutations,
//  produce the file's new contents — changing ONLY that element's className /
//  style attribute and leaving every other byte identical (same "smallest
//  possible change" contract as the chat backend's applyReplacements).
//
//  No model call: we parse the real AST (@babel/parser), find the exact
//  JSXOpeningElement, rewrite the attribute string in plain JS, and splice it
//  back by character range. Two writers decide HOW a property is expressed:
//    • Tailwind  — edit the className utility (p-4 → p-6, or arbitrary p-[17px])
//    • inline    — write into style={{ … }} (the universal fallback, and the
//                  path for non-Tailwind hosts); strips the dueling Tailwind
//                  class so inline and class don't fight.
//  The result is one or more { fileName, newContent } edits, which the client
//  runs through the EXISTING approve → /write → history flow, so Canvas edits
//  are undoable for free.
// ============================================================
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import type {
  File,
  JSXAttribute,
  JSXElement,
  JSXOpeningElement,
  JSXText,
  Node,
  ObjectExpression,
  TemplateLiteral,
} from '@babel/types'
import { PROPERTIES, isStyleProperty, type StyleProperty } from '../src/muse/style/properties'
import { resolveStyleWriter, type StyleWriter } from '../src/muse/style/writers'
import { extractVarName, isVarValue } from '../src/muse/style/cssVarEdit'
import { setTemplateProperty } from '../src/muse/style/styledEdit'

// @babel/traverse ships CJS; the default export is on `.default` under ESM.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse

export type Mutation = { property: StyleProperty; value: string }
export type StyleStrategy = 'tailwind-first' | 'inline'

// A property whose value is painted through a CSS variable: rather than hardcode
// a literal over the theme binding, the engine emits this intent and the server
// (which has filesystem access) resolves `--name` to the stylesheet that defines
// it and edits the var's value there. The element's own JSX is left untouched.
export type VarEdit = { property: StyleProperty; varName: string; value: string }

// A CSS-modules-bound element: its className is `{styles.card}` (a binding into a
// `.module.css`), so the value lives in the stylesheet's `.card` rule, not the
// className (which is just the binding) and not inline. The engine emits this
// intent per CSS key and the server resolves the module specifier (relative to the
// JSX file) and sets the declaration in the rule — a twin of VarEdit, the change
// landing in another file while the element's JSX is left untouched.
export type ModuleEdit = { specifier: string; className: string; cssProp: string; value: string }

// An IMPORTED styled-components / emotion target: the element is `<Card>` where
// `Card` is imported from a relative module (`import { Card } from './ui'`). The
// styles live in that module's `styled.*` template, which the engine can't read
// (it only has the importing file), so — a twin of ModuleEdit — it emits this
// intent and the server resolves the specifier (relative to the JSX file, with
// extension guessing, bounded to src/), finds the `exportName` styled export, and
// edits its template body. Same-file styled defs are NOT deferred (the engine
// patches them in place); only cross-file imports become a StyledEdit.
export type StyledEdit = { specifier: string; exportName: string; cssProp: string; value: string }

export type StyleEditResult = {
  newContent: string
  changed: boolean
  warnings: string[]
  // Var-bound mutations deferred to a stylesheet edit (see VarEdit). Empty for the
  // common case of a literal class/inline edit.
  varEdits: VarEdit[]
  // CSS-modules-bound mutations deferred to a `.module.css` rule edit (see
  // ModuleEdit). Empty unless the target binds its className through a module.
  moduleEdits: ModuleEdit[]
  // Imported styled-component mutations deferred to a cross-file template edit (see
  // StyledEdit). Empty unless the target is a `<Card>` imported from a relative module.
  styledEdits: StyledEdit[]
}

// The arbitrary-token bracket content (`text-[color:var(--x)]` → `color:var(--x)`),
// or null for a non-arbitrary token. Used to recover the var a themed class paints
// through, so a class-bound theme value defers to the same var edit as an inline one.
function bracketContent(token: string): string | null {
  const m = token.match(/\[(.+)\]$/)
  return m ? m[1] : null
}

// A character-range splice on the original source. start === end is an insertion.
type Patch = { start: number; end: number; text: string }

// What we learned about the target's className attribute.
type ClassInfo =
  | { editable: true; value: string; start: number; end: number; delimiter: 'string' | 'template' }
  | { editable: false; reason: string }
  | null // no className attribute at all

// …and its style attribute.
type StyleInfo =
  | { editable: true; attr: JSXAttribute; object: ObjectExpression; props: Array<[string, string]> }
  | { editable: false; reason: string }
  | null // no style attribute at all

function parseFile(source: string): File {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  })
}

// A mutable, session-lived hint for the dev transform's line offset (see
// locateOpening). One per dev server; shared across requests so the first
// unambiguous locate calibrates every later one.
export type OffsetHint = { value: number | null }

// The tag name of an opening element ("div", "MatchRow"), or null for member /
// namespaced names. NOTE: this returns COMPONENT names too — use isHostOpening to
// tell a real DOM element ("div") from a component ("MatchRow").
function openingTag(node: JSXOpeningElement): string | null {
  return node.name.type === 'JSXIdentifier' ? node.name.name : null
}

// A host (intrinsic DOM) element opens with a lowercase identifier — React's rule:
// lowercase = DOM tag, Capitalized = component (renders its DOM elsewhere). Reorder
// needs host-only because the client maps drop slots from live DOM geometry, which
// only lines up 1:1 when each child IS the DOM node it authors.
function isHostOpening(node: JSXOpeningElement): boolean {
  const t = openingTag(node)
  return t !== null && t[0] === t[0].toLowerCase() && t[0] !== t[0].toUpperCase()
}

// A STATIC className string off an opening element (literal, or a `…` template
// with no interpolations), or null. For static Tailwind classes the source
// string equals the element's resolved DOM class attribute, so it's a reliable
// disambiguator. Dynamic classNames (clsx/conditionals/interpolation) → null.
function openingClassName(node: JSXOpeningElement): string | null {
  for (const a of node.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier' || a.name.name !== 'className') continue
    const v = a.value
    if (v?.type === 'StringLiteral') return v.value
    if (v?.type === 'JSXExpressionContainer') {
      const e = v.expression
      if (e.type === 'TemplateLiteral' && e.expressions.length === 0 && e.quasis.length === 1) {
        return e.quasis[0].value.cooked ?? e.quasis[0].value.raw
      }
    }
    return null
  }
  return null
}

const normCls = (s: string) => s.replace(/\s+/g, ' ').trim()

// React's _debugSource.columnNumber and Babel's loc.start.column don't line up on
// a fixed convention: usually React is 1-based and Babel 0-based (node === reported
// - 1), but in practice the skew runs the OTHER way too — e.g. a JSX element that's
// the inline child of a `{cond && (…)}` expression reports a column one LESS than
// Babel's (observed: Babel col 8, _debugSource col 7). So accept ±1 in either
// direction. The column stays a strong disambiguator (sibling elements are columns,
// not 1px, apart); when two candidates do fall within ±1, the className match +
// offset calibration downstream still pick the right one. Without this, a column
// that's off-by-one in the unhandled direction makes the (tag, column) signature
// match nothing → "no JSX element found" → the edit silently reverts.
function columnMatches(nodeCol: number, reported: number): boolean {
  return Math.abs(nodeCol - reported) <= 1
}

function nearestByColumn(candidates: JSXOpeningElement[], column: number): JSXOpeningElement | null {
  if (candidates.length <= 1) return candidates[0] ?? null
  let best = candidates[0]
  let bestDist = Infinity
  for (const node of candidates) {
    const c = node.loc!.start.column
    const dist = Math.min(Math.abs(c - column), Math.abs(c - (column - 1)))
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  return best
}

// Find the JSXOpeningElement that React's _debugSource points at.
//
// Dev transforms shift the line number. @vitejs/plugin-react's Fast Refresh wraps
// each module in a fixed-size HMR preamble (~19 lines), and that shift is baked
// into every element's _debugSource.lineNumber — by a CONSTANT amount, identical
// for every Fast-Refresh-wrapped module in the session, while the COLUMN stays
// exact. So the reliable signature is the host tag + column, NOT the line: a
// shifted line can even collide with an unrelated element that really lives there.
//
// We locate by (tag, column) and reconcile the uniform line offset, learning it
// once (`offsetHint`) so later edits resolve exactly. When tag+column is unique
// it's unambiguous; once calibrated, the offset pins it; when still ambiguous a
// static className match disambiguates (and calibrates); otherwise we trust the
// reported line as an offset-0 reading (correct when Fast Refresh is off) and
// fail closed rather than guess. `tag` absent → legacy line-based behaviour.
function locateOpening(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): JSXOpeningElement | null {
  const all: JSXOpeningElement[] = []
  traverse(ast, {
    JSXOpeningElement(path) {
      if (path.node.loc) all.push(path.node)
    },
  })

  // Learn the session offset from an unambiguous match, if it's non-negative.
  const learn = (node: JSXOpeningElement) => {
    const delta = line - node.loc!.start.line
    if (offsetHint && delta >= 0) offsetHint.value = delta
    return node
  }

  if (tag) {
    // The (tag, column) signature — reliable across the line shift.
    const sig = all.filter((n) => openingTag(n) === tag && columnMatches(n.loc!.start.column, column))

    // Unique signature → unambiguously the element; learn the session offset.
    if (sig.length === 1) return learn(sig[0])

    if (sig.length > 1) {
      // Calibrated → the element sits exactly `offset` below the reported line.
      // Require a single exact hit; anything else falls through (never guess).
      const known = offsetHint?.value
      if (known != null) {
        const at = sig.filter((n) => line - n.loc!.start.line === known)
        if (at.length === 1) return at[0]
      }
      // Static className uniquely identifies it (and calibrates the offset) — the
      // common bootstrap case, since Canvas targets carry static Tailwind classes.
      if (classNames) {
        const want = normCls(classNames)
        const byClass = sig.filter((n) => {
          const c = openingClassName(n)
          return c != null && normCls(c) === want
        })
        if (byClass.length === 1) return learn(byClass[0])
      }
      // Uncalibrated → trust the reported line as an offset-0 reading (the case
      // when Fast Refresh is off, or this module wasn't wrapped). Only when a
      // single signature element actually opens there; else fail closed.
      const onLine = sig.filter((n) => n.loc!.start.line === line)
      if (onLine.length === 1) return onLine[0]
      return null
    }
    // sig.length === 0: tag+column matched nothing (e.g. an SVG camelCase tag the
    // DOM lower-cased). Fall through to the legacy line-based locate.
  }

  // Legacy locate (no tag, or tag+column matched nothing — e.g. an SVG camelCase
  // tag the DOM lower-cased). Correct the reported line by any learned offset so
  // this can't grab an unrelated element that merely lives at the shifted line
  // under Fast Refresh. Uncalibrated → offset 0, i.e. the original behaviour.
  const target = line - (offsetHint?.value ?? 0)
  const onLine = all.filter((n) => n.loc!.start.line === target)
  if (onLine.length) return nearestByColumn(onLine, column)
  const spanning = all.filter((n) => n.loc!.start.line <= target && n.loc!.end.line >= target)
  if (spanning.length) return nearestByColumn(spanning, column)
  return null
}

function findAttr(opening: JSXOpeningElement, name: string): JSXAttribute | null {
  for (const a of opening.attributes) {
    if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name) return a
  }
  return null
}

function analyzeClassName(opening: JSXOpeningElement): ClassInfo {
  const attr = findAttr(opening, 'className')
  if (!attr) return null
  const v = attr.value
  if (!v) return { editable: false, reason: 'className has no value' }
  if (v.type === 'StringLiteral') {
    return { editable: true, value: v.value, start: v.start!, end: v.end!, delimiter: 'string' }
  }
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression
    // A static template (`...` with no ${}) is editable; anything else
    // (clsx(...), a conditional, an interpolated template) is not — we won't
    // risk rewriting a dynamic expression, so those props fall to inline style.
    if (e.type === 'TemplateLiteral' && e.expressions.length === 0 && e.quasis.length === 1) {
      const cooked = e.quasis[0].value.cooked ?? e.quasis[0].value.raw
      return { editable: true, value: cooked, start: v.start!, end: v.end!, delimiter: 'template' }
    }
    return { editable: false, reason: 'className is a dynamic expression' }
  }
  return { editable: false, reason: 'unsupported className value' }
}

function analyzeStyle(opening: JSXOpeningElement): StyleInfo {
  const attr = findAttr(opening, 'style')
  if (!attr) return null
  const v = attr.value
  if (!v || v.type !== 'JSXExpressionContainer' || v.expression.type !== 'ObjectExpression') {
    return { editable: false, reason: 'style is not an object literal' }
  }
  const object = v.expression
  const props: Array<[string, string]> = []
  for (const p of object.properties) {
    // Only a flat object of static string/number props is safe to regenerate;
    // a spread or a computed/dynamic value means we'd drop information, so bail.
    if (p.type !== 'ObjectProperty' || p.computed) return { editable: false, reason: 'style has dynamic properties' }
    const key =
      p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null
    if (key === null) return { editable: false, reason: 'style has a non-literal key' }
    const val = p.value
    if (val.type === 'StringLiteral') props.push([key, val.value])
    else if (val.type === 'NumericLiteral') props.push([key, String(val.value)])
    else return { editable: false, reason: 'style has a non-literal value' }
  }
  return { editable: true, attr, object, props }
}

// Render a flat style object back to source: { key: "value", … }. Keys are
// camelCase CSS props (valid identifiers); values go through JSON.stringify so
// any quote/backslash in the value (e.g. a font-family fallback) is escaped and
// the emitted JS can't be broken.
function renderStyleObject(props: Array<[string, string]>): string {
  if (props.length === 0) return '{}'
  return `{ ${props.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`
}

// Default/namespace imports whose source is a `*.module.css`, mapped binding-name
// → specifier. `import styles from './Card.module.css'` makes `styles` a CSS-
// modules object whose members (`styles.card`) bind to rules in that file; we map
// those bindings so a Canvas edit can be routed to the rule. Namespace form
// (`import * as styles from …`) is supported too; named imports aren't the pattern.
function findModuleImports(ast: File): Map<string, string> {
  const map = new Map<string, string>()
  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value
      if (!/\.module\.css$/i.test(src)) return
      for (const s of path.node.specifiers) {
        if (s.type === 'ImportDefaultSpecifier' || s.type === 'ImportNamespaceSpecifier') {
          map.set(s.local.name, src)
        }
      }
    },
  })
  return map
}

// If the located element's className is a CSS-modules binding — `{styles.card}` or
// the bracket form `{styles['card']}`, where `styles` is a module import — return
// the module specifier + the bound class name. Else null. The class's declarations
// live in the stylesheet, so these props can't be a className token: they defer to
// a server-side rule edit. Per-element, so a file can mix module + Tailwind targets.
function detectModuleBinding(
  opening: JSXOpeningElement,
  imports: Map<string, string>,
): { specifier: string; className: string } | null {
  if (imports.size === 0) return null
  const attr = findAttr(opening, 'className')
  if (!attr || attr.value?.type !== 'JSXExpressionContainer') return null
  const e = attr.value.expression
  if (e.type !== 'MemberExpression' || e.object.type !== 'Identifier') return null
  const specifier = imports.get(e.object.name)
  if (!specifier) return null
  // styles.card (non-computed Identifier) or styles['card'] (computed StringLiteral).
  const key =
    !e.computed && e.property.type === 'Identifier'
      ? e.property.name
      : e.computed && e.property.type === 'StringLiteral'
        ? e.property.value
        : null
  return key ? { specifier, className: key } : null
}

// A styled-components / emotion target for the located element: the source range of
// a same-file tagged-template body we edit IN PLACE; an `import` marker for a
// `<Card>` imported from a relative module (the server resolves + edits it, since
// the body lives in another file); or `unsupported` when the styled form isn't
// safely editable (an interpolated template, or the object-syntax form) — those
// fail closed to inline. A capitalized tag that's neither a same-file styled def
// nor a relative import returns null (route normally).
type StyledTarget =
  | { kind: 'template'; bodyStart: number; bodyEnd: number; body: string }
  | { kind: 'import'; specifier: string; exportName: string }
  | { kind: 'unsupported'; reason: string }

// Walk a styled tag-expression chain down to its root identifier: styled.div →
// styled, styled(Base) → styled, styled.div.attrs({…}) → styled, styled(Base)
// .attrs(…) → styled, emotion's styled('div') → styled. Returns the root Identifier
// name (or null), so we recognize every factory shape without enumerating them.
function tagRootName(node: Node): string | null {
  let n: Node = node
  for (;;) {
    if (n.type === 'Identifier') return n.name
    if (n.type === 'MemberExpression') { n = n.object; continue }
    if (n.type === 'CallExpression') { n = n.callee; continue }
    return null
  }
}

// Is this initializer a styled-component definition? Returns the tagged TEMPLATE for
// a template form (styled.div`…`, styled(Base)`…`, the .attrs/.withConfig chains),
// `object:true` for the object-syntax form (styled.div({…}) — JS object, not CSS
// text, so unsupported here), or null when it isn't `styled` at all.
function asStyledDef(init: Node | null | undefined): { template: TemplateLiteral } | { object: true } | null {
  if (!init) return null
  if (init.type === 'TaggedTemplateExpression' && tagRootName(init.tag) === 'styled') {
    return { template: init.quasi }
  }
  if (init.type === 'CallExpression' && tagRootName(init.callee) === 'styled' &&
      init.arguments.some((a) => a.type === 'ObjectExpression')) {
    return { object: true }
  }
  return null
}

// A single-quasi (no `${…}` interpolation) template body is editable: return its
// source range + text. An interpolated or multi-quasi template can't be spliced
// safely (offsets shift around dynamic chunks), so it's marked unsupported and
// fails closed to inline.
function templateTarget(
  tpl: TemplateLiteral,
  source: string,
  dynReason: string,
): { kind: 'template'; bodyStart: number; bodyEnd: number; body: string } | { kind: 'unsupported'; reason: string } {
  if (tpl.expressions.length !== 0 || tpl.quasis.length !== 1) return { kind: 'unsupported', reason: dynReason }
  const q = tpl.quasis[0]
  return { kind: 'template', bodyStart: q.start!, bodyEnd: q.end!, body: source.slice(q.start!, q.end!) }
}

// Find a same-file styled definition bound to `name` (`const Card = styled.div`…``).
// First declarator with this name wins; we don't restrict to module scope (a
// function-scoped styled const is still a static template we can edit in place).
function findStyledDef(ast: File, name: string): { template: TemplateLiteral } | { object: true } | null {
  let found: { template: TemplateLiteral } | { object: true } | null = null
  traverse(ast, {
    VariableDeclarator(path) {
      if (found) return
      if (path.node.id.type === 'Identifier' && path.node.id.name === name) {
        const def = asStyledDef(path.node.init)
        if (def) found = def
      }
    },
  })
  return found
}

// The module a local name is imported from, plus the name it's exported under at the
// source (`default` for a default import, the ORIGINAL name for `import { X as Y }`).
// Null when `name` isn't imported (a same-file binding) or is a namespace import
// (`import * as ui` → `<ui.Card>` is a member tag we don't handle). Mirrors
// findModuleImports but keyed by the local binding, for any specifier.
function findImportBinding(ast: File, name: string): { specifier: string; exportName: string } | null {
  let found: { specifier: string; exportName: string } | null = null
  traverse(ast, {
    ImportDeclaration(path) {
      if (found) return
      const specifier = path.node.source.value
      for (const s of path.node.specifiers) {
        if (s.local.name !== name) continue
        if (s.type === 'ImportDefaultSpecifier') found = { specifier, exportName: 'default' }
        else if (s.type === 'ImportSpecifier') {
          found = { specifier, exportName: s.imported.type === 'Identifier' ? s.imported.name : s.imported.value }
        }
      }
    },
  })
  return found
}

// If the located element is a styled-components / emotion target — an emotion `css`
// prop holding a `css`…`` template, a `<Card>` whose tag resolves to a same-file
// `styled.*` definition, or a `<Card>` imported from a RELATIVE module (resolved +
// edited server-side) — return the editable range / import / unsupported marker.
// Else null (a host element, a plain component, or a package/alias import we won't
// touch). Per-element, so a file can mix styled + Tailwind targets.
function detectStyledBinding(opening: JSXOpeningElement, ast: File, source: string): StyledTarget | null {
  // emotion css prop: <div css={css`…`}> — the template sits right at the JSX site.
  const cssAttr = findAttr(opening, 'css')
  if (cssAttr?.value?.type === 'JSXExpressionContainer') {
    const ex = cssAttr.value.expression
    if (ex.type === 'TaggedTemplateExpression' && tagRootName(ex.tag) === 'css') {
      return templateTarget(ex.quasi, source, 'css prop template has interpolations')
    }
    if (ex.type === 'ObjectExpression') return { kind: 'unsupported', reason: 'css prop is an object' }
  }
  // styled component: a capitalized tag (`<Card>`).
  const tag = openingTag(opening)
  if (!tag || tag[0] === tag[0].toLowerCase()) return null // host element / member name — not a styled component
  // Same-file styled def — edit its template in place.
  const def = findStyledDef(ast, tag)
  if (def) {
    if ('object' in def) return { kind: 'unsupported', reason: 'styled object syntax' }
    return templateTarget(def.template, source, 'styled template has interpolations')
  }
  // Imported from a relative module — defer to the server to resolve + edit. We can't
  // tell here whether the import is actually styled (that needs the other file), so
  // we speculate on every relative-imported capitalized component; the server warns
  // and leaves it unchanged if the export turns out not to be styled. Package/alias
  // imports (non-relative) are out of scope — route normally (inline).
  const imp = findImportBinding(ast, tag)
  if (imp && imp.specifier.startsWith('.')) {
    return { kind: 'import', specifier: imp.specifier, exportName: imp.exportName }
  }
  return null
}

// A `export { local as exportName } from './spec'` re-export of `exportName`: the
// module + the name it's exported under THERE, so a caller can follow the chain
// through a barrel (`components/index.ts`). Only re-exports WITH a source (`from`)
// need following — a sourceless `export { X }` re-exports a local binding that
// findStyledDef already sees. `export *` barrels aren't followed (can't know which
// star-source owns the name without searching them all). Null if not re-exported.
function findReExport(ast: File, exportName: string): { specifier: string; exportName: string } | null {
  let found: { specifier: string; exportName: string } | null = null
  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (found || !path.node.source) return
      for (const s of path.node.specifiers) {
        if (s.type !== 'ExportSpecifier') continue
        const exported = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value
        if (exported === exportName) found = { specifier: path.node.source.value, exportName: s.local.name }
      }
    },
  })
  return found
}

// Server-side resolver for a StyledEdit: in a MODULE's source, locate the styled
// export `exportName` and return its editable template range. Handles `export const
// X = styled.div`…``, `export default styled.div`…``, and `export default X` where
// `const X = styled…`. When the export is a re-export FROM another module (a barrel),
// returns a `reexport` marker so the server can follow it one hop further. Returns an
// `unsupported` marker for an interpolated or object-syntax export, or null when
// there's no such styled export (the name isn't a styled component here). PURE — the
// server hands it the file source; this only parses + locates, no I/O.
export type StyledExportLoc =
  | { bodyStart: number; bodyEnd: number; body: string }
  | { reexport: { specifier: string; exportName: string } }
  | { unsupported: string }
  | null
export function findStyledExport(source: string, exportName: string): StyledExportLoc {
  let ast: File
  try { ast = parseFile(source) } catch { return null }
  const toLoc = (def: { template: TemplateLiteral } | { object: true } | null): StyledExportLoc => {
    if (!def) return null
    if ('object' in def) return { unsupported: 'styled object syntax' }
    const t = templateTarget(def.template, source, 'styled template has interpolations')
    return t.kind === 'template' ? { bodyStart: t.bodyStart, bodyEnd: t.bodyEnd, body: t.body } : { unsupported: t.reason }
  }
  if (exportName === 'default') {
    let loc: StyledExportLoc = null
    traverse(ast, {
      ExportDefaultDeclaration(path) {
        if (loc) return
        const d = path.node.declaration
        // `export default X` (name → find the const) or `export default styled.div`…``.
        loc = d.type === 'Identifier' ? toLoc(findStyledDef(ast, d.name)) : toLoc(asStyledDef(d as Node))
      },
    })
    if (loc) return loc
    const re = findReExport(ast, 'default')
    return re ? { reexport: re } : null
  }
  // A named export resolves to a same-file `const exportName = styled…` declarator
  // (whether exported inline via `export const` or separately via `export { X }`),
  // else a re-export `export { X } from './…'` we follow one hop (a barrel file).
  const def = findStyledDef(ast, exportName)
  if (def) return toLoc(def)
  const re = findReExport(ast, exportName)
  return re ? { reexport: re } : null
}

export function computeStyleEdit(
  source: string,
  line: number,
  column: number,
  mutations: Mutation[],
  strategy: StyleStrategy = 'tailwind-first',
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): StyleEditResult {
  const warnings: string[] = []
  const valid = mutations.filter((m) => isStyleProperty(m.property) && typeof m.value === 'string')
  if (valid.length === 0) return { newContent: source, changed: false, warnings: ['no valid mutations'], varEdits: [], moduleEdits: [], styledEdits: [] }

  // The host's class writer (Tailwind today) — owns how a value becomes a class
  // token, how to recognize an existing one, and which tokens are theme-bound.
  // Inline style is the engine's universal fallback below, not a writer.
  const writer: StyleWriter = resolveStyleWriter()

  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    // A file we can't parse (exotic syntax, a transient half-saved state) becomes
    // a skipped element with a warning — never a failed batch for its siblings.
    return { newContent: source, changed: false, warnings: [`parse failed: ${(e as Error).message}`], varEdits: [], moduleEdits: [], styledEdits: [] }
  }
  const opening = locateOpening(ast, line, column, tag, classNames, offsetHint)
  if (!opening) {
    return { newContent: source, changed: false, warnings: [`no JSX element found at line ${line}`], varEdits: [], moduleEdits: [], styledEdits: [] }
  }

  const classInfo = analyzeClassName(opening)
  const styleInfo = analyzeStyle(opening)
  const classEditable = classInfo?.editable === true
  // A `className={styles.card}` binding into a `.module.css` — its props can't be a
  // class token (the className is the binding) so they defer to a rule edit below.
  const moduleBinding = detectModuleBinding(opening, findModuleImports(ast))
  // A styled-components / emotion target (`<Card>` from a same-file `styled.*`, or an
  // emotion `css` prop) — its props live in the tagged-template body, edited in place
  // below. Mutually exclusive with a module binding in practice (different shapes).
  const styledTarget = moduleBinding ? null : detectStyledBinding(opening, ast, source)

  // Working copies we mutate as we route each property, then emit as patches.
  let classTokens = classEditable ? (classInfo as { value: string }).value.split(/\s+/).filter(Boolean) : []
  const styleProps: Array<[string, string]> = styleInfo?.editable ? [...styleInfo.props] : []
  let classTouched = false
  let styleTouched = false
  // Mutations whose current value is theme-bound (var(--x)); the server edits the
  // var's definition instead of this element. Collected across the loop below.
  const varEdits: VarEdit[] = []
  // Mutations on a CSS-modules-bound element; the server sets them in the module's
  // `.className` rule (see ModuleEdit). Collected across the loop below.
  const moduleEdits: ModuleEdit[] = []
  // Mutations on an IMPORTED styled component; the server resolves the module +
  // edits its template (see StyledEdit). Collected across the loop below.
  const styledEdits: StyledEdit[] = []
  // A SAME-FILE styled/emotion target's template body, mutated across the loop and
  // emitted as a single in-place patch below (no deferred intent needed).
  let styledBody = styledTarget?.kind === 'template' ? styledTarget.body : ''
  let styledTouched = false

  const setStyleProp = (key: string, value: string) => {
    const i = styleProps.findIndex(([k]) => k === key)
    if (i === -1) styleProps.push([key, value])
    else styleProps[i] = [key, value]
    styleTouched = true
  }

  // Write a mutation as inline style, stripping the dueling Tailwind class when
  // className is editable so the two can't fight. Returns false if there's no
  // writable style object (present-but-dynamic) — the caller warns and skips.
  const routeInline = (m: Mutation, spec: (typeof PROPERTIES)[StyleProperty]): boolean => {
    if (styleInfo?.editable === false) {
      warnings.push(`skipped ${m.property}: ${styleInfo.reason}`)
      return false
    }
    for (const key of spec.css) setStyleProp(key, m.value)
    if (classEditable) {
      const matches = writer.family(spec)
      const before = classTokens.length
      classTokens = classTokens.filter((c) => !matches(c))
      if (classTokens.length !== before) classTouched = true
    } else if (classInfo?.editable === false) {
      warnings.push(`note: left dynamic className in place for ${m.property} (inline style overrides it)`)
    }
    return true
  }

  for (const m of valid) {
    const spec = PROPERTIES[m.property]
    const matchesFamily = writer.family(spec)
    // A value painted through a CSS variable — as a themed class token
    // (text-[color:var(--x)]) OR an inline value (color: var(--x)) — defers to a
    // stylesheet edit of --x rather than hardcoding a literal over the theme
    // binding. The element's binding stays put; the server resolves + edits --x.
    // Applies to any kind (color, tracking, leading, …).
    //
    // INLINE WINS the cascade over a class, so prefer an inline binding when both
    // are present. An axis property (paddingX → left+right) maps to two css keys:
    // only defer when ALL of them are bound to the SAME single var, else a scrub
    // (one scalar) would edit one side and strand the other — warn and skip instead.
    const inlineVarNames = spec.css.map((k) => {
      const v = styleProps.find(([pk]) => pk === k)?.[1]
      return v != null && isVarValue(v) ? extractVarName(v) : undefined
    })
    const anyInlineVar = inlineVarNames.some((n) => n)
    const themedToken = classEditable
      ? classTokens.find((c) => matchesFamily(c) && writer.themed(c))
      : undefined
    if (anyInlineVar || themedToken) {
      if (anyInlineVar) {
        const distinct = [...new Set(inlineVarNames.filter((n): n is string => n != null))]
        const allKeysVar = inlineVarNames.every((n) => n != null)
        if (distinct.length === 1 && allKeysVar) {
          varEdits.push({ property: m.property, varName: distinct[0], value: m.value })
        } else {
          warnings.push(`${m.property}: mixed/asymmetric CSS-variable binding — left unchanged`)
        }
      } else {
        const varName = extractVarName(bracketContent(themedToken!) ?? '')
        if (varName) varEdits.push({ property: m.property, varName, value: m.value })
        else warnings.push(`${m.property}: value is themed via a CSS variable — left unchanged`)
      }
      continue
    }
    // A CSS-modules-bound element (`className={styles.card}`): the value lives in
    // the module's `.card` rule, not the className (just the binding) and not
    // inline. Emit a rule-edit intent per CSS key; the server resolves the module
    // file and sets the declaration. (An inline var binding above still wins the
    // cascade if the element happens to carry one.)
    if (moduleBinding) {
      for (const key of spec.css) {
        moduleEdits.push({ specifier: moduleBinding.specifier, className: moduleBinding.className, cssProp: key, value: m.value })
      }
      continue
    }
    // A styled-components / emotion target (`<Card>` from `styled.div`…``, or an
    // emotion `css` prop): the value lives in the tagged-template body, not the
    // className (a generated hash) and not inline. We only divert when there's no
    // editable static className — if the element ALSO carries Tailwind utilities
    // (`<Card className="mt-4">`), those stay the primary surface (visible in JSX,
    // and safe from being overridden by the styled class's cascade). An unsupported
    // styled form (interpolated template / object syntax) fails closed to inline —
    // styled forwards `style`, so an inline value still applies (and overrides it).
    if (styledTarget && !classEditable) {
      if (styledTarget.kind === 'template') {
        for (const key of spec.css) {
          const r = setTemplateProperty(styledBody, key, m.value)
          if (r.changed) {
            styledBody = r.newContent
            styledTouched = true
          }
        }
        continue
      }
      // Imported styled component — defer to the server (it resolves the module and
      // edits the export's template). One intent per CSS key, like ModuleEdit.
      if (styledTarget.kind === 'import') {
        for (const key of spec.css) {
          styledEdits.push({ specifier: styledTarget.specifier, exportName: styledTarget.exportName, cssProp: key, value: m.value })
        }
        continue
      }
      warnings.push(`${m.property}: ${styledTarget.reason} — wrote inline style instead`)
      routeInline(m, spec)
      continue
    }
    const useTailwind = strategy === 'tailwind-first' && classEditable
    // A value that can't be expressed as a safe class token (writer.build → null)
    // falls back to inline even under tailwind-first, so we never emit a broken
    // className.
    const token = useTailwind ? writer.build(spec, m.value) : null
    if (useTailwind && token !== null) {
      const matches = writer.family(spec)
      // Replace the family's existing utility IN PLACE (minimal diff); append
      // only if the element didn't have one. Drop any extra duplicates.
      const idx = classTokens.findIndex((c) => matches(c))
      if (idx === -1) classTokens.push(token)
      else {
        classTokens[idx] = token
        classTokens = classTokens.filter((c, i) => i === idx || !matches(c))
      }
      classTouched = true
    } else {
      routeInline(m, spec)
    }
  }

  const patches: Patch[] = []

  if (classTouched && classInfo?.editable) {
    const ci = classInfo as { start: number; end: number; delimiter: 'string' | 'template' }
    const next = classTokens.join(' ')
    const text = ci.delimiter === 'template' ? `{\`${next}\`}` : `"${next}"`
    patches.push({ start: ci.start, end: ci.end, text })
  }

  if (styleTouched) {
    if (styleInfo?.editable) {
      patches.push({ start: styleInfo.object.start!, end: styleInfo.object.end!, text: renderStyleObject(styleProps) })
    } else {
      // No style attribute yet — insert one right after the className attribute
      // (or the tag name if there's no className), anchored on the attribute
      // node's end so we land in the whitespace between attributes.
      const classAttr = findAttr(opening, 'className')
      const insertAt = classAttr ? classAttr.end! : opening.name.end!
      patches.push({ start: insertAt, end: insertAt, text: ` style={${renderStyleObject(styleProps)}}` })
    }
  }

  // A styled/emotion target's edited template body — one in-place patch on the
  // single-quasi body range (same file as the JSX, applied alongside the patches
  // above via the right-to-left splice below).
  if (styledTouched && styledTarget?.kind === 'template') {
    patches.push({ start: styledTarget.bodyStart, end: styledTarget.bodyEnd, text: styledBody })
  }

  if (patches.length === 0) {
    // No JSX patch — but a var edit, a module rule edit, or an imported-styled edit
    // (all in another file) may still be the real change, so don't report "nothing
    // to change" when those carry the work.
    const deferred = varEdits.length > 0 || moduleEdits.length > 0 || styledEdits.length > 0
    const w = deferred ? warnings : [...warnings, 'nothing to change']
    return { newContent: source, changed: false, warnings: w, varEdits, moduleEdits, styledEdits }
  }

  // Apply patches right-to-left so earlier offsets stay valid.
  patches.sort((a, b) => b.start - a.start)
  let out = source
  for (const p of patches) out = out.slice(0, p.start) + p.text + out.slice(p.end)
  return { newContent: out, changed: true, warnings, varEdits, moduleEdits, styledEdits }
}

// ============================================================
//  TEXT EDIT — rewrite an element's literal text content
// ------------------------------------------------------------
//  Companion to computeStyleEdit: instead of an attribute, it rewrites the single
//  static JSXText child of the located element. Same locator (so it survives the
//  Fast-Refresh line shift), same character-range splice, same result shape — so
//  it flows through the existing write + undo/redo path.
// ============================================================

export type TextEditResult = { newContent: string; changed: boolean; warnings: string[] }

const MAX_TEXT_LEN = 10_000

// The new text is literal JSXText; entity-encode the characters that would
// otherwise break the parse (`<` `>` open a tag, `{` `}` an expression). Encode
// `&` first so we never double-encode. React renders these back to the literal
// glyphs, so the visible text is unchanged.
function encodeJsxText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

// Locate the JSXElement (not just its opening tag) by matching the opening the
// shared locator returns — identity match, so it's exact and self-validating.
function locateElement(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): JSXElement | null {
  const opening = locateOpening(ast, line, column, tag, classNames, offsetHint)
  if (!opening) return null
  let found: JSXElement | null = null
  traverse(ast, {
    JSXElement(path) {
      if (path.node.openingElement === opening) {
        found = path.node
        path.stop()
      }
    },
  })
  return found
}

// Locate the single static JSXText that an element's visible text comes from, or
// the reason it isn't editable. Shared by the editability probe and the edit, so
// "is this editable?" and "edit it" can never disagree. The text must be exactly
// ONE static JSXText (other children may be elements like an <Icon/>; whitespace-
// only JSXText is insignificant). Zero → the text is dynamic ({expr}); more than
// one → mixed static + dynamic.
function findTextNode(
  source: string,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { node: JSXText } | { reason: string } {
  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    return { reason: `parse failed: ${(e as Error).message}` }
  }
  const element = locateElement(ast, line, column, tag, classNames, offsetHint)
  if (!element) return { reason: `no JSX element found at line ${line}` }
  if (element.openingElement.selfClosing) return { reason: 'this element has no text to edit' }
  const texts = element.children.filter((c): c is JSXText => c.type === 'JSXText' && /\S/.test(c.value))
  if (texts.length === 0) return { reason: 'this text comes from data, not static text' }
  if (texts.length > 1) return { reason: 'this text mixes static + data — not editable here' }
  const node = texts[0]
  if (node.start == null || node.end == null) return { reason: 'text node has no source position' }
  return { node }
}

// Cheap "can this text be edited?" check (no write) — the client probes it on
// double-click so it can show a calm hint instead of letting you type then bounce.
export function computeTextEditable(
  source: string,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { editable: boolean; reason?: string } {
  const t = findTextNode(source, line, column, tag, classNames, offsetHint)
  return 'node' in t ? { editable: true } : { editable: false, reason: t.reason }
}

export function computeTextEdit(
  source: string,
  line: number,
  column: number,
  newText: string,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): TextEditResult {
  if (typeof newText !== 'string') return { newContent: source, changed: false, warnings: ['no text provided'] }
  if (newText.length > MAX_TEXT_LEN) return { newContent: source, changed: false, warnings: ['text too long'] }

  const t = findTextNode(source, line, column, tag, classNames, offsetHint)
  if ('reason' in t) return { newContent: source, changed: false, warnings: [t.reason] }
  const node = t.node

  // Keep the node's own surrounding whitespace (indentation / the space after an
  // inline icon); swap only the visible middle.
  const lead = node.value.match(/^\s*/)![0]
  const trail = node.value.match(/\s*$/)![0]
  const replacement = lead + encodeJsxText(newText.trim()) + trail
  if (replacement === node.value) return { newContent: source, changed: false, warnings: ['nothing to change'] }

  const out = source.slice(0, node.start!) + replacement + source.slice(node.end!)
  return { newContent: out, changed: true, warnings: [] }
}

// ============================================================
//  REORDER — move a JSX element among its siblings
// ------------------------------------------------------------
//  Phase 3: the first STRUCTURAL canvas edit (every prior edit rewrote an
//  attribute string or one JSXText child — none moved a subtree). Given an
//  element and a target slot among its siblings, reorder the parent's children
//  by a character-range splice that preserves each child's surrounding
//  whitespace/indentation — same "smallest possible change" contract, same
//  { newContent } result shape, so it flows through the existing write + undo
//  path. No model call.
//
//  v1 is deliberately host-only and fails closed everywhere else, because the
//  client maps drop slots from live DOM geometry and that mapping is only sound
//  when source order === DOM order 1:1:
//    • Parent must be a host JSXElement (lowercase tag) — a fragment/component
//      parent renders its children into a DIFFERENT DOM node, breaking the map.
//    • Every significant child must be a host JSXElement — a component child
//      (<MatchRow/>) renders DOM whose _debugSource points INSIDE the component,
//      not at the usage site, so it can't be matched back; an expression child
//      ({list.map(...)}, {cond && <x/>}) is dynamic/list content; mixed static
//      text means it isn't a clean element list.
//  Anything else → not reorderable, with a calm reason the client can surface.
// ============================================================

// A movable child the probe reports back, so the client can cross-check that the
// live DOM children line up 1:1 with the source children before it trusts an index.
export type ReorderChild = { index: number; tag: string; classNames: string | null }

export type Reorderable =
  | { reorderable: true; count: number; children: ReorderChild[] }
  | { reorderable: false; reason: string }

export type ReorderResult = { newContent: string; changed: boolean; warnings: string[] }

// Like locateElement, but also returns the located element's AST parent so we can
// reorder among its siblings. Single traversal, identity match on the opening the
// shared locator picked — exact and self-validating.
function locateElementWithParent(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { el: JSXElement; parent: Node } | null {
  const opening = locateOpening(ast, line, column, tag, classNames, offsetHint)
  if (!opening) return null
  let found: { el: JSXElement; parent: Node } | null = null
  traverse(ast, {
    JSXElement(path) {
      if (path.node.openingElement === opening) {
        found = { el: path.node, parent: path.parent }
        path.stop()
      }
    },
  })
  return found
}

// Classify a parent's children into the movable host-element run, or the reason
// it can't be reordered. Shared by the probe and the edit so "can I reorder?" and
// "reorder it" can never disagree. Whitespace-only JSXText is insignificant and
// preserved; ANY non-host-element significant child fails the whole container.
type ChildScan = { ok: true; elements: JSXElement[] } | { ok: false; reason: string }

function scanReorderChildren(parent: JSXElement): ChildScan {
  const elements: JSXElement[] = []
  for (const c of parent.children) {
    if (c.type === 'JSXText') {
      if (/\S/.test(c.value)) return { ok: false, reason: 'this mixes text and elements — reorder is not supported here' }
      continue // insignificant whitespace
    }
    if (c.type === 'JSXElement') {
      if (!isHostOpening(c.openingElement)) {
        return { ok: false, reason: 'these are components, not plain elements — reorder is not supported here yet' }
      }
      elements.push(c)
      continue
    }
    if (c.type === 'JSXExpressionContainer') {
      // {items.map(...)}, {cond && <x/>}, {/* comment */} — dynamic/list content.
      return { ok: false, reason: 'these are generated from data — reorder the list instead' }
    }
    // JSXFragment child, JSXSpreadChild, anything else.
    return { ok: false, reason: 'can not reorder around dynamic content here' }
  }
  if (elements.length < 2) return { ok: false, reason: 'needs at least two sibling elements to reorder' }
  return { ok: true, elements }
}

// Resolve the selected element to its reorderable sibling run (or the reason it
// isn't one). The one place the host-parent + host-children rules live.
function resolveSiblings(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { el: JSXElement; parent: JSXElement; elements: JSXElement[] } | { reason: string } {
  const found = locateElementWithParent(ast, line, column, tag, classNames, offsetHint)
  if (!found) return { reason: `no JSX element found at line ${line}` }
  if (found.parent.type !== 'JSXElement') {
    // Fragment / expression / component-root parent → its children render into a
    // different DOM node, so DOM geometry can't map slots safely.
    return { reason: 'these elements are not in a reorderable container' }
  }
  const parent = found.parent
  if (!isHostOpening(parent.openingElement)) {
    // A component parent (<Card>…</Card>) renders its children into a different
    // DOM node, so DOM geometry can't map slots safely.
    return { reason: 'these elements are not in a reorderable container' }
  }
  const scan = scanReorderChildren(parent)
  if (!scan.ok) return { reason: scan.reason }
  return { el: found.el, parent, elements: scan.elements }
}

// Cheap "can these siblings be reordered?" probe (no write) — the client calls it
// on select so it can show the drag handle only when a drop will actually commit.
export function computeReorderable(
  source: string,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): Reorderable {
  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    return { reorderable: false, reason: `parse failed: ${(e as Error).message}` }
  }
  const r = resolveSiblings(ast, line, column, tag, classNames, offsetHint)
  if ('reason' in r) return { reorderable: false, reason: r.reason }
  const children: ReorderChild[] = r.elements.map((el, index) => ({
    index,
    tag: openingTag(el.openingElement)!,
    classNames: openingClassName(el.openingElement),
  }))
  return { reorderable: true, count: children.length, children }
}

// Move the located element to insertion slot `toIndex` among its siblings, where
// toIndex is a position in the ORIGINAL significant-child list: the element ends
// up immediately before the original child at toIndex (toIndex === count → end).
// fromIndex is derived here from the element itself (the one location the client
// can pin most reliably), so the client only has to compute the drop slot.
export function computeReorder(
  source: string,
  line: number,
  column: number,
  toIndex: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): ReorderResult {
  if (!Number.isInteger(toIndex) || toIndex < 0) {
    return { newContent: source, changed: false, warnings: ['invalid target slot'] }
  }
  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    return { newContent: source, changed: false, warnings: [`parse failed: ${(e as Error).message}`] }
  }
  const r = resolveSiblings(ast, line, column, tag, classNames, offsetHint)
  if ('reason' in r) return { newContent: source, changed: false, warnings: [r.reason] }
  const { el, parent, elements } = r

  const fromIndex = elements.indexOf(el)
  if (fromIndex === -1) return { newContent: source, changed: false, warnings: ['element is not among its siblings'] }
  const to = Math.min(toIndex, elements.length) // clamp an over-far drop to "end"
  // Inserting before yourself, or before your immediate successor, is a no-op.
  if (to === fromIndex || to === fromIndex + 1) {
    return { newContent: source, changed: false, warnings: ['nothing to change'] }
  }

  // Each child's "block" = its source PLUS the whitespace that precedes it (the
  // newline + indentation, or — for the first — the gap after the parent's
  // opening tag). The blocks tile [regionStart, regionEnd) exactly, because we
  // proved no non-whitespace lives between the elements. The trailing whitespace
  // before the closing tag sits past regionEnd and never moves.
  const regionStart = parent.openingElement.end!
  const regionEnd = elements[elements.length - 1].end!
  const blocks: string[] = elements.map((node, i) => {
    const start = i === 0 ? regionStart : elements[i - 1].end!
    return source.slice(start, node.end!)
  })

  // Standard array-move on the index order, then re-emit the blocks in that order.
  const order = [...elements.keys()]
  order.splice(fromIndex, 1)
  order.splice(to > fromIndex ? to - 1 : to, 0, fromIndex)
  const newRegion = order.map((i) => blocks[i]).join('')

  const out = source.slice(0, regionStart) + newRegion + source.slice(regionEnd)
  return { newContent: out, changed: true, warnings: [] }
}
