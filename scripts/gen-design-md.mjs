#!/usr/bin/env node
// =============================================================================
//  gen-design-md — author a DESIGN.md for any React/Tailwind app from its code
// -----------------------------------------------------------------------------
//  Reads a project's styling evidence (Tailwind config, files defining CSS
//  custom properties / :root / font imports, and a bounded sample of components)
//  and asks Claude — on your logged-in subscription, via the `claude` CLI — to
//  write a design brief in the DESIGN.md format (github.com/google-labs-code/
//  design.md). Muse injects that brief so its edits stay on-brand
//  (see server/musePlugin.ts → loadDesignBrief).
//
//  Usage:
//    npm run design:gen                      # write ./DESIGN.md for this project
//    npm run design:gen -- <projectRoot>     # target another app
//    npm run design:gen -- --concise         # tighter, smaller brief (faster)
//    npm run design:gen -- --out path.md     # custom output path
//    npm run design:gen -- --force           # overwrite an existing DESIGN.md
//    npm run design:gen -- --exclude muse    # drop evidence mentioning a term
//                                            #   (repeatable; useful when a tool
//                                            #   shares the repo, e.g. exclude
//                                            #   the overlay's own tokens)
//    node scripts/gen-design-md.mjs --model opus
//
//  Auth: spends your Claude subscription (the CLI's logged-in account), not a
//  metered API key — ANTHROPIC_API_KEY is stripped from the child env.
// =============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2)
const VALUE_OPTS = new Set(['--out', '--model', '--exclude']) // flags that consume the next arg
const flag = (name) => argv.includes(name)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def
}
const optAll = (name) => {
  const out = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1])
  return out
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]))

const root = path.resolve(positional[0] || '.')
const concise = flag('--concise')
const force = flag('--force')
const model = opt('--model', 'sonnet')
// Evidence containing any of these (case-insensitive) is dropped — whole block
// if it's in the label, otherwise line-by-line. For repos where a tool shares
// the codebase (e.g. exclude the overlay's own `--muse-*` tokens that live in a
// shared tailwind config). The src/muse directory is always skipped regardless.
const excludes = optAll('--exclude').map((s) => s.toLowerCase()).filter(Boolean)
const outFile = path.resolve(opt('--out', path.join(root, 'DESIGN.md')))
const SRC = path.join(root, 'src')
const MAX_EVIDENCE = concise ? 30_000 : 60_000
const TIMEOUT_MS = 300_000 // kill a hung `claude` (e.g. a stalled auth prompt on CI)

const die = (msg) => { console.error(`[gen-design-md] ${msg}`); process.exit(1) }
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) die(`not a directory: ${root}`)
if (fs.existsSync(outFile)) {
  if (fs.statSync(outFile).isDirectory()) die(`--out is a directory: ${outFile}`)
  if (!force) die(`${path.relative(root, outFile) || outFile} already exists — pass --force to overwrite, or --out <path>.`)
}

// --- 1. gather evidence -----------------------------------------------------
// Skip the Muse overlay itself: we want the brief to describe the app being
// edited, not the tool. Also skip node_modules and dotfiles.
const SKIP_DIRS = new Set(['node_modules', 'muse']) // src/muse = the overlay
const rel = (p) => path.relative(root, p).split(path.sep).join('/')
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

function walk(dir, acc = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(path.join(dir, e.name), acc)
    } else {
      acc.push(path.join(dir, e.name))
    }
  }
  return acc
}

const files = fs.existsSync(SRC) ? walk(SRC) : []
const evidence = []
let budget = MAX_EVIDENCE
const add = (label, body) => {
  if (budget <= 0 || !body) return
  // Drop the whole block if an excluded term is in its label; otherwise strip
  // only the offending lines (evidence is plain text for the model, so removing
  // mid-structure lines is fine).
  if (excludes.some((x) => label.toLowerCase().includes(x))) return
  let text = body
  if (excludes.length) {
    text = text.split('\n').filter((line) => !excludes.some((x) => line.toLowerCase().includes(x))).join('\n')
  }
  if (!text.trim()) return
  const slice = text.slice(0, Math.min(text.length, budget))
  const block = `### ${label}\n\`\`\`\n${slice}\n\`\`\``
  evidence.push(block)
  budget -= block.length // subtract the whole block (fences + label), so the cap is honest
}

