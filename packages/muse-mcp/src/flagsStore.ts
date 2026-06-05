import fs from 'node:fs'
import path from 'node:path'
import type { Flag, FlagsFile } from './types.js'

// Find the project root the flags live under. Claude Code launches this server with cwd
// = wherever the user invoked it, which is usually but not always the project root. The
// `.muse/` dir is the most specific signal (it's literally what we're after), so walk up
// for it first; fall back to the nearest package.json dir, then cwd. An explicit
// MUSE_ROOT env or --root flag always wins.
export function resolveRoot(start: string, override?: string): string {
  if (override) return path.resolve(override)

  const findUp = (name: string): string | null => {
    let dir = path.resolve(start)
    for (;;) {
      if (fs.existsSync(path.join(dir, name))) return dir
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  return findUp('.muse') ?? findUp('package.json') ?? path.resolve(start)
}

const flagsPath = (root: string): string => path.join(root, '.muse', 'flags.json')

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
  const parsed = JSON.parse(raw) as Partial<FlagsFile>
  return {
    version: 1,
    nextId: typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : 1,
    flags: Array.isArray(parsed.flags) ? (parsed.flags as Flag[]) : [],
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
