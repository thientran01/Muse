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
  // Instance context (newer Muse, optional): the authored file:line:col above is where
  // the element's pixels live — for an element inside a shared component that's the
  // component file, same for every instance. `usage` is the nearest containing element
  // authored in a different file (the usage-site container); instanceIndex/Count is
  // "2 of 3" among same-loc elements in document order. Older flags omit all three.
  crumbs?: string[] // component breadcrumb, outermost → nearest
  usage?: { file: string; line: number; column: number; tag: string }
  instanceIndex?: number
  instanceCount?: number
  createdAt: string
  resolvedAt: string | null
  resolution: string | null
}

export type FlagsFile = { version: 1; nextId: number; flags: Flag[] }
