// ============================================================
//  MUSE BACKEND CORE  —  framework-agnostic HTTP handlers
// ------------------------------------------------------------
//  All endpoint logic lives here, decoupled from Vite. Two adapters consume it:
//    • server/musePlugin.ts  — Vite dev-server middleware (same-origin, no CORS)
//    • server/standaloneServer.ts — standalone Node http server (CORS-enabled,
//      any bundler: Vite, Next.js, webpack, …)
//
//  The core receives a MuseContext (config + mutable session state) and exposes
//  createMuseHandlers() — a map of async (req, res) handler functions.
// ============================================================
import path from 'node:path'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  computeStyleEdit,
  computeTextEdit,
  computeTextEditable,
  computeReorder,
  computeReorderable,
  computeReorderChildren,
  computeReorderableContainer,
  computeStyleScope,
  computePropTextIntent,
  findPropLiteralUsages,
  findStyledExport,
  styledObjectPatches,
  type ClassPatch,
  type Mutation,
  type OffsetHint,
  type StyleStrategy,
  type VarEdit,
  type ModuleEdit,
} from './styleEdit'
import { blankComments, editCssVar, listCssVars, looksLikeColor } from '../src/muse/style/cssVarEdit'
import { setRuleProperty } from '../src/muse/style/cssRuleEdit'
import { setTemplateProperty } from '../src/muse/style/styledEdit'
import { performShare, probeShare } from './gitShare'
import type { Flag, FlagDraft, FlagsFile, ShareChange } from '../src/muse/types'

// ---- Constants ----------------------------------------------------------------

const MAX_WRITE_BYTES = 200_000

// ---- Request guard (CSRF / DNS-rebinding defense) ------------------------------
// Muse rewrites source files on POST, and it loads alongside a developer's dev
// server. Without a guard, ANY website the developer visits while the server runs
// could `fetch('http://localhost:5173/api/muse/write', …)` and rewrite their
// source — a drive-by CSRF / DNS-rebinding write. Two standard, cheap defenses,
// applied to every endpoint by createMuseHandlers so all three adapters (Vite
// plugin, standalone server, Next web adapter) inherit them from one place:
//   1. Origin allowlist. A cross-site — or DNS-rebound — page's request carries an
//      Origin the browser sets and page JS cannot forge; a rebind keeps the
//      attacker's own host in Origin, never loopback. Same-origin POSTs from the
//      Muse client carry the loopback dev Origin, so they pass. Reject anything
//      that is present and neither loopback nor operator-allowlisted.
//   2. Content-Type must be application/json on bodied (POST) requests. This
//      forces any cross-origin write into a CORS preflight (which none of the
//      adapters answer), closing the "simple request" hole where a text/plain or
//      form POST reaches the handler with no preflight at all.

// http(s)://{localhost | 127.0.0.1 | [::1]} with an optional :port — the loopback
// origins a dev server legitimately serves from.
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i

export type OriginPolicy = {
  // MUSE_CORS_ORIGIN='*' — operator opted into any origin (loopback still allowed).
  allowAnyOrigin: boolean
  // MUSE_CORS_ORIGIN=<url> — one extra exact origin (e.g. a LAN IP / remote dev box).
  extraOrigin: string | null
}

function originPolicyFromEnv(env: Record<string, string | undefined>): OriginPolicy {
  const cors = env.MUSE_CORS_ORIGIN ?? null
  return {
    allowAnyOrigin: cors === '*',
    extraOrigin: cors && cors !== '*' ? cors : null,
  }
}

export function isAllowedOrigin(origin: string, policy: OriginPolicy): boolean {
  if (policy.allowAnyOrigin) return true
  if (LOOPBACK_ORIGIN_RE.test(origin)) return true
  if (policy.extraOrigin && origin === policy.extraOrigin) return true
  return false
}

// Node lowercases header names. It comma-JOINS a duplicate origin/content-type into one
// string (a spoofed second Origin still fails the anchored allowlist below — never an
// array here), and keeps only a few headers (e.g. set-cookie) as arrays; the array branch
// is general defensiveness — take the first value.
const firstHeaderValue = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

export type GuardOutcome = { ok: true } | { ok: false; status: number; error: string }

// Pure decision (no I/O) so it's unit-testable and identical across adapters.
export function guardRequest(
  method: string | undefined,
  headers: IncomingMessage['headers'] | undefined,
  policy: OriginPolicy,
): GuardOutcome {
  const hdrs = headers ?? {}
  const origin = firstHeaderValue(hdrs.origin)
  // Only reject when an Origin is PRESENT and disallowed. A missing Origin means a
  // same-origin GET or a non-browser client (curl/native) — neither is a CSRF
  // vector, since CSRF needs a browser to attach the victim's ambient authority.
  // 'null' is an opaque origin (sandboxed iframe / file://) and fails the allowlist.
  if (origin != null && origin !== '' && !isAllowedOrigin(origin, policy)) {
    return { ok: false, status: 403, error: 'Origin not allowed.' }
  }
  // Bodied requests must be JSON — blocks the form-post / text-plain CSRF vector
  // that would otherwise skip the browser's preflight entirely.
  if (method === 'POST') {
    const ct = (firstHeaderValue(hdrs['content-type']) ?? '').trim()
    // Exact media type: `application/json`, optionally followed by params (`; charset=…`).
    // `\b` would also pass `application/json-patch+json`; the token must END at json.
    if (!/^application\/json\s*(?:;|$)/i.test(ct)) {
      return { ok: false, status: 415, error: 'Content-Type must be application/json.' }
    }
  }
  return { ok: true }
}

// ---- MuseContext ---------------------------------------------------------------

export type MuseContext = {
  root: string
  // Which origins may talk to Muse (from MUSE_CORS_ORIGIN; default loopback-only).
  originPolicy: OriginPolicy
  // Mutable session state
  lineOffsetHint: OffsetHint
  detectedStrategy: StyleStrategy | null
}

export function createMuseContext(
  env: Record<string, string | undefined>,
  root: string,
): MuseContext {
  return {
    root,
    originPolicy: originPolicyFromEnv(env),
    lineOffsetHint: { value: null },
    detectedStrategy: null,
  }
}

// ---- Handler type -------------------------------------------------------------

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export type MuseHandlers = {
  write: Handler
  styleEdit: Handler
  styleScope: Handler
  textEdit: Handler
  textEditable: Handler
  reorder: Handler
  reorderable: Handler
  tokens: Handler
  tokenEdit: Handler
  flag: Handler
  flags: Handler
  flagResolve: Handler
  flagDelete: Handler
  shareProbe: Handler
  share: Handler
}

