// ============================================================
//  Color math — pure hex ↔ rgb ↔ hsv helpers for the custom picker.
// ------------------------------------------------------------
//  No dependency: the picker drives an HSV model (saturation/brightness square +
//  hue slider), but the panel speaks #rrggbb (the engine drops alpha anyway), so
//  these convert between the three. All pure, framework-free.
// ============================================================

export type Rgb = { r: number; g: number; b: number } // 0–255
export type Hsv = { h: number; s: number; v: number } // h 0–360, s/v 0–100

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')

// "#rgb" / "#rrggbb" / "#rrggbbaa" → {r,g,b} (alpha dropped), or null if unparseable.
export function hexToRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, '').toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const sn = s / 100, vn = v / 100
  const c = vn * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = vn - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

export const hexToHsv = (hex: string): Hsv | null => {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsv(rgb) : null
}
export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv))

// Normalize loose user hex input ("fff", "#ABC", "abcdef") → "#rrggbb", or null.
export function normalizeHexInput(raw: string): string | null {
  const rgb = hexToRgb(raw)
  return rgb ? rgbToHex(rgb) : null
}

// Readable label color (black/white) for text sitting ON a given color — picks the
// higher-contrast one via relative luminance. Used for the swatch checkmark.
export function contrastInk(hex: string): '#000000' | '#ffffff' {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#000000'
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return lum > 0.6 ? '#000000' : '#ffffff'
}

// WCAG relative luminance (0–1) of an sRGB color, with the standard gamma decode.
function relLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export type ContrastResult = { ratio: number; aa: boolean; aaa: boolean; aaLarge: boolean }

// WCAG contrast ratio between two colors + pass flags. AA = 4.5:1 (normal text) /
// 3:1 (large); AAA = 7:1. Returns null if either color can't be parsed.
export function contrastRatio(a: string, b: string): ContrastResult | null {
  const ra = hexToRgb(a), rb = hexToRgb(b)
  if (!ra || !rb) return null
  const la = relLuminance(ra), lb = relLuminance(rb)
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  return { ratio, aa: ratio >= 4.5, aaa: ratio >= 7, aaLarge: ratio >= 3 }
}
