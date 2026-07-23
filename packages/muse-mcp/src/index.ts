#!/usr/bin/env node
// muse-mcp — hand Muse flags to your OWN Claude Code.
//
// Muse (the dev overlay) lets you shift-click an element in your running app and drop a
// "flag": an annotation carrying the exact source location + className + text + a plain-
// English intent, persisted to `.muse/flags.json`. This stdio MCP server exposes those
// flags to your own Claude Code so IT does the edits. Muse routes ZERO inference — the
// flag is a precise work-order; the thinking is all yours. ToS-clean, $0.
//
// Setup:  claude mcp add muse -- npx muse-mcp     (run from your project root)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFlags, resolveRoot, writeFlags } from './flagsStore.js'

// --root <dir> overrides discovery; MUSE_ROOT env does too (matches the dev server).
const argv = process.argv.slice(2)
const rootFlagIdx = argv.indexOf('--root')
const rootArg = rootFlagIdx >= 0 ? argv[rootFlagIdx + 1] : undefined
// Guard "--root --other-flag" (and a trailing "--root") from treating the next flag as a
// path. `||` (not `??`) also lets an empty MUSE_ROOT fall through to discovery.
const rootOverride = process.env.MUSE_ROOT || (rootArg && !rootArg.startsWith('--') ? rootArg : undefined)
const ROOT = resolveRoot(process.cwd(), rootOverride)

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

const server = new McpServer({ name: 'muse', version: '0.1.1' })

server.registerTool(
  'list_flags',
  {
    title: 'List Muse flags',
    description:
      'List flags a designer dropped in the running app via Muse. Each flag is a work-order: ' +
      'a repo-relative file + line + column + tag + className + the current text + a plain-English ' +
      '`comment` describing the change they want (and, for flags born from a Canvas refusal, the ' +
      '`property` they reached for and the `reason` Canvas could not do it). When the flagged ' +
      'element lives inside a shared component, the flag may also carry instance context: `crumbs` ' +
      '(component breadcrumb), `usage` (the nearest containing element authored in a DIFFERENT ' +
      'file — the usage site; edit or delete THIS instance there, edit styles at the main ' +
      'file:line), and `instanceIndex`/`instanceCount` ("2 of 3" in document order) to pin which ' +
      'rendered instance was meant. Default returns only OPEN flags. Read each flag, make the ' +
      'edit at its file:line, then call resolve_flag.',
    inputSchema: {
      status: z
        .enum(['open', 'resolved', 'all'])
        .optional()
        .describe('Filter by status. Default: open only. "all" returns open + resolved.'),
    },
  },
  async ({ status }) => {
    try {
      const wanted = status ?? 'open'
      const all = readFlags(ROOT).flags
      const flags = wanted === 'all' ? all : all.filter((f) => f.status === wanted)
      return ok({ root: ROOT, count: flags.length, flags })
    } catch (e) {
      return fail(`Could not read flags: ${(e as Error).message}`)
    }
  },
)

server.registerTool(
  'get_flag',
  {
    title: 'Get one Muse flag',
    description:
      'Return a single flag by id (e.g. "f_3") with its full source context — including, when ' +
      'present, the instance context (`crumbs`/`usage`/`instanceIndex`) that pins which rendered ' +
      'instance of a shared component the designer meant.',
    inputSchema: { id: z.string().describe('The flag id, e.g. "f_3".') },
  },
  async ({ id }) => {
    try {
      const flag = readFlags(ROOT).flags.find((f) => f.id === id)
      return flag ? ok(flag) : fail(`No flag ${id}.`)
    } catch (e) {
      return fail(`Could not read flags: ${(e as Error).message}`)
    }
  },
)

server.registerTool(
  'resolve_flag',
  {
    title: 'Resolve a Muse flag',
    description:
      'Mark a flag resolved after you have made the edit. Optionally record a short `note` of what ' +
      'you changed. Writes back to `.muse/flags.json` so the flag stops showing as open in Muse.',
    inputSchema: {
      id: z.string().describe('The flag id to resolve, e.g. "f_3".'),
      note: z.string().optional().describe('Optional summary of what you changed.'),
    },
  },
  async ({ id, note }) => {
    try {
      const data = readFlags(ROOT)
      const flag = data.flags.find((f) => f.id === id)
      if (!flag) return fail(`No flag ${id}.`)
      flag.status = 'resolved'
      flag.resolvedAt = new Date().toISOString()
      flag.resolution = note ?? null
      writeFlags(ROOT, data)
      return ok({ resolved: flag.id, status: flag.status })
    } catch (e) {
      return fail(`Could not resolve ${id}: ${(e as Error).message}`)
    }
  },
)

server.registerTool(
  'clear_resolved',
  {
    title: 'Clear resolved flags',
    description: 'Remove every resolved flag from `.muse/flags.json` (housekeeping). Open flags are kept.',
    inputSchema: {},
  },
  async () => {
    try {
      const data = readFlags(ROOT)
      const before = data.flags.length
      data.flags = data.flags.filter((f) => f.status !== 'resolved')
      // Nothing resolved → don't write (a pure-housekeeping call shouldn't create .muse/
      // on a project that never had a flag).
      if (data.flags.length === before) return ok({ removed: 0, remaining: before })
      writeFlags(ROOT, data)
      return ok({ removed: before - data.flags.length, remaining: data.flags.length })
    } catch (e) {
      return fail(`Could not clear resolved flags: ${(e as Error).message}`)
    }
  },
)

async function main() {
  // stderr only — stdout is the JSON-RPC channel and must not be polluted.
  console.error(`[muse-mcp] serving flags from ${ROOT}/.muse/flags.json`)
  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  console.error('[muse-mcp] fatal:', err)
  process.exit(1)
})
