// ============================================================
//  OVERLAY TOKEN LINT
// ------------------------------------------------------------
//  Guards the overlay design system (docs/specs/2026-07-22-overlay-design-system.md).
//  The migration retired every arbitrary type size, raw alpha fraction and
//  arbitrary radius from src/muse; this keeps them out.
//
//  Scope is Muse's own CHROME only. Excluded:
//    • src/site      — a normal page; free to use Tailwind's stock scale, and its
//                      rem sizing is fine outside a shadow root.
//    • src/muse/style — the ENGINE. Those class strings are emitted into the HOST
//                      project's source (e.g. `tracking-[-0.02em]` from a scrub),
//                      so they answer to the host's config, not Muse's tokens.
//    • generated/, __tests__/
//
//  Comments are stripped before scanning, so a comment that MENTIONS a banned
//  pattern (explaining why it's banned) doesn't trip the lint — same transform the
//  CSS build uses for class extraction.
//
//  Run: npm run lint:tokens
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const scanDir = path.join(root, 'src/muse')

// Same scan-only comment strip as scripts/build-overlay-css.mjs.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const RULES = [
  {
    re: /text-\[[0-9.]+px\]/g,
    msg: 'arbitrary type size — use the role scale (text-row/title/body-sm/field/eyebrow/chip/badge)',
  },
  {
    re: /\b(?:bg|text|border|ring|divide|from|to|via)-(?:line|accent)\/(?:[0-9.]+|\[)/g,
    msg: 'raw alpha fraction — use a role token (scrim/wash/hairline*/track*/tint*/focus/selected)',
  },
  {
    re: /rounded-\[/g,
    msg: 'arbitrary radius — use the role ladder (rounded-knob/chip/field/card/panel/modal)',
  },
  { re: /tracking-\[/g, msg: 'arbitrary tracking — bake it into a fontSize tuple instead' },
  {
    // Rem-based type resolves against the HOST document's <html>, NOT the overlay:
    // a shadow root does not isolate root-relative units. A host running
    // html{font-size:62.5%} would shrink this text while the px chrome holds.
    re: /\btext-(?:xs|sm|base|lg|[0-9]?xl)\b|\bleading-[0-9]+\b/g,
    msg: 'rem-based type inside the shadow root — resolves against the HOST html; use the px role scale',
  },
]

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'generated' && e.name !== '__tests__' && e.name !== 'style') walk(p)
    } else if (/\.tsx?$/.test(e.name)) {
      files.push(p)
    }
  }
})(scanDir)

let violations = 0
for (const file of files) {
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line)) !== null) {
        violations++
        console.error(`${path.relative(root, file)}:${i + 1}  ${m[0]}\n    ${rule.msg}`)
      }
    }
  })
}

if (violations > 0) {
  console.error(
    `\n[lint-tokens] ${violations} violation${violations === 1 ? '' : 's'}.\n` +
      'See docs/specs/2026-07-22-overlay-design-system.md for the token map.',
  )
  process.exit(1)
}
console.log(`[lint-tokens] ${files.length} files clean.`)