export function createMuseHandlers(ctx: MuseContext): MuseHandlers {
  // Every endpoint clears the origin + content-type guard before its handler runs.
  // Wrapping here (not in each adapter) means the Vite plugin, standalone server,
  // and Next web adapter all inherit the same CSRF / DNS-rebinding defense.
  const guard = (h: Handler): Handler => async (req, res) => {
    const outcome = guardRequest(req.method, req.headers, ctx.originPolicy)
    if (!outcome.ok) return sendJson(res, outcome.status, { error: outcome.error })
    return h(req, res)
  }
  return {
    write:          guard((req, res) => handleWrite(req, res, ctx)),
    styleEdit:      guard((req, res) => handleStyleEdit(req, res, ctx)),
    styleScope:     guard((req, res) => handleStyleScope(req, res, ctx)),
    textEdit:       guard((req, res) => handleTextEdit(req, res, ctx)),
    textEditable:   guard((req, res) => handleTextEditable(req, res, ctx)),
    reorder:        guard((req, res) => handleReorder(req, res, ctx)),
    reorderable:    guard((req, res) => handleReorderable(req, res, ctx)),
    tokens:         guard((req, res) => handleTokens(req, res, ctx)),
    tokenEdit:      guard((req, res) => handleTokenEdit(req, res, ctx)),
    flag:           guard((req, res) => handleFlag(req, res, ctx)),
    flags:          guard((req, res) => handleFlagsList(req, res, ctx)),
    flagResolve:    guard((req, res) => handleFlagResolve(req, res, ctx)),
    flagDelete:     guard((req, res) => handleFlagDelete(req, res, ctx)),
    shareProbe:     guard((req, res) => handleShareProbe(req, res, ctx)),
    share:          guard((req, res) => handleShare(req, res, ctx)),
  }
}

// ---- Utility functions --------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function resolveInSrc(root: string, fileName: unknown): string | null {
  if (typeof fileName !== 'string' || fileName.length === 0) return null
  // Anchor relative names at the MUSE ROOT, not the process cwd — the client
  // round-trips the root-relative fileNames our own responses emit, and the
  // standalone server's cwd need not be the project root (MUSE_ROOT / --root).
  // An absolute fileName is unaffected (resolve ignores the base then).
  const abs = path.resolve(root, fileName)
  if (!fs.existsSync(abs)) return null
  const srcDir = fs.realpathSync(path.resolve(root, 'src'))
  const real = fs.realpathSync(abs)
  const rel = path.relative(srcDir, real)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return real
}

const relOf = (root: string, abs: string) => path.relative(root, abs).replace(/\\/g, '/')

// Write atomically: a temp file in the SAME directory (so rename stays on one volume
// and is atomic) then rename over the target. A concurrent reader — e.g. the muse-mcp
// server polling `.muse/flags.json` — therefore sees either the complete old file or
// the complete new one, never a torn half-write. Also hardens source writes against a
// crash mid-write corrupting a user's file.
function writeFileAtomic(abs: string, content: string): void {
  const dir = path.dirname(abs)
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, content, 'utf8')
  try {
    fs.renameSync(tmp, abs)
  } catch (err) {
    // Rename failed (disk full / permissions / a Windows lock on the target). Don't
    // leak the temp file — for a source write it lands beside the file in src/ where
    // Vite/tsc/git would pick up a stray `.Foo.tsx.<pid>.tmp`.
    try { fs.unlinkSync(tmp) } catch { /* best-effort cleanup */ }
    throw err
  }
}

// ---- Flags persistence (.muse/flags.json) -------------------------------------
// TWO processes write this file: this dev-server backend (flag drops + resolves) and the
// standalone muse-mcp server (resolve_flag/clear_resolved write DIRECTLY, so you can
// resolve with the app closed). writeFileAtomic prevents torn reads; concurrent writes are
// v1 last-write-wins on a small file (a watch + lock is the v1.1 hardening). The one
// dangerous consequence — a regressed nextId minting a duplicate id — is defused in
// handleFlag, which derives the id from max(nextId, highest existing id + 1).

const flagsPath = (root: string) => path.join(root, '.muse', 'flags.json')

function readFlagsFile(root: string): FlagsFile {
  let raw: string
  try {
    raw = fs.readFileSync(flagsPath(root), 'utf8')
  } catch (err) {
    // ENOENT is the normal first-run case (no flags yet) — start empty. Any OTHER
    // read error (EBUSY/EACCES — e.g. a transient lock while muse-mcp reads the file)
    // must NOT collapse to empty, or the caller's write would clobber every flag.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, nextId: 1, flags: [] }
    }
    throw err
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FlagsFile>
    return {
      version: 1,
      nextId: typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : 1,
      flags: Array.isArray(parsed.flags) ? (parsed.flags as Flag[]) : [],
    }
  } catch {
    // Corrupt JSON: surface it rather than silently resetting — a clear error beats
    // nuking the user's captured flags over one bad byte.
    throw new Error('.muse/flags.json is corrupt — fix or delete it to continue.')
  }
}

function writeFlagsFile(root: string, data: FlagsFile): void {
  const dir = path.join(root, '.muse')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  writeFileAtomic(flagsPath(root), JSON.stringify(data, null, 2) + '\n')
}

function detectStrategy(root: string): StyleStrategy {
  const configs = [
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
  ]
  if (configs.some((c) => fs.existsSync(path.join(root, c)))) return 'tailwind-first'
  // Tailwind v4 has NO JS config (it's CSS-first: `@import "tailwindcss"`), so the
  // config check above misses it and we'd wrongly fall back to inline styles. Detect
  // v4 from the package so v4 hosts edit Tailwind classes (the dominant setup now).
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.tailwindcss || deps['@tailwindcss/postcss'] || deps['@tailwindcss/vite']) {
      return 'tailwind-first'
    }
  } catch {
    // no/unreadable package.json — fall through to the CSS check
  }
  // Belt-and-suspenders: detect Tailwind directly from its CSS signature — `@import
  // "tailwindcss"` (v4) or a `@tailwind` directive (v3) in any stylesheet under src/.
  // Catches setups where the package isn't named as expected.
  try {
    const cssFiles: string[] = []
    collectCssFiles(path.join(root, 'src'), cssFiles)
    const sig = /@import\s+["']tailwindcss|@tailwind\b/
    // Blank comments first so a commented-out directive (`/* @tailwind base */`)
    // can't claim a host that actually styles some other way.
    if (cssFiles.some((f) => sig.test(blankComments(fs.readFileSync(f, 'utf8'))))) return 'tailwind-first'
    // Capped scan + no signature found: the directive may sit in a dropped file —
    // say so (per the no-silent-caps rule) instead of silently detecting inline.
    if (cssFiles.length >= CSS_SCAN_FILE_CAP) {
      console.warn(`[muse] strategy detection scanned ${CSS_SCAN_FILE_CAP}+ stylesheets without a Tailwind signature — defaulting to inline; set the strategy explicitly if that's wrong`)
    }
  } catch {
    // fall through
  }
  return 'inline'
}

// Same runaway backstop as the prop-text scan (PROP_SCAN_FILE_CAP): no real src/
// tree holds this many stylesheets, but a pathological one shouldn't hang an edit.
const CSS_SCAN_FILE_CAP = 2000

function collectCssFiles(dir: string, acc: string[]): void {
  if (acc.length >= CSS_SCAN_FILE_CAP) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (acc.length >= CSS_SCAN_FILE_CAP) return
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectCssFiles(full, acc)
    else if (e.isFile() && e.name.endsWith('.css')) acc.push(full)
  }
}

