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

// Scan-only comment strip. Unlike the CSS build's version, a block comment is
// blanked IN PLACE (newlines preserved) rather than collapsed to one space —
// otherwise every line number after a multi-line comment would be reported short,
// and this tool's whole value is pointing at the right line.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const RULES = [
  {
    re: /text-\[[0-9.]+(?:px|pt|%)\]/g,
    msg: 'arbitrary type size — use the role scale (text-row/title/body-sm/field/eyebrow/chip/badge)',
  },
  {
    // Any hyphenated utility prefix, so directional/logical infixes are covered too
    // (border-t-line/20, border-x-accent/10, ring-offset-line/20) — not just bg-line/10.
    re: /\b(?:[a-z][a-z0-9]*-)+(?:line|accent)\/(?:[0-9.]+|\[)/g,
    msg: 'raw alpha fraction — use a role token (scrim/wash/hairline*/track*/tint*/focus/selected)',
  },
  {
    // Includes the per-corner/per-side forms: rounded-t-[…], rounded-tl-[…].
    re: /\brounded(?:-[a-z]{1,2})?-\[/g,
    msg: 'arbitrary radius — use the role ladder (rounded-knob/chip/field/card/panel/modal)',
  },
  { re: /tracking-\[/g, msg: 'arbitrary tracking — bake it into a fontSize tuple instead' },
  {
    // Rem-based type resolves against the HOST document's <html>, NOT the overlay:
    // a shadow root does not isolate root-relative units. A host running
    // html{font-size:62.5%} would shrink this text while the px chrome holds.
    // Stock keyword sizes, numeric leadings, AND arbitrary rem/em values — the last
    // is the sneakiest: text-[0.75rem] matches no other rule but is the exact hazard.
    re: /\btext-(?:xs|sm|base|lg|[0-9]?xl)\b|\bleading-[0-9]+\b|text-\[[0-9.]+r?em\]/g,
    msg: 'host-relative type inside the shadow root — resolves against the HOST html; use the px role scale',
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
