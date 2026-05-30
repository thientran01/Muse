# Muse

**Point at anything in your running app, say what you want, and Muse rewrites the real source code.** A visual editing layer for design engineers — change the rendered product, get a mergeable diff.

Muse is a floating overlay that loads alongside any **React 18 + Vite** app in development. You click an element on the running page, describe the change you want ("make this card feel warmer and less boxy") or pick from the directions Muse proposes, and it edits the source file directly. Approve, and the file is written to disk — Vite HMR reloads the app instantly. Full undo / redo / revert history is kept for the session.

It's built for the loop a design engineer actually works in: you're looking at the rendered output, you know how you want it to feel, but acting on it means inspecting the element, hunting down the file, finding the className, and tabbing back to check. Muse collapses that — point at the thing in the running app and work from there, instead of from the file tree. v0 and Lovable generate a *new* app from a blank prompt; editor copilots work from the file tree and expect you to already know what to open. Muse works from the rendered output of the app you already have.

---

## How it works

1. **Select.** Click the Muse button (bottom-right) to enter select mode. Hovering highlights elements with a component breadcrumb; click to select.
2. **Read.** On a fresh selection, Muse fires a cheap `/observe` call — a one-line read of the element plus three tailored starter chips to get you going.
3. **Ask.** Describe the change in plain English.
4. **Propose.** Muse returns **1–3 distinct design directions**, each a complete, applyable edit scoped to the selected element so you can preview it in place. On a genuinely ambiguous request it asks one short clarifying question with concrete visual options instead.
5. **Approve.** Review the per-file diff and approve. If an edit spans more than one file, all files are written in one atomic operation.
6. **Reload.** Vite HMR reloads the app. Undo / redo treats each apply as a single batch.

Open `/?gallery` in dev to see every Muse UI state at once.

---

## Run it

```bash
npm install
npm run dev
```

