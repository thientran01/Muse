import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { FlagsFile } from './types.js'

// Find the project root the flags live under. Claude Code launches this server with cwd
// = wherever the user invoked it, which is usually but not always the project root. The
// `.muse/` dir is the most specific signal (it's literally what we're after), so walk up
// for it first; fall back to the nearest package.json dir, then cwd. An explicit
// MUSE_ROOT env or --root flag always wins.
export function resolveRoot(start: string, override?: string): string {
  if (override) return path.resolve(override)

  const findUp = (name: string, mustBeDir: boolean): string | null => {
    let dir = path.resolve(start)
    for (;;) {
      try {
        const st = fs.statSync(path.join(dir, name))
        // `.muse` must be a DIRECTORY — a stray `.muse` FILE up the tree would otherwise
        // be picked as the root, then writeFlags's mkdir would crash on it.
        if (!mustBeDir || st.isDirectory()) return dir
      } catch {
        /* not at this level */
      }
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  return findUp('.muse', true) ?? findUp('package.json', false) ?? path.resolve(start)
}

const flagsPath = (root: string): string => path.join(root, '.muse', 'flags.json')

// One entry in flags.json — kept in sync with types.ts (and the overlay's
// src/muse/types.ts). Passthrough so unknown fields survive a round-trip.
// resolvedAt/resolution default absent → null: the dev server always writes
// them, but a hand-repaired file that omits them shouldn't brick every flag.
const FlagSchema = z
  .object({
    id: z.string(),
    comment: z.string(),
    status: z.enum(['open', 'resolved']),
    file: z.string(),
    line: z.number(),
    column: z.number(),
    tag: z.string(),
    className: z.string(),
    text: z.string(),
    property: z.string().optional(),
    reason: z.string().optional(),
    createdAt: z.string(),
    resolvedAt: z.string().nullable().default(null),
    resolution: z.string().nullable().default(null),
  })
  .passthrough()

export function readFlags(root: string): FlagsFile {
  let raw: string
  try {
    raw = fs.readFileSync(flagsPath(root), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, nextId: 1, flags: [] } // no flags captured yet
    }
    throw err
  }
  let parsed: Partial<FlagsFile>
  try {
    parsed = JSON.parse(raw) as Partial<FlagsFile>
  } catch {
    // Match the backend's message rather than surfacing a raw V8 SyntaxError.
    throw new Error('.muse/flags.json is corrupt — fix or delete it to continue.')
  }
  // Top-level leniency mirrors the dev-server backend (missing nextId/flags reads
  // as a fresh file) — but flag ENTRIES are schema-validated. Two processes write
  // this file; a malformed entry silently cast through would be rewritten (or
  // dropped) on the next write, so fail loudly instead. `.passthrough()` keeps
  // fields a newer Muse adds, so an older muse-mcp doesn't strip them on rewrite.
  const flags = Array.isArray(parsed.flags) ? parsed.flags : []
  const result = z.array(FlagSchema).safeParse(flags)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(
      `.muse/flags.json has a malformed flag (flags.${first.path.join('.')}: ${first.message}) — fix or delete it to continue.`,
    )
  }
  return {
    version: 1,
    nextId: typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : 1,
    flags: result.data as FlagsFile['flags'],
  }
}

// Write atomically (temp + rename) — the same discipline the dev-server backend uses, so
// a concurrent reader never catches a torn half-write.
function writeFileAtomic(abs: string, content: string): void {
  const dir = path.dirname(abs)
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, content, 'utf8')
  try {
    fs.renameSync(tmp, abs)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw err
  }
}

export function writeFlags(root: string, data: FlagsFile): void {
  const dir = path.join(root, '.muse')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  writeFileAtomic(flagsPath(root), JSON.stringify(data, null, 2) + '\n')
}