function findCssVarFiles(root: string, varName: string): string[] {
  const files: string[] = []
  collectCssFiles(path.join(root, 'src'), files)
  // A capped scan can miss the defining stylesheet — surface it (per the
  // no-silent-caps rule, like the prop-text scan) rather than no-op the edit.
  if (files.length >= CSS_SCAN_FILE_CAP) {
    console.warn(`[muse] CSS-variable scan hit the ${CSS_SCAN_FILE_CAP}-file cap; ${varName}'s defining stylesheet may have been missed`)
  }
  files.sort()
  const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  return files.filter((f) => {
    try {
      // Blank comments before testing: a commented-out `--x: old` in a file that
      // sorts earlier would otherwise win the pick, and the edit (editCssVar also
      // blanks comments) would silently land nowhere.
      return re.test(blankComments(fs.readFileSync(f, 'utf8')))
    } catch {
      return false
    }
  })
}

function resolveModuleSpecifier(root: string, fromAbs: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return resolveInSrc(root, path.resolve(path.dirname(fromAbs), specifier))
}

const STYLED_MODULE_EXTS = ['.tsx', '.ts', '.jsx', '.js']
// Given a base abs path (no extension), find the actual module file (exact, +ext, or
// /index.ext), bounded to src/. Shared by the relative + alias specifier resolvers.
function resolveModuleFileAbs(root: string, base: string): string | null {
  const candidates = [
    base,
    ...STYLED_MODULE_EXTS.map((e) => base + e),
    ...STYLED_MODULE_EXTS.map((e) => path.join(base, 'index' + e)),
  ]
  for (const c of candidates) {
    const hit = resolveInSrc(root, c)
    if (hit && fs.statSync(hit).isFile()) return hit
  }
  return null
}
function resolveStyledSpecifier(root: string, fromAbs: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return resolveModuleFileAbs(root, path.resolve(path.dirname(fromAbs), specifier))
}

function followStyledExport(
  root: string,
  moduleAbs: string,
  exportName: string,
): { abs: string; exportName: string } | null {
  let abs = moduleAbs
  let name = exportName
  const visited = new Set<string>()
  for (let hop = 0; hop < 6; hop++) {
    if (visited.has(abs)) return null
    visited.add(abs)
    let content: string
    try { content = fs.readFileSync(abs, 'utf8') } catch { return null }
    const loc = findStyledExport(content, name)
    if (!loc || !('reexport' in loc)) return { abs, exportName: name }
    const next = resolveStyledSpecifier(root, abs, loc.reexport.specifier)
    if (!next) return null
    abs = next
    name = loc.reexport.exportName
  }
  return null
}

// ---- Prop-text trace (Tier 2) -------------------------------------------------
// Clicked text that comes from a `{prop}` lives at the usage site (`<Cmp prop="…"/>`)
// in a CALLER of the clicked file — there's no import to follow forward, so we reverse-
// scan src/ for the callers. Bounded: capped file count, a cheap substring pre-filter
// before any parse, and a size guard, so the scan stays cheap on a large repo.

const SOURCE_EXTS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs'])
const PROP_SCAN_FILE_CAP = 2000 // most-callers repos are far smaller; a runaway backstop
const PROP_SCAN_MAX_BYTES = 512 * 1024 // skip a huge generated/bundle file

// Collect source files under `dir` into `acc`, skipping dot-dirs and node_modules, and
// stopping once `acc` hits the cap (so the scan can't run away on a giant tree).
function collectSourceFiles(dir: string, acc: string[]): void {
  if (acc.length >= PROP_SCAN_FILE_CAP) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (acc.length >= PROP_SCAN_FILE_CAP) return
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectSourceFiles(full, acc)
    else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) acc.push(full)
  }
}

const normalizeText = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

// Resolve a CALLER's import specifier to an absolute file, for the reverse scan. Handles
// relative imports AND the common `@/…` path-alias convention (the Next/Vite default,
// `@/* → ./src/*`, with a `<root>/*` fallback). Full tsconfig `paths` resolution is a
// future enhancement; this covers the dominant single-alias setup the dogfood hosts use.
function resolvePropImportSpecifier(root: string, fromAbs: string, specifier: string): string | null {
  if (specifier.startsWith('.')) return resolveStyledSpecifier(root, fromAbs, specifier)
  const alias = specifier.match(/^@\/(.+)$/)
  if (alias) {
    return resolveModuleFileAbs(root, path.join(root, 'src', alias[1])) ?? resolveModuleFileAbs(root, path.join(root, alias[1]))
  }
  return null
}

// The usage-site literal a clicked `{prop}` text resolves to: the file + the literal's
// inner range + its current value. Reverse-scans src/ for `<Component prop="literal">`
// callers whose import resolves to the CLICKED file, then disambiguates by the clicked
// node's rendered text (case-insensitive + trim — a host may uppercase via CSS). Returns
// a `reason` when there's no match, or more than one with the same text (the calm hint
// stands rather than risk editing the wrong instance).
type PropTextTarget = { abs: string; rel: string; valueStart: number; valueEnd: number; currentValue: string }
function resolvePropTextTarget(
  ctx: MuseContext,
  clickedAbs: string,
  intent: { componentExportName: string; propName: string },
  renderedText: string,
): PropTextTarget | { reason: string } {
  const want = normalizeText(renderedText)
  if (!want) return { reason: 'no rendered text to match the usage by' }
  const clickedBase = path.basename(clickedAbs, path.extname(clickedAbs)) // for the pre-filter
  const files: string[] = []
  collectSourceFiles(path.join(ctx.root, 'src'), files)

  const matches: PropTextTarget[] = []
  for (const abs of files) {
    let content: string
    try {
      const st = fs.statSync(abs)
      if (st.size > PROP_SCAN_MAX_BYTES) continue
      content = fs.readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    // Cheap pre-filter: a real caller mentions both the prop name and the clicked file's
    // basename (its import specifier references the file). Skips parsing most of src/.
    if (!content.includes(intent.propName) || !content.includes(clickedBase)) continue
    for (const u of findPropLiteralUsages(content, intent.componentExportName, intent.propName)) {
      // Keep only usages whose import actually resolves to the clicked file.
      if (resolvePropImportSpecifier(ctx.root, abs, u.specifier) !== clickedAbs) continue
      if (normalizeText(u.value) === want) {
        matches.push({ abs, rel: relOf(ctx.root, abs), valueStart: u.valueStart, valueEnd: u.valueEnd, currentValue: u.value })
      }
    }
  }
  if (matches.length === 0) {
    // The scan hit its file cap before finding a match — say so (and log) rather than a
    // flat "comes from data" that hides the truncation (per the no-silent-caps rule).
    if (files.length >= PROP_SCAN_FILE_CAP) {
      console.warn(`[muse] prop-text scan hit the ${PROP_SCAN_FILE_CAP}-file cap; a usage may have been missed`)
      return { reason: `searched ${PROP_SCAN_FILE_CAP}+ files without finding where this text is set` }
    }
    return { reason: 'this text comes from data, not static text' }
  }
  // More than one usage with the SAME rendered text → can't tell them apart safely.
  if (matches.length > 1) return { reason: 'this text appears in more than one place — edit it at the source' }
  return matches[0]
}

// Replace a usage-site string-literal's inner value (`valueStart`/`valueEnd` bound the
// text INSIDE the quotes). No JSX entity-encoding here — unlike JSXText, a string-literal
// value reads `<`/`>`/`{`/`}` as plain chars — but we DO trim and escape what would break
// the literal: backslashes, the quote char, and any newline (so the file stays parseable).
function spliceStringLiteralValue(source: string, valueStart: number, valueEnd: number, newText: string): string {
  const quote = source[valueStart - 1] // the opening quote char (" or ')
  const escaped = newText
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(quote, 'g'), '\\' + quote)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  return source.slice(0, valueStart) + escaped + source.slice(valueEnd)
}

