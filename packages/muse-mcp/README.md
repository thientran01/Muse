# muse-mcp

Hand **Muse flags** to your own Claude Code.

[Muse](https://github.com/thientran01/Muse) is a dev-time overlay that lets you shape a running React app by direct manipulation — and, where direct manipulation can't reach, **shift-click an element to drop a _flag_**: an annotation carrying the exact source location (`file:line:col`), the element's tag + className + current text, and a plain-English note about the change you want. Flags are written to `.muse/flags.json` in your project.

`muse-mcp` is a tiny stdio [MCP](https://modelcontextprotocol.io) server that exposes those flags to **your own Claude Code**, so _it_ makes the edits with its own Read/Edit tools. Muse routes **zero inference** — the flag is a precise work-order; the thinking is all yours. ToS-clean, $0.

## Why

Direct manipulation is deterministic and instant, but some changes need judgment (restructure a layout, rewrite data-bound text, theme-aware color). Those are exactly the edits Muse _refuses_ — and the moment to hand off. A flag gives your agent `Hero.tsx:42:8` + the className + the text + your intent: a near-unambiguous task, far more precise than "go find the Hero component."

Capture and fulfillment **decouple** — flag during a dev session, resolve later from Claude Code even with the app closed.

## Setup

From your project root (so it finds `.muse/`):

```bash
claude mcp add muse -- npx muse-mcp
```

Then, in Claude Code: _"address the muse flags"_ → it calls `list_flags`, edits each file, and calls `resolve_flag`.

> Developing `muse-mcp` itself? Point Claude Code at your local build instead of the
> published package:
> ```bash
> claude mcp add muse -- node /absolute/path/to/Muse/packages/muse-mcp/dist/index.js
> ```

### Root resolution

The server finds your project by walking up from the launch directory for a `.muse/` dir, then the nearest `package.json`, then the cwd. Override with `MUSE_ROOT=/path` or `--root /path`.

## Tools

| Tool | Args | Does |
|---|---|---|
| `list_flags` | `status?` (`open`\|`resolved`, default `open`) | List flags with full source context |
| `get_flag` | `id` | One flag by id (e.g. `f_3`) |
| `resolve_flag` | `id`, `note?` | Mark resolved (after you've made the edit) |
| `clear_resolved` | — | Remove resolved flags (housekeeping) |

Reads are direct from `.muse/flags.json`; writes are atomic (temp + rename), so a reader never sees a torn file. **Two** processes write this file — Muse's dev server (flag drops) and this server (resolves). If a flag is dropped in the running app at the same instant Claude Code resolves one, the two writes are last-write-wins, so one update can be lost (a small file, a narrow window). Muse mints flag ids from the highest existing id, so a lost update can't cause a duplicate id. A file watch + lock is the planned hardening.

## License

MIT
