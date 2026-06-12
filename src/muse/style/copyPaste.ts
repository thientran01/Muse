// Copy/paste styles — the pure model. `snapshotMutations` serializes a
// CanvasValues into the mutation vocabulary (everything the panel can write,
// EXCLUDING width/height and display: pasting geometry or restructure is
// almost never the intent — Figma's paste-properties draws the same line).
// `pasteDiff` is the paste: source snapshot vs the TARGET's snapshot, keeping
// only differing values — so a paste writes no redundant tokens (no opacity-100
// noise on an already-default target) while still RESETTING a target's
// explicit value when the source differs (target opacity-50, source default →
// opacity 100% writes).
//
// Known asymmetries (deliberate, all stem from "a default has no writable
// value"): a transparent own-background and a `normal` line-height/align-items
// don't serialize, so they can't CLEAR a target's explicit value.
import type { StyleMutation } from '../types'
import type { CanvasValues } from '../components/canvas/PropertiesPanel'
import { SHADOW } from './tailwindScales'

const TYPE_PROPS = new Set<string>(['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign'])
const CONTAINER_PROPS = new Set<string>(['gap', 'rowGap', 'columnGap', 'justifyContent', 'alignItems'])

export function snapshotMutations(v: CanvasValues): StyleMutation[] {
  const out: StyleMutation[] = []
  const px = (property: StyleMutation['property'], value: number) => out.push({ property, value: `${value}px` })

  px('paddingTop', v.padding.top)
  px('paddingRight', v.padding.right)
  px('paddingBottom', v.padding.bottom)
  px('paddingLeft', v.padding.left)
  px('marginTop', v.margin.top)
  px('marginRight', v.margin.right)
  px('marginBottom', v.margin.bottom)
  px('marginLeft', v.margin.left)

  px('borderTopLeftRadius', v.appearance.radius.topLeft)
  px('borderTopRightRadius', v.appearance.radius.topRight)
  px('borderBottomRightRadius', v.appearance.radius.bottomRight)
  px('borderBottomLeftRadius', v.appearance.radius.bottomLeft)

  px('borderWidth', v.appearance.borderWidth)
  // The AppearanceFields rule: a width without a style paints nothing.
  if (v.appearance.borderWidth > 0 && !v.appearance.borderStyleNone) {
    out.push({ property: 'borderStyle', value: 'solid' })
  }
  out.push({ property: 'opacity', value: `${v.appearance.opacity}%` })

  const s = v.appearance.shadow // a preset name, or 'custom' when off the scale
  if (s in SHADOW) {
    out.push({ property: 'boxShadow', value: SHADOW[s as keyof typeof SHADOW] })
  } else if (v.appearance.shadowParts) {
    const p = v.appearance.shadowParts
    out.push({ property: 'boxShadow', value: `${p.x}px ${p.y}px ${p.blur}px ${p.spread}px rgba(0, 0, 0, ${p.alpha})` })
  }

  // Colors — a THEMED channel's value belongs to the theme variable, not the
  // element; pasting its computed hex would fork the theme, so it stays home.
  if (!v.colorThemed.text) out.push({ property: 'color', value: v.color.text })
  if (!v.colorThemed.background && v.color.ownBackground) {
    out.push({ property: 'backgroundColor', value: v.color.ownBackground })
  }
  if (!v.colorThemed.border && v.appearance.borderWidth > 0) {
    out.push({ property: 'borderColor', value: v.color.border })
  }

  if (v.rendersText) {
    px('fontSize', v.type.fontSize)
    out.push({ property: 'fontWeight', value: `${v.type.fontWeight}` })
    if (v.type.lineHeight > 0) px('lineHeight', v.type.lineHeight) // 0 = `normal`, unwritable
    px('letterSpacing', v.type.letterSpacing)
    out.push({ property: 'textAlign', value: v.type.align })
  }

  if (v.layout) {
    out.push({ property: 'justifyContent', value: v.layout.justify }) // 'normal' is a real Tailwind token
    if (v.layout.align !== 'normal') out.push({ property: 'alignItems', value: v.layout.align }) // items-normal isn't
  }
  if (v.gap) {
    if (v.gap.row === v.gap.column) px('gap', v.gap.row)
    else {
      px('rowGap', v.gap.row)
      px('columnGap', v.gap.column)
    }
  }
  return out
}

// The paste batch: source values that (a) apply to the target's shape — Type
// props need rendered text, container props need a flex/grid layout — and
// (b) actually differ from the target's current value.
export function pasteDiff(source: StyleMutation[], target: CanvasValues): StyleMutation[] {
  const current = new Map(snapshotMutations(target).map((m) => [m.property, m.value]))
  return source.filter((m) => {
    if (TYPE_PROPS.has(m.property) && !target.rendersText) return false
    if (CONTAINER_PROPS.has(m.property) && !target.layout) return false
    return current.get(m.property) !== m.value
  })
}