// ---- Handlers -----------------------------------------------------------------

async function handleWrite(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const { files } = JSON.parse(await readBody(req))
    if (!Array.isArray(files) || files.length === 0) {
      return sendJson(res, 400, { error: 'No files to write.' })
    }

    const resolved: Array<{ abs: string; content: string }> = []
    for (const f of files) {
      const abs = resolveInSrc(ctx.root, f?.fileName)
      if (!abs) {
        return sendJson(res, 400, {
          error: `Refusing to write "${f?.fileName}" — must be an existing file under src/.`,
        })
      }
      if (typeof f.newContent !== 'string' || f.newContent.length === 0) {
        return sendJson(res, 400, { error: `Empty content for "${f.fileName}".` })
      }
      if (f.newContent.length > MAX_WRITE_BYTES) {
        return sendJson(res, 400, { error: `"${f.fileName}" exceeds ${MAX_WRITE_BYTES} bytes.` })
      }
      resolved.push({ abs, content: f.newContent })
    }
    for (const r of resolved) writeFileAtomic(r.abs, r.content)
    return sendJson(res, 200, { ok: true })
  } catch (err) {
    console.error('[muse] /write error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleStyleEdit(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      edits?: Array<{ fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; mutations?: unknown; scope?: unknown; classPatch?: unknown }>
      strategy?: unknown
    }
    const rawEdits = Array.isArray(body.edits) ? body.edits : []
    if (rawEdits.length === 0) return sendJson(res, 400, { error: 'No edits provided.' })

    const strategy: StyleStrategy =
      body.strategy === 'inline'
        ? 'inline'
        : body.strategy === 'tailwind-first'
          ? 'tailwind-first'
          : (ctx.detectedStrategy ??= detectStrategy(ctx.root))

    const out: Array<{ fileName: string; newContent: string }> = []
    const warnings: string[] = []
    const byFile = new Map<string, { abs: string; rel: string; items: Array<{ line: number; column: number; tag?: string; classNames?: string; mutations: Mutation[]; scope?: 'element' | 'const'; classPatch?: ClassPatch }> }>()

    for (const e of rawEdits) {
      const abs = resolveInSrc(ctx.root, e?.fileName)
      if (!abs) {
        warnings.push(`skipped "${String(e?.fileName)}" — not an editable file under src/.`)
        continue
      }
      const rel = relOf(ctx.root, abs)
      const line = Number(e?.line)
      const column = Number(e?.column)
      const tag = typeof e?.tag === 'string' ? e.tag : undefined
      const classNames = typeof e?.classNames === 'string' ? e.classNames : undefined
      const mutations = (Array.isArray(e?.mutations) ? e!.mutations : []) as Mutation[]
      // The freeform field's verbatim class op — strings only; the ENGINE gates
      // each added token through isSafeClassToken (the security boundary).
      const rawPatch = e?.classPatch as { add?: unknown; remove?: unknown } | undefined
      const onlyStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
      const classPatch: ClassPatch | undefined = rawPatch ? { add: onlyStrings(rawPatch.add), remove: onlyStrings(rawPatch.remove) } : undefined
      const hasPatch = !!classPatch && (classPatch.add.length > 0 || classPatch.remove.length > 0)
      if (!Number.isInteger(line) || line <= 0 || (mutations.length === 0 && !hasPatch)) {
        warnings.push(`skipped ${rel} — needs a positive line and at least one mutation or class edit.`)
        continue
      }
      const scope = e?.scope === 'const' ? 'const' : 'element'
      const bucket = byFile.get(rel) ?? { abs, rel, items: [] }
      bucket.items.push({ line, column: Number.isFinite(column) ? column : 0, tag, classNames, mutations, scope, classPatch: hasPatch ? classPatch : undefined })
      byFile.set(rel, bucket)
    }

    const originals: Record<string, string> = {}
    // The shared-const a target's `style={X}` points at — surfaced so the client can
    // offer "apply to all" (canvas commits one element per call, so a single value).
    let sharedConst: { name: string; sameFileCount: number; exported: boolean } | undefined
    const varEdits: VarEdit[] = []
    const moduleEdits: Array<{ cssAbs: string; cssRel: string; className: string; cssProp: string; value: string }> = []
    const unresolvedModule = new Set<string>()
    const styledEdits: Array<{ tgtAbs: string; tgtRel: string; exportName: string; cssProp: string; value: string }> = []
    const unresolvedStyled = new Set<string>()

    for (const { abs, rel, items } of byFile.values()) {
      let content = fs.readFileSync(abs, 'utf8')
      const before = content
      let changed = false
      items.sort((a, b) => b.line - a.line)
      for (const it of items) {
        const result = computeStyleEdit(content, it.line, it.column, it.mutations, strategy, it.tag, it.classNames, ctx.lineOffsetHint, it.scope, it.classPatch)
        if (result.sharedConst && !sharedConst) sharedConst = result.sharedConst
        if (result.warnings.length) warnings.push(...result.warnings.map((w) => `${rel}: ${w}`))
        if (result.varEdits.length) varEdits.push(...result.varEdits)
        for (const me of result.moduleEdits) {
          const cssAbs = resolveModuleSpecifier(ctx.root, abs, me.specifier)
          if (!cssAbs) {
            const key = `${rel}::${me.specifier}`
            if (!unresolvedModule.has(key)) {
              unresolvedModule.add(key)
              warnings.push(me.specifier.startsWith('.')
                ? `${rel}: couldn't resolve CSS module "${me.specifier}" under src/ — left unchanged.`
                : `${rel}: CSS module "${me.specifier}" is an alias/package import — only relative ./ imports are editable; left unchanged.`)
            }
            continue
          }
          moduleEdits.push({ cssAbs, cssRel: relOf(ctx.root, cssAbs), className: me.className, cssProp: me.cssProp, value: me.value })
        }
        for (const se of result.styledEdits) {
          const firstAbs = resolveStyledSpecifier(ctx.root, abs, se.specifier)
          const final = firstAbs ? followStyledExport(ctx.root, firstAbs, se.exportName) : null
          if (!final) {
            const key = `${rel}::${se.specifier}`
            if (!unresolvedStyled.has(key)) {
              unresolvedStyled.add(key)
              warnings.push(`${rel}: couldn't resolve styled import "${se.specifier}" under src/ — left unchanged.`)
            }
            continue
          }
          styledEdits.push({ tgtAbs: final.abs, tgtRel: relOf(ctx.root, final.abs), exportName: final.exportName, cssProp: se.cssProp, value: se.value })
        }
        if (result.changed) {
          content = result.newContent
          changed = true
        }
      }
      if (changed) {
        originals[rel] = before
        out.push({ fileName: rel, newContent: content })
      }
    }

    if (varEdits.length) {
      const byVar = new Map<string, string>()
      const order: string[] = []
      for (const ve of varEdits) {
        if (byVar.has(ve.varName) && byVar.get(ve.varName) !== ve.value) {
          warnings.push(`${ve.varName} got conflicting values in one edit — kept the last (${ve.value}).`)
        }
        if (!byVar.has(ve.varName)) order.push(ve.varName)
        byVar.set(ve.varName, ve.value)
      }
      const cssByFile = new Map<string, { abs: string; rel: string; vars: Array<[string, string]> }>()
      for (const varName of order) {
        const cssFiles = findCssVarFiles(ctx.root, varName)
        if (cssFiles.length === 0) {
          warnings.push(`couldn't find where ${varName} is defined — left unchanged.`)
          continue
        }
        if (cssFiles.length > 1) {
          warnings.push(`${varName} is defined in ${cssFiles.length} stylesheets — edited ${relOf(ctx.root, cssFiles[0])}.`)
        }
        const abs = cssFiles[0]
        const rel = relOf(ctx.root, abs)
        const bucket = cssByFile.get(rel) ?? { abs, rel, vars: [] }
        bucket.vars.push([varName, byVar.get(varName)!])
        cssByFile.set(rel, bucket)
      }
      for (const { abs, rel, vars } of cssByFile.values()) {
        let content = fs.readFileSync(abs, 'utf8')
        const before = content
        let changed = false
        for (const [varName, value] of vars) {
          const r = editCssVar(content, varName, value)
          if (r.matches > 1) {
            warnings.push(`${varName} is themed in ${r.matches} selectors — updated the base value; theme overrides unchanged.`)
          }
          if (r.changed) {
            warnings.push(`updated ${varName} in ${rel} — this changes everything that uses it.`)
            content = r.newContent
            changed = true
          }
        }
        if (changed) {
          if (!(rel in originals)) originals[rel] = before
          out.push({ fileName: rel, newContent: content })
        }
      }
    }

    if (moduleEdits.length) {
      const byCss = new Map<string, { abs: string; rel: string; edits: Array<{ className: string; cssProp: string; value: string }> }>()
      for (const me of moduleEdits) {
        const bucket = byCss.get(me.cssRel) ?? { abs: me.cssAbs, rel: me.cssRel, edits: [] }
        bucket.edits.push({ className: me.className, cssProp: me.cssProp, value: me.value })
        byCss.set(me.cssRel, bucket)
      }
      for (const { abs, rel, edits } of byCss.values()) {
        const staged = out.find((o) => o.fileName === rel)
        let content = staged ? staged.newContent : fs.readFileSync(abs, 'utf8')
        const before = content
        let changed = false
        for (const { className, cssProp, value } of edits) {
          const r = setRuleProperty(content, className, cssProp, value)
          if (r.matches > 1) {
            warnings.push(`.${className} is defined in ${r.matches} rules in ${rel} — edited the first; media/theme overrides unchanged.`)
          }
          if (r.changed) {
            content = r.newContent
            changed = true
            if (r.grouped) {
              warnings.push(`.${className} shares a rule with other selectors in ${rel} — they were restyled too.`)
            }
          } else if (r.matches === 0) {
            warnings.push(`no .${className} rule in ${rel} — left ${cssProp} unchanged.`)
          }
        }
        if (changed) {
          if (staged) staged.newContent = content
          else {
            originals[rel] = before
            out.push({ fileName: rel, newContent: content })
          }
        }
      }
    }

    if (styledEdits.length) {
      const byModule = new Map<string, { abs: string; rel: string; byExport: Map<string, Array<{ cssProp: string; value: string }>> }>()
      for (const se of styledEdits) {
        const bucket = byModule.get(se.tgtRel) ?? { abs: se.tgtAbs, rel: se.tgtRel, byExport: new Map() }
        const props = bucket.byExport.get(se.exportName) ?? []
        props.push({ cssProp: se.cssProp, value: se.value })
        bucket.byExport.set(se.exportName, props)
        byModule.set(se.tgtRel, bucket)
      }
      for (const { abs, rel, byExport } of byModule.values()) {
        const staged = out.find((o) => o.fileName === rel)
        let content = staged ? staged.newContent : fs.readFileSync(abs, 'utf8')
        const before = content
        let changed = false
        for (const [exportName, props] of byExport) {
          const label = exportName === 'default' ? 'default export' : `"${exportName}"`
          const loc = findStyledExport(content, exportName)
          if (!loc) {
            warnings.push(`${rel}: no styled ${label} found — left unchanged (an imported component that isn't a styled template here).`)
            continue
          }
          if ('reexport' in loc) {
            warnings.push(`${rel}: styled ${label} re-exports another module — left unchanged.`)
            continue
          }
          if ('unsupported' in loc) {
            warnings.push(`${rel}: styled ${label} is ${loc.unsupported} — left unchanged.`)
            continue
          }
          if ('object' in loc) {
            const ps = styledObjectPatches(content, loc.object, props.map((p) => [p.cssProp, p.value] as [string, string]))
            if (ps.length) {
              ps.sort((a, b) => b.start - a.start)
              for (const p of ps) content = content.slice(0, p.start) + p.text + content.slice(p.end)
              changed = true
            }
            continue
          }
          let body = content.slice(loc.bodyStart, loc.bodyEnd)
          let any = false
          for (const { cssProp, value } of props) {
            const r = setTemplateProperty(body, cssProp, value)
            if (r.changed) { body = r.newContent; any = true }
          }
          if (any) {
            content = content.slice(0, loc.bodyStart) + body + content.slice(loc.bodyEnd)
            changed = true
          }
        }
        if (changed) {
          if (staged) staged.newContent = content
          else {
            originals[rel] = before
            out.push({ fileName: rel, newContent: content })
          }
        }
      }
    }

    if (out.length === 0) {
      // Even with no edit (e.g. a probe-only call or a no-op), surface sharedConst so
      // the client can still offer "apply to all" off this element's style.
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['no changes computed'], sharedConst })
    }
    return sendJson(res, 200, { edits: out, originals, warnings, sharedConst })
  } catch (err) {
    console.error('[muse] /style-edit error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

// Probe whether the selected element's style is `style={X}` bound to a shared same-file
// const, so the client can show the "this element / all instances" scope toggle BEFORE
// a scrub. Fails CLOSED on any error (no toggle) — the per-element commit is always
// available, and a re-select simply re-probes.
async function handleStyleScope(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown }
    const abs = resolveInSrc(ctx.root, b?.fileName)
    const line = Number(b?.line)
    if (!abs || !Number.isInteger(line) || line <= 0) return sendJson(res, 200, { sharedConst: null })
    const source = fs.readFileSync(abs, 'utf8')
    const tag = typeof b?.tag === 'string' ? b.tag : undefined
    const classNames = typeof b?.classNames === 'string' ? b.classNames : undefined
    const sharedConst = computeStyleScope(source, line, Number.isFinite(Number(b?.column)) ? Number(b?.column) : 0, tag, classNames, ctx.lineOffsetHint)
    return sendJson(res, 200, { sharedConst })
  } catch (err) {
    console.error('[muse] /style-scope error:', err)
    return sendJson(res, 200, { sharedConst: null })
  }
}