Open the localhost URL it prints (default http://localhost:5173). The repo ships with a demo app — *Rikkleball*, a fictional pickleball-league UI — so you have something real to point Muse at.

### Backends

Muse's `/chat` engine has two backends, chosen by `MUSE_BACKEND`:

| Backend | Default? | Auth | Notes |
|---|---|---|---|
| `claude-cli` | ✅ yes | Your logged-in Claude subscription (`claude auth status`) | Shells out to the `claude` CLI. **No `ANTHROPIC_API_KEY` needed for `/chat`.** Requires Claude Code installed and on PATH. |
| `anthropic` | — | `ANTHROPIC_API_KEY` | The metered Messages API path. |

The `/observe` endpoint always uses the cheap Messages API (Haiku by default), so an `ANTHROPIC_API_KEY` is needed for the starter-chip reads regardless of which `/chat` backend you pick. If you don't set a key, selecting an element still works — the client falls back to a heuristic opener.

To use the API backend, or to enable `/observe`, add a key to `.env.local` at the repo root and restart:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Configuration

All optional environment variables, read at dev-server start:

| Var | Default | What it controls |
|---|---|---|
| `MUSE_BACKEND` | `claude-cli` | `claude-cli` (subscription) or `anthropic` (API key) for `/chat`. |
| `MUSE_CLI_MODEL` | `sonnet` | Model for the `claude-cli` `/chat` path (alias = latest on your plan). |
| `MUSE_MODEL` | `claude-sonnet-4-6` | Model for the `anthropic` `/chat` path. |
| `MUSE_OBSERVE_MODEL` | `claude-haiku-4-5` | Model for the `/observe` starter-chip reads. |
| `ANTHROPIC_API_KEY` | — | Required for the `anthropic` backend and for `/observe`. |

---

## Architecture

### Element → source mapping (React fiber introspection)

The first question was: how do you go from a clicked DOM element to the source file it came from? In dev, `@vitejs/plugin-react` injects JSX source info (file, line, column) onto every React element, where it lands on the fiber as `_debugSource`. Every DOM node React renders carries a `__reactFiber$…` property at runtime. Muse walks the fiber's `_debugSource` / `_debugOwner` chain until it finds a source location (see [src/muse/sourceLocation.ts](src/muse/sourceLocation.ts)).

The tradeoff: `_debugSource` is a semi-private React API that **React 19 removes**, which is why Muse pins React 18. For a dev-mode tool this is the right call — no build-tooling changes, no DOM bloat, and it resolves dynamically from the live fiber tree the moment `npm run dev` starts. (Alternatives considered and rejected: a build-time Babel plugin stamping `data-source` attributes — DOM bloat, goes stale on HMR; and the React DevTools protocol — requires the extension, couples to browser internals.)

### Backend: a Vite plugin, not a separate server

The AI needs to read source files from disk, call the model, and write edited files back. A standalone Express server means CORS on every request and a second process to manage; a cloud function can't read local files. So Muse is a **Vite plugin** ([server/musePlugin.ts](server/musePlugin.ts)) that uses the `configureServer` hook to attach endpoints to the dev server itself — same origin, no CORS, direct filesystem access, one `npm run dev`. The plugin is `apply: 'serve'`, so it **never enters a production build**.

Three endpoints:

- **`POST /api/muse/chat`** — the engine. Reads the source of every selected element, then either proposes options or asks a clarifying question.
- **`POST /api/muse/observe`** — a cheap, tool-less ~300-token call returning a one-line observation + 3 starter chips when a fresh element is selected.
- **`POST /api/muse/write`** — writes approved files to disk (triggering HMR).

### Two modes: propose options, or ask

The model produces one of two structured outputs per turn:

- **`propose_options`** (the default) — 1–3 distinct design *directions*, each a complete applyable edit, scoped to the selected element so it can be previewed in place.
- **`ask_clarifying_questions`** — the exception, used only when the answer would materially change what gets shipped: one question with 2–3 concrete visual options in plain language.

On the `anthropic` backend this is modeled as Claude tool use with `tool_choice: { type: 'any' }`. The `claude-cli` backend has no native tool-calling, so the two tools collapse into a single structured-output schema with a `mode` discriminator (validated by `claude --json-schema`), then get reshaped server-side into the exact tool-use-shaped content the frontend already consumes — so the client is identical across backends.

### Edit format: search/replace, reconstructed server-side

The `claude-cli` path asks the model for **search/replace blocks** rather than full-file rewrites — a fraction of the output tokens, which cut edit latency from ~80–180s down to ~14–20s. The server applies those blocks to the on-disk original (with progressively looser matching, all-or-nothing per file) to reconstruct the full file contents, so the frontend still receives an identical `{ fileName, newContent }` contract. The `anthropic` path returns complete files directly.

### Security

The `/write` endpoint touches disk, so:

- Paths are resolved with `fs.realpathSync` and validated with `path.relative` — not a string `startsWith`, which is defeated by `../` traversal, symlinks, or a `src-evil/` prefix collision.
- Only files inside `src/` can be written.
- The model can only write files it actually read in the same request.
- All files are validated **before** any are written (all-or-nothing), so a partial batch can't leave the codebase broken.
- A 200 KB per-file cap stops runaway model output.
- On the CLI backend, `ANTHROPIC_API_KEY` is stripped from the child process env so auth can only resolve to the logged-in subscription, never silently bill a key.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 5 + TypeScript |
| Styling | Tailwind CSS v3 (Muse edits utility classes inline) |
| AI | Claude — via the `claude` CLI (subscription) or the Anthropic SDK (metered API) |
| Backend | Vite plugin middleware (`apply: 'serve'`) |
| Icons | Phosphor |

---

## Limitations

- **Dev-mode only.** Muse runs against `npm run dev`, not a deployed site — by design, since it edits source, not the live DOM, so you get real code instead of throwaway hacks.
- **React 18.** The `_debugSource` fiber trick uses a semi-private API that React 19 removes, so React 18 is pinned on purpose.
- **Best with inline utility classes.** Muse edits Tailwind classes in the markup. Apps that route everything through CSS variables or styled-components give it less to act on.
