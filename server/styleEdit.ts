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
  JSXOpeningElement,
  ObjectExpression,
} from '@babel/types'
import { PROPERTIES, isStyleProperty, type StyleProperty } from '../src/muse/style/properties'
import { spacingFamilyRe, spacingToken } from '../src/muse/style/tailwindScales'

// @babel/traverse ships CJS; the default export is on `.default` under ESM.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse

export type Mutation = { property: StyleProperty; value: string }
export type StyleStrategy = 'tailwind-first' | 'inline'

export type StyleEditResult = {
  newContent: string
  changed: boolean
  warnings: string[]
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

// Find the JSXOpeningElement that React's _debugSource points at. Match on line
// first; if several open on that line, disambiguate by column — tolerant of the
// 0- vs 1-based discrepancy between Babel's loc and React's __source by taking
// the nearest. Falls back to an element whose multi-line opening tag spans the
// line.
function locateOpening(ast: File, line: number, column: number): JSXOpeningElement | null {
  const onLine: JSXOpeningElement[] = []
  const spanning: JSXOpeningElement[] = []
  traverse(ast, {
    JSXOpeningElement(path) {
      const loc = path.node.loc
      if (!loc) return
      if (loc.start.line === line) onLine.push(path.node)
      else if (loc.start.line <= line && loc.end.line >= line) spanning.push(path.node)
    },
  })
  const candidates = onLine.length > 0 ? onLine : spanning
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

// Render a flat style object back to source: { key: 'value', … }. Keys are
// camelCase CSS props (valid identifiers), values single-quoted strings.
function renderStyleObject(props: Array<[string, string]>): string {
  if (props.length === 0) return '{}'
  return `{ ${props.map(([k, v]) => `${k}: '${v}'`).join(', ')} }`
}

export function computeStyleEdit(
  source: string,
  line: number,
  column: number,
  mutations: Mutation[],
  strategy: StyleStrategy = 'tailwind-first',
): StyleEditResult {
  const warnings: string[] = []
  const valid = mutations.filter((m) => isStyleProperty(m.property) && typeof m.value === 'string')
  if (valid.length === 0) return { newContent: source, changed: false, warnings: ['no valid mutations'] }

  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    // A file we can't parse (exotic syntax, a transient half-saved state) becomes
    // a skipped element with a warning — never a failed batch for its siblings.
    return { newContent: source, changed: false, warnings: [`parse failed: ${(e as Error).message}`] }
  }
  const opening = locateOpening(ast, line, column)
  if (!opening) {
    return { newContent: source, changed: false, warnings: [`no JSX element found at line ${line}`] }
  }

  const classInfo = analyzeClassName(opening)
  const styleInfo = analyzeStyle(opening)
  const classEditable = classInfo?.editable === true

  // Working copies we mutate as we route each property, then emit as patches.
  let classTokens = classEditable ? (classInfo as { value: string }).value.split(/\s+/).filter(Boolean) : []
  const styleProps: Array<[string, string]> = styleInfo?.editable ? [...styleInfo.props] : []
  let classTouched = false
  let styleTouched = false

  const setStyleProp = (key: string, value: string) => {
    const i = styleProps.findIndex(([k]) => k === key)
    if (i === -1) styleProps.push([key, value])
    else styleProps[i] = [key, value]
    styleTouched = true
  }

  for (const m of valid) {
    const spec = PROPERTIES[m.property]
    const useTailwind = strategy === 'tailwind-first' && classEditable
    if (useTailwind) {
      const re = spacingFamilyRe(spec.tw)
      const token = spacingToken(spec.tw, m.value)
      // Replace the family's existing utility IN PLACE (minimal diff); append
      // only if the element didn't have one. Drop any extra duplicates.
      const idx = classTokens.findIndex((c) => re.test(c))
      if (idx === -1) classTokens.push(token)
      else {
        classTokens[idx] = token
        classTokens = classTokens.filter((c, i) => i === idx || !re.test(c))
      }
      classTouched = true
    } else {
      // Inline route. Needs a style object we can write — present-and-editable,
      // or absent (we'll create one). A present-but-dynamic style blocks it.
      if (styleInfo?.editable === false) {
        warnings.push(`skipped ${m.property}: ${styleInfo.reason}`)
        continue
      }
      for (const key of spec.css) setStyleProp(key, m.value)
      // Inline wins by specificity, but strip the dueling Tailwind class too so
      // the source stays honest (only possible when className is editable).
      if (classEditable) {
        const re = spacingFamilyRe(spec.tw)
        const before = classTokens.length
        classTokens = classTokens.filter((c) => !re.test(c))
        if (classTokens.length !== before) classTouched = true
      } else if (classInfo?.editable === false) {
        warnings.push(`note: left dynamic className in place for ${m.property} (inline style overrides it)`)
      }
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

  if (patches.length === 0) {
    return { newContent: source, changed: false, warnings: [...warnings, 'nothing to change'] }
  }

  // Apply patches right-to-left so earlier offsets stay valid.
  patches.sort((a, b) => b.start - a.start)
  let out = source
  for (const p of patches) out = out.slice(0, p.start) + p.text + out.slice(p.end)
  return { newContent: out, changed: true, warnings }
}
