// ============================================================
//  Property model — what Muse can edit, and how it maps to code
// ------------------------------------------------------------
//  One entry per editable property the canvas controls expose. Each maps to:
//    • tw  — the Tailwind utility family (prefix) used by the host StyleWriter
//            (see style/writers.ts)
//    • css — the inline-style camelCase key(s) used by the engine's inline
//            fallback (two for axis props like paddingX = left + right)
//  Pure + framework-neutral so the server editor and the client controls share
//  one vocabulary. Phase 0 ships spacing; size / typography / color extend this
//  table without touching the editor.
// ============================================================

export type StyleProperty =
  | 'padding' | 'paddingX' | 'paddingY'
  | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
  | 'margin' | 'marginX' | 'marginY'
  | 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'
  | 'gap' | 'columnGap' | 'rowGap'
  | 'width' | 'height'
  | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing'
  | 'color' | 'backgroundColor' | 'borderColor'
  | 'borderRadius'
  | 'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomRightRadius' | 'borderBottomLeftRadius'
  | 'borderWidth' | 'borderStyle'
  | 'opacity'
  | 'boxShadow'

// `kind` selects how a raw value becomes a Tailwind token. 'length' (w/h) shares
// the spacing scale as 'spacing'; typography + color kinds have their own token
// builders + overload-safe family matchers (see buildToken/familyMatcher in
// tailwindScales) — the text-/font- prefixes are overloaded, so kind disambiguates.
// 'borderWidth'/'borderStyle' carry the same overload duty for the border- prefix
// (width vs style vs color all share it).
export type PropertySpec = {
  kind:
    | 'spacing' | 'length' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'color'
    | 'radius' | 'borderWidth' | 'borderStyle' | 'opacity' | 'shadow'
  tw: string
  css: string[]
}

export const PROPERTIES: Record<StyleProperty, PropertySpec> = {
  padding: { kind: 'spacing', tw: 'p', css: ['padding'] },
  paddingX: { kind: 'spacing', tw: 'px', css: ['paddingLeft', 'paddingRight'] },
  paddingY: { kind: 'spacing', tw: 'py', css: ['paddingTop', 'paddingBottom'] },
  paddingTop: { kind: 'spacing', tw: 'pt', css: ['paddingTop'] },
  paddingRight: { kind: 'spacing', tw: 'pr', css: ['paddingRight'] },
  paddingBottom: { kind: 'spacing', tw: 'pb', css: ['paddingBottom'] },
  paddingLeft: { kind: 'spacing', tw: 'pl', css: ['paddingLeft'] },
  margin: { kind: 'spacing', tw: 'm', css: ['margin'] },
  marginX: { kind: 'spacing', tw: 'mx', css: ['marginLeft', 'marginRight'] },
  marginY: { kind: 'spacing', tw: 'my', css: ['marginTop', 'marginBottom'] },
  marginTop: { kind: 'spacing', tw: 'mt', css: ['marginTop'] },
  marginRight: { kind: 'spacing', tw: 'mr', css: ['marginRight'] },
  marginBottom: { kind: 'spacing', tw: 'mb', css: ['marginBottom'] },
  marginLeft: { kind: 'spacing', tw: 'ml', css: ['marginLeft'] },
  gap: { kind: 'spacing', tw: 'gap', css: ['gap'] },
  columnGap: { kind: 'spacing', tw: 'gap-x', css: ['columnGap'] },
  rowGap: { kind: 'spacing', tw: 'gap-y', css: ['rowGap'] },
  width: { kind: 'length', tw: 'w', css: ['width'] },
  height: { kind: 'length', tw: 'h', css: ['height'] },
  fontSize: { kind: 'fontSize', tw: 'text', css: ['fontSize'] },
  fontWeight: { kind: 'fontWeight', tw: 'font', css: ['fontWeight'] },
  lineHeight: { kind: 'lineHeight', tw: 'leading', css: ['lineHeight'] },
  letterSpacing: { kind: 'letterSpacing', tw: 'tracking', css: ['letterSpacing'] },
  color: { kind: 'color', tw: 'text', css: ['color'] },
  backgroundColor: { kind: 'color', tw: 'bg', css: ['backgroundColor'] },
  borderColor: { kind: 'color', tw: 'border', css: ['borderColor'] },
  borderRadius: { kind: 'radius', tw: 'rounded', css: ['borderRadius'] },
  borderTopLeftRadius: { kind: 'radius', tw: 'rounded-tl', css: ['borderTopLeftRadius'] },
  borderTopRightRadius: { kind: 'radius', tw: 'rounded-tr', css: ['borderTopRightRadius'] },
  borderBottomRightRadius: { kind: 'radius', tw: 'rounded-br', css: ['borderBottomRightRadius'] },
  borderBottomLeftRadius: { kind: 'radius', tw: 'rounded-bl', css: ['borderBottomLeftRadius'] },
  borderWidth: { kind: 'borderWidth', tw: 'border', css: ['borderWidth'] },
  borderStyle: { kind: 'borderStyle', tw: 'border', css: ['borderStyle'] },
  opacity: { kind: 'opacity', tw: 'opacity', css: ['opacity'] },
  boxShadow: { kind: 'shadow', tw: 'shadow', css: ['boxShadow'] },
}

export const isStyleProperty = (p: unknown): p is StyleProperty =>
  typeof p === 'string' && Object.prototype.hasOwnProperty.call(PROPERTIES, p)