async function handleTextEdit(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      edits?: Array<{ fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; text?: unknown; renderedText?: unknown }>
    }
    const rawEdits = Array.isArray(body.edits) ? body.edits : []
    if (rawEdits.length === 0) return sendJson(res, 400, { error: 'No edits provided.' })

    const out: Array<{ fileName: string; newContent: string }> = []
    const originals: Record<string, string> = {}
    const warnings: string[] = []
    const byFile = new Map<string, { abs: string; rel: string; items: Array<{ line: number; column: number; tag?: string; classNames?: string; text: string }> }>()
    // Prop-text edits resolved cross-file (the usage-site literal in a CALLER). Kept
    // separate from byFile because they target a different file + a character range.
    const propSplices: Array<{ abs: string; rel: string; valueStart: number; valueEnd: number; newText: string }> = []

    for (const e of rawEdits) {
      const abs = resolveInSrc(ctx.root, e?.fileName)
      if (!abs) {
        warnings.push(`skipped "${String(e?.fileName)}" — not an editable file under src/.`)
        continue
      }
      const rel = relOf(ctx.root, abs)
      const line = Number(e?.line)
      const column = Number(e?.column)
      const col = Number.isFinite(column) ? column : 0
      const tag = typeof e?.tag === 'string' ? e.tag : undefined
      const classNames = typeof e?.classNames === 'string' ? e.classNames : undefined
      const text = typeof e?.text === 'string' ? e.text : null
      const renderedText = typeof e?.renderedText === 'string' ? e.renderedText : null
      if (!Number.isInteger(line) || line <= 0 || text === null) {
        warnings.push(`skipped ${rel} — needs a positive line and text.`)
        continue
      }
      // Prop-text trace: when the clicked element's text is a single `{prop}` (the engine's
      // "comes from data" case) and the client sent the element's rendered text to match by,
      // trace it to the usage-site literal in a caller and edit THAT (a different file).
      if (renderedText) {
        let clickedSrc = ''
        try { clickedSrc = fs.readFileSync(abs, 'utf8') } catch { /* fall through to static */ }
        const intent = clickedSrc ? computePropTextIntent(clickedSrc, line, col, tag, classNames, ctx.lineOffsetHint) : null
        if (intent) {
          const target = resolvePropTextTarget(ctx, abs, intent, renderedText)
          if ('reason' in target) { warnings.push(`${rel}: ${target.reason}`); continue }
          propSplices.push({ abs: target.abs, rel: target.rel, valueStart: target.valueStart, valueEnd: target.valueEnd, newText: text })
          continue
        }
      }
      const bucket = byFile.get(rel) ?? { abs, rel, items: [] }
      bucket.items.push({ line, column: col, tag, classNames, text })
      byFile.set(rel, bucket)
    }

    for (const { abs, rel, items } of byFile.values()) {
      let content = fs.readFileSync(abs, 'utf8')
      const before = content
      let changed = false
      items.sort((a, b) => b.line - a.line)
      for (const it of items) {
        const result = computeTextEdit(content, it.line, it.column, it.text, it.tag, it.classNames, ctx.lineOffsetHint)
        if (result.warnings.length) warnings.push(...result.warnings.map((w) => `${rel}: ${w}`))
        if (result.changed) { content = result.newContent; changed = true }
      }
      if (changed) {
        originals[rel] = before
        out.push({ fileName: rel, newContent: content })
      }
    }

    // Apply prop-trace splices (usage-site literals, usually a DIFFERENT file). Group by
    // target file, right-to-left so earlier offsets stay valid.
    const byTarget = new Map<string, { abs: string; rel: string; splices: Array<{ valueStart: number; valueEnd: number; newText: string }> }>()
    for (const p of propSplices) {
      const g = byTarget.get(p.rel) ?? { abs: p.abs, rel: p.rel, splices: [] }
      g.splices.push({ valueStart: p.valueStart, valueEnd: p.valueEnd, newText: p.newText })
      byTarget.set(p.rel, g)
    }
    for (const { abs, rel, splices } of byTarget.values()) {
      // A normal static-text edit already wrote this file this batch → its offsets moved,
      // so skip the prop splice (defensive; a single canvas edit never hits this).
      if (rel in originals) { warnings.push(`${rel}: skipped a prop-text edit overlapping another edit to the same file`); continue }
      let content: string
      try { content = fs.readFileSync(abs, 'utf8') } catch { warnings.push(`${rel}: couldn't read the usage file`); continue }
      const before = content
      splices.sort((a, b) => b.valueStart - a.valueStart)
      for (const s of splices) content = spliceStringLiteralValue(content, s.valueStart, s.valueEnd, s.newText)
      if (content !== before) { originals[rel] = before; out.push({ fileName: rel, newContent: content }) }
    }

    if (out.length === 0) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['no changes computed'] })
    }
    return sendJson(res, 200, { edits: out, originals, warnings })
  } catch (err) {
    console.error('[muse] /text-edit error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleTextEditable(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; renderedText?: unknown }
    const abs = resolveInSrc(ctx.root, b?.fileName)
    const line = Number(b?.line)
    if (!abs || !Number.isInteger(line) || line <= 0) {
      return sendJson(res, 200, { editable: false, reason: 'not an editable element' })
    }
    const source = fs.readFileSync(abs, 'utf8')
    const col = Number.isFinite(Number(b?.column)) ? Number(b?.column) : 0
    const tag = typeof b?.tag === 'string' ? b.tag : undefined
    const classNames = typeof b?.classNames === 'string' ? b.classNames : undefined
    const result = computeTextEditable(source, line, col, tag, classNames, ctx.lineOffsetHint)
    // Not statically editable, but the text may come from a `{prop}` whose literal lives
    // at a usage site (`<Cmp prop="…"/>`). If the client sent the rendered text and a
    // unique caller resolves, it IS editable (the trace will rewrite the usage literal).
    if (!result.editable && typeof b?.renderedText === 'string' && b.renderedText) {
      const intent = computePropTextIntent(source, line, col, tag, classNames, ctx.lineOffsetHint)
      if (intent) {
        const target = resolvePropTextTarget(ctx, abs, intent, b.renderedText)
        if (!('reason' in target)) return sendJson(res, 200, { editable: true })
      }
    }
    return sendJson(res, 200, result)
  } catch (err) {
    console.error('[muse] /text-editable error:', err)
    return sendJson(res, 200, { editable: false, reason: 'check failed' })
  }
}

