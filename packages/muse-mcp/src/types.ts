// The `.muse/flags.json` contract — kept in sync with the overlay's src/muse/types.ts.
// Duplicated (not imported) on purpose: muse-mcp must stay dependency-light (MCP SDK +
// node builtins only), never pulling in the React-heavy overlay package.

export type FlagStatus = 'open' | 'resolved'

export type Flag = {
  id: string
  comment: string
  status: FlagStatus
  file: string // repo-relative
  line: number
  column: number
  tag: string
  className: string
  text: string
  property?: string
  reason?: string
  createdAt: string
  resolvedAt: string | null
  resolution: string | null
}

export type FlagsFile = { version: 1; nextId: number; flags: Flag[] }