// (a) Tailwind config — the theme is the design system's backbone.
for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']) {
  const p = path.join(root, name)
  if (fs.existsSync(p)) { add(name, read(p)); break }
}
// (b) Global style / token files — CSS custom properties, :root, fonts.
for (const p of files) {
  if (budget <= 0) break
  if (!/\.(css|tsx?|jsx?)$/.test(p)) continue
  const body = read(p)
  if (/:root|--[\w-]+\s*:|@import url\(|font-family/.test(body)) add(rel(p), body)
}
// (c) A sample of components for pattern evidence (bounded by remaining budget).
for (const p of files) {
  if (budget <= 0) break
  if (!/\.(tsx|jsx)$/.test(p)) continue
  const body = read(p)
  if (body.includes('className')) add(`component ${rel(p)}`, body)
}

if (evidence.length === 0) die(`no styling evidence found under ${rel(SRC)} — is this a React/Tailwind app?`)

// --- 2. the DESIGN.md authoring spec (condensed) ----------------------------
const SYSTEM = `You author DESIGN.md files: a plain-text design system with YAML frontmatter (machine-readable tokens) followed by markdown prose (human guidance), per github.com/google-labs-code/design.md.

Output ONLY the DESIGN.md content. The FIRST line must be \`---\` (no preamble, no code fences around the whole document). Immediately after the closing frontmatter \`---\`, add a short HTML comment crediting the format: <!-- Format: DESIGN.md (github.com/google-labs-code/design.md), Apache-2.0. Content describes this app. -->

FRONTMATTER (between --- delimiters):
  name: <string>
  description: <string>
  colors: { <token>: "#hex" }   # if the codebase backs a color with a CSS var, note it in a trailing comment, e.g.  energy: "#d4ff3a"   # var(--c-energy)
  typography: { <token>: { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } }
  rounded: { <level>: <dimension> }
  spacing: { <level>: <dimension> }
  components: { <name>: { <prop>: "{token.ref}" | value } }
Tokens are NORMATIVE. Derive EVERY value from the EVIDENCE provided — never invent colors, fonts, or sizes that aren't there. Omit a group if the evidence doesn't support it.

PROSE SECTIONS (## headings, in this order; omit any that don't apply):
  Brand & Style, Colors, Typography, Layout & Spacing, Elevation & Depth, Shapes, Components, Do's and Don'ts
Explain how to APPLY the tokens. If colors are CSS variables, instruct the reader to apply them via the variable (e.g. text-[color:var(--c-energy)]), never raw hex (they flip per theme). Infer the brand personality from the evidence; be specific and useful.${
  concise
    ? `\n\nBE CONCISE: keep the frontmatter to the essential tokens and each prose section to 1-3 tight sentences. Favor brevity over completeness — this brief is injected into every edit call.`
    : ''
}`

const prompt =
  `Author a ${concise ? 'concise ' : ''}DESIGN.md for this codebase using ONLY the evidence below. ` +
  `Map CSS custom properties to tokens and note each variable name so edits can reference it.\n\n` +
  `## Evidence\n\n${evidence.join('\n\n')}`

// --- 3. generate via the claude CLI (subscription auth) ----------------------
// Mirrors resolveClaudeBin() in server/musePlugin.ts (no shared module between
// the Vite plugin and this standalone script).
function resolveClaudeBin() {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const hits = execFileSync(finder, ['claude'], { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    return hits.find((h) => /\.exe$/i.test(h)) || hits[0] || 'claude'
  } catch {
    return 'claude'
  }
}
const bin = resolveClaudeBin()
const env = { ...process.env }
delete env.ANTHROPIC_API_KEY // force subscription auth, never bill a key

console.error(`[gen-design-md] ${evidence.length} evidence blocks (~${MAX_EVIDENCE - budget} chars)${concise ? ', concise' : ''} → asking claude (${model})…`)

// Same lockdown flags as runChatViaCli in server/musePlugin.ts. No --json-schema:
// a DESIGN.md is freeform markdown, so we read the plain `.result`, not structured output.
const child = spawn(bin, [
  '-p', '--output-format', 'json', '--model', model,
  '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', '',
  '--system-prompt', SYSTEM,
], { env })

let out = ''
let err = ''
let settled = false
const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn() }
const timer = setTimeout(() => { child.kill(); finish(() => die(`claude timed out after ${TIMEOUT_MS / 1000}s.`)) }, TIMEOUT_MS)

child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', (d) => (err += d))
child.stdin.on('error', () => {}) // swallow EPIPE if the child dies before draining the prompt
child.on('error', (e) => finish(() => die(`could not run the \`claude\` CLI (${e.message}). Is Claude Code installed and on PATH, and logged in (\`claude auth status\`)?`)))
child.on('close', (code) => finish(() => {
  if (code !== 0) die(`claude exited ${code}: ${err.slice(0, 500) || '(no stderr)'}`)
  let res
  try { res = JSON.parse(out) } catch { return die(`could not parse claude output: ${out.slice(0, 500)}`) }
  if (res.is_error) die(`claude reported an error: ${(typeof res.result === 'string' ? res.result : 'unknown').slice(0, 500)}`)
  const md = (res.result || '').trim()
  if (!md) die('claude returned an empty result.')
  fs.mkdirSync(path.dirname(outFile), { recursive: true }) // ensure --out parent dirs exist
  fs.writeFileSync(outFile, md + '\n', 'utf8')
  console.error(`[gen-design-md] wrote ${rel(outFile) || outFile} (${md.length} chars). Review it before committing.`)
}))

try {
  child.stdin.write(prompt)
  child.stdin.end()
} catch {
  // child already gone — the 'error'/'close' handler will report it.
}