async function handleReorder(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      edits?: Array<{ fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; toIndex?: unknown; fromIndex?: unknown }>
    }
    const rawEdits = Array.isArray(body.edits) ? body.edits : []
    if (rawEdits.length === 0) return sendJson(res, 400, { error: 'No edits provided.' })

    const out: Array<{ fileName: string; newContent: string }> = []
    const originals: Record<string, string> = {}
    const warnings: string[] = []
    // `fromIndex` present → CONTAINER mode: the location is the host CONTAINER and we move
    // its child at fromIndex (the only way to reorder COMPONENT children, which can't be
    // located in source). Absent → child mode (location is the moved host child).
    const byFile = new Map<string, { abs: string; rel: string; items: Array<{ line: number; column: number; tag?: string; classNames?: string; toIndex: number; fromIndex: number | null }> }>()

    for (const e of rawEdits) {
      const abs = resolveInSrc(ctx.root, e?.fileName)
      if (!abs) {
        warnings.push(`skipped "${String(e?.fileName)}" — not an editable file under src/.`)
        continue
      }
      const rel = relOf(ctx.root, abs)
      const line = Number(e?.line)
      const column = Number(e?.column)
      const toIndex = Number(e?.toIndex)
      const fromIndex = Number.isInteger(Number(e?.fromIndex)) ? Number(e?.fromIndex) : null
      const tag = typeof e?.tag === 'string' ? e.tag : undefined
      const classNames = typeof e?.classNames === 'string' ? e.classNames : undefined
      if (!Number.isInteger(line) || line <= 0 || !Number.isInteger(toIndex) || toIndex < 0) {
        warnings.push(`skipped ${rel} — needs a positive line and a target slot.`)
        continue
      }
      const bucket = byFile.get(rel) ?? { abs, rel, items: [] }
      bucket.items.push({ line, column: Number.isFinite(column) ? column : 0, tag, classNames, toIndex, fromIndex })
      byFile.set(rel, bucket)
    }

    for (const { abs, rel, items } of byFile.values()) {
      let content = fs.readFileSync(abs, 'utf8')
      const before = content
      let changed = false
      items.sort((a, b) => b.line - a.line)
      for (const it of items) {
        const result = it.fromIndex !== null
          ? computeReorderChildren(content, it.line, it.column, it.fromIndex, it.toIndex, it.tag, it.classNames, ctx.lineOffsetHint)
          : computeReorder(content, it.line, it.column, it.toIndex, it.tag, it.classNames, ctx.lineOffsetHint)
        if (result.warnings.length) warnings.push(...result.warnings.map((w) => `${rel}: ${w}`))
        if (result.changed) { content = result.newContent; changed = true }
      }
      if (changed) {
        originals[rel] = before
        out.push({ fileName: rel, newContent: content })
      }
    }

    if (out.length === 0) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['no changes computed'] })
    }
    // A reorder shifts line numbers, so the learned Fast-Refresh offset can go stale.
    // Drop it so the next locate re-learns it fresh.
    ctx.lineOffsetHint.value = null
    return sendJson(res, 200, { edits: out, originals, warnings })
  } catch (err) {
    console.error('[muse] /reorder error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleReorderable(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; container?: unknown }
    const abs = resolveInSrc(ctx.root, b?.fileName)
    const line = Number(b?.line)
    if (!abs || !Number.isInteger(line) || line <= 0) {
      return sendJson(res, 200, { reorderable: false, reason: 'not a reorderable element' })
    }
    const source = fs.readFileSync(abs, 'utf8')
    const col = Number.isFinite(Number(b?.column)) ? Number(b?.column) : 0
    const tag = typeof b?.tag === 'string' ? b.tag : undefined
    const classNames = typeof b?.classNames === 'string' ? b.classNames : undefined
    // `container: true` → the location is the host CONTAINER; probe whether ITS children
    // (which may be components) can be reordered. Else the location is a host child.
    const result = b?.container === true
      ? computeReorderableContainer(source, line, col, tag, classNames, ctx.lineOffsetHint)
      : computeReorderable(source, line, col, tag, classNames, ctx.lineOffsetHint)
    return sendJson(res, 200, result)
  } catch (err) {
    console.error('[muse] /reorderable error:', err)
    return sendJson(res, 200, { reorderable: false, reason: 'check failed' })
  }
}

// GET /api/muse/tokens — the host's design tokens: every CSS custom property defined
// under src/ (first definition wins; Muse's own --muse-* overlay tokens excluded), with
// a flag for color-valued ones. Lets the user edit a token without first finding an
// element that uses it. Read-only discovery; edits go through token-edit.
async function handleTokens(_req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const cssFiles: string[] = []
    collectCssFiles(path.join(ctx.root, 'src'), cssFiles)
    cssFiles.sort()
    const seen = new Set<string>()
    const tokens: Array<{ name: string; value: string; isColor: boolean; file: string }> = []
    for (const abs of cssFiles) {
      let css: string
      try { css = fs.readFileSync(abs, 'utf8') } catch { continue }
      for (const v of listCssVars(css)) {
        if (seen.has(v.name) || v.name.startsWith('--muse-')) continue
        seen.add(v.name)
        tokens.push({ name: v.name, value: v.value, isColor: looksLikeColor(v.value), file: relOf(ctx.root, abs) })
      }
    }
    return sendJson(res, 200, { tokens })
  } catch (err) {
    console.error('[muse] /tokens error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

// POST /api/muse/token-edit { name, value } — set a token's BASE value in the stylesheet
// that defines it, reusing the var-edit splice (and its value-safety guards). Returns the
// same { edits, originals, warnings } contract as the canvas edits, so it flows through
// the existing write + undo/redo path.
async function handleTokenEdit(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { name?: unknown; value?: unknown }
    const name = typeof b?.name === 'string' ? b.name : ''
    const value = typeof b?.value === 'string' ? b.value : ''
    if (!/^--[A-Za-z0-9_-]+$/.test(name) || !value.trim()) {
      return sendJson(res, 400, { error: 'A token name (--x) and a value are required.' })
    }
    const cssFiles = findCssVarFiles(ctx.root, name)
    if (cssFiles.length === 0) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: [`couldn't find where ${name} is defined.`] })
    }
    const abs = cssFiles[0]
    const rel = relOf(ctx.root, abs)
    const before = fs.readFileSync(abs, 'utf8')
    const r = editCssVar(before, name, value)
    const warnings: string[] = []
    if (cssFiles.length > 1) warnings.push(`${name} is defined in ${cssFiles.length} stylesheets — edited ${rel}.`)
    if (r.matches > 1) warnings.push(`${name} is themed in ${r.matches} selectors — updated the base value; theme overrides unchanged.`)
    if (!r.changed) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['nothing to change'] })
    }
    return sendJson(res, 200, { edits: [{ fileName: rel, newContent: r.newContent }], originals: { [rel]: before }, warnings })
  } catch (err) {
    console.error('[muse] /token-edit error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

// ---- Flags handlers -----------------------------------------------------------

// POST /api/muse/flag { FlagDraft } — capture a flag (shift-click or a refusal "Flag it").
// Validates the file is under src/ (same gate as /write), stores a REPO-RELATIVE path +
// a monotonic id, and appends to `.muse/flags.json`. Muse routes ZERO inference — the
// flag is a work-order the user's own Claude Code resolves via muse-mcp.
async function handleFlag(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const d = JSON.parse(await readBody(req)) as Partial<FlagDraft>
    const abs = resolveInSrc(ctx.root, d?.fileName)
    if (!abs) {
      return sendJson(res, 400, {
        error: `Refusing to flag "${d?.fileName}" — must be an existing file under src/.`,
      })
    }
    const line = Number(d?.line)
    const column = Number(d?.column)
    if (!Number.isFinite(line) || !Number.isFinite(column)) {
      return sendJson(res, 400, { error: 'A flag needs a line and column.' })
    }
    const data = readFlagsFile(ctx.root)
    // Allocate the id from BOTH the stored counter AND the highest existing flag id, so a
    // concurrent muse-mcp write that regressed nextId (the cross-process last-write-wins
    // window) can never make us mint a DUPLICATE id.
    const maxId = data.flags.reduce((m, f) => {
      const n = Number.parseInt(f.id.replace(/^f_/, ''), 10)
      return Number.isFinite(n) && n > m ? n : m
    }, 0)
    const num = Math.max(data.nextId, maxId + 1)
    // Instance context is ADVISORY — a malformed usage/instance never rejects the flag
    // (the work-order matters more than the disambiguator), it's just dropped. usage.file
    // goes through the same src/ gate + repo-relative conversion as the main loc.
    let usage: Flag['usage']
    if (d?.usage && typeof d.usage.fileName === 'string') {
      const uAbs = resolveInSrc(ctx.root, d.usage.fileName)
      const uLine = Number(d.usage.line)
      const uColumn = Number(d.usage.column)
      if (uAbs && Number.isFinite(uLine) && Number.isFinite(uColumn)) {
        usage = {
          file: relOf(ctx.root, uAbs),
          line: uLine,
          column: uColumn,
          tag: typeof d.usage.tag === 'string' ? d.usage.tag : '',
        }
      }
    }
    const crumbs = Array.isArray(d?.crumbs)
      ? d.crumbs.filter((c): c is string => typeof c === 'string').slice(0, 4)
      : []
    const iIdx = Number(d?.instanceIndex)
    const iCnt = Number(d?.instanceCount)
    const hasInstance = Number.isInteger(iIdx) && Number.isInteger(iCnt) && iIdx >= 1 && iCnt >= iIdx
    const flag: Flag = {
      id: `f_${num}`,
      comment: typeof d?.comment === 'string' ? d.comment.trim() : '',
      status: 'open',
      file: relOf(ctx.root, abs),
      line,
      column,
      tag: typeof d?.tag === 'string' ? d.tag : '',
      className: typeof d?.className === 'string' ? d.className : '',
      text: typeof d?.text === 'string' ? d.text : '',
      property: typeof d?.property === 'string' ? d.property : undefined,
      reason: typeof d?.reason === 'string' ? d.reason : undefined,
      ...(crumbs.length > 0 ? { crumbs } : {}),
      ...(usage ? { usage } : {}),
      ...(hasInstance ? { instanceIndex: iIdx, instanceCount: iCnt } : {}),
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null,
    }
    data.flags.push(flag)
    data.nextId = num + 1
    writeFlagsFile(ctx.root, data)
    return sendJson(res, 200, { ok: true, flag })
  } catch (err) {
    console.error('[muse] /flag error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

// GET /api/muse/flags — return EVERY flag. Status filtering is done client-side and
// MCP-side so this endpoint stays adapter-agnostic (no query-string parsing, which the
// three adapters wrap differently).
async function handleFlagsList(_req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    return sendJson(res, 200, { flags: readFlagsFile(ctx.root).flags })
  } catch (err) {
    console.error('[muse] /flags error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

// POST /api/muse/flag-resolve { id, note? } — mark a flag resolved. Used by the in-overlay
// panel. (muse-mcp's resolve_flag does NOT route through here — it writes the file directly
// so you can resolve with the app closed; the two writers are v1 last-write-wins.)
async function handleFlagResolve(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { id?: unknown; note?: unknown }
    const id = typeof b?.id === 'string' ? b.id : ''
    if (!id) return sendJson(res, 400, { error: 'A flag id is required.' })
    const data = readFlagsFile(ctx.root)
    const flag = data.flags.find((f) => f.id === id)
    if (!flag) return sendJson(res, 404, { error: `No flag ${id}.` })
    flag.status = 'resolved'
    flag.resolvedAt = new Date().toISOString()
    flag.resolution = typeof b?.note === 'string' ? b.note : null
    writeFlagsFile(ctx.root, data)
    return sendJson(res, 200, { ok: true, flag })
  } catch (err) {
    console.error('[muse] /flag-resolve error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

// POST /api/muse/share-probe { files } — can this session be shared as a branch/PR?
// Fail-closed like /style-scope: ANY error reports unavailable (status 200) with a
// designer-readable reason, so the client only ever renders a Share button that works.
// POST because the probe needs the session file list (for dirtyOtherCount), matching
// the /text-editable & /reorderable probe idiom.
async function handleShareProbe(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { files?: unknown }
    const files = Array.isArray(b?.files) ? b.files.filter((f): f is string => typeof f === 'string') : []
    return sendJson(res, 200, await probeShare(ctx.root, files))
  } catch (err) {
    console.error('[muse] /share-probe error:', err)
    return sendJson(res, 200, { available: false, reason: 'Couldn’t check the repository — try again, or ask an engineer to take a look.' })
  }
}

// POST /api/muse/share — turn the session's touched files into a muse/* branch
// (+ push + PR when the environment allows). Every path is gated through resolveInSrc,
// the SAME boundary as /write: sharing can only ever commit files Muse could edit.
// Validation failures are 400; pipeline outcomes ride the ShareResult discriminator
// at 200 (ok:false covers benign cases like "nothing to share").
async function handleShare(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as {
      files?: unknown
      changes?: unknown
      slugHint?: unknown
      branch?: unknown
    }
    const rawFiles = Array.isArray(b?.files) ? b.files : []
    if (rawFiles.length === 0) return sendJson(res, 400, { ok: false, error: 'No files to share.' })
    const files: string[] = []
    for (const f of rawFiles) {
      const abs = resolveInSrc(ctx.root, f)
      if (!abs) {
        return sendJson(res, 400, { ok: false, error: `Refusing to share "${String(f)}" — not an editable file under src/.` })
      }
      files.push(relOf(ctx.root, abs))
    }
    const changes: ShareChange[] = (Array.isArray(b?.changes) ? b.changes : [])
      .filter((c): c is { fileName: string; labels: unknown[] } =>
        !!c && typeof (c as { fileName?: unknown }).fileName === 'string' && Array.isArray((c as { labels?: unknown }).labels))
      .map((c) => ({
        fileName: c.fileName,
        labels: c.labels.filter((l): l is string => typeof l === 'string').slice(0, 50),
      }))
    const result = await performShare(ctx.root, {
      files,
      changes,
      slugHint: typeof b?.slugHint === 'string' ? b.slugHint : undefined,
      branch: typeof b?.branch === 'string' ? b.branch : undefined,
    })
    return sendJson(res, 200, result)
  } catch (err) {
    console.error('[muse] /share error:', err)
    return sendJson(res, 500, { ok: false, error: (err as Error).message ?? String(err) })
  }
}

// POST /api/muse/flag-delete { id } | { clearResolved: true } — remove one flag (panel
// dismiss) or sweep all resolved ones (muse-mcp clear_resolved).
async function handleFlagDelete(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { id?: unknown; clearResolved?: unknown }
    const data = readFlagsFile(ctx.root)
    let next: Flag[]
    if (b?.clearResolved === true) {
      next = data.flags.filter((f) => f.status !== 'resolved')
    } else {
      const id = typeof b?.id === 'string' ? b.id : ''
      if (!id) return sendJson(res, 400, { error: 'A flag id (or clearResolved) is required.' })
      next = data.flags.filter((f) => f.id !== id)
    }
    const removed = data.flags.length - next.length
    data.flags = next
    writeFlagsFile(ctx.root, data)
    return sendJson(res, 200, { ok: true, removed })
  } catch (err) {
    console.error('[muse] /flag-delete error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}
