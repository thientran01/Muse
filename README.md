# Muse

**Point at anything in your running app, shape it the way you would in a design tool, and Muse rewrites the real source code.** A visual editing layer for design engineers — change the rendered product, get a mergeable diff.

Muse is a floating overlay that loads alongside a **React** app in development. You click an element on the running page and edit it two ways:

- **Canvas (direct manipulation).** Drag the spacing, scrub the size, pick a color, rewrite the copy in place, or drag an element among its siblings to reorder it. Each gesture is a known transform, so Muse applies it **without a model call** — instant, key-free, and reversible. The edit is written straight to your source.
- **The agent (describe it).** Some changes read better as a sentence than a drag. Shift-click an element to hand it to the chat partner, say how you want it to feel ("make this card warmer and less boxy"), and it answers with one to three distinct directions you can preview in place before committing to one.

Either way, the change lands in the source file and HMR reloads the app. Full undo / redo / revert history is kept for the session.

It's built for the loop a design engineer actually works in: you're looking at the rendered output, you know how you want it to feel, but acting on it means inspecting the element, hunting down the file, finding the className, and tabbing back to check. Muse collapses that — point at the thing in the running app and work from there, instead of from the file tree. v0 and Lovable generate a *new* app from a blank prompt; editor copilots work from the file tree and expect you to already know what to open. Muse works from the rendered output of the app you already have.

---

## How it works

**Canvas — direct edits, no model call:**

1. **Open Muse** from the button in the corner (or press `R`), then click any element to select it.
2. **Shape it directly.** Drag the padding / margin / gap bands on the element, resize it from the corners, scrub size and weight, pick colors, double-click to rewrite text, or drag the element among its siblings to reorder. Each is a deterministic AST rewrite of the one element you touched.
3. **It's already written.** A Canvas edit is applied to the source the moment you make it — no key, no wait — and lands on the same undo stack as everything else.

**The agent — describe it:**

1. **Shift-click** an element to hand it to the chat partner. On a fresh selection Muse fires a cheap `/observe` read — a one-line description plus a few starter directions tailored to what you picked.
2. **Ask** in plain English. Muse returns **1–3 distinct design directions**, each a complete applyable edit scoped to the selected element so you can preview it in place. On a genuinely ambiguous request it asks one short clarifying question with concrete visual options instead.
3. **Approve** the per-file diff. If an edit spans more than one file, all files are written in one atomic operation.

Open `/?gallery` in dev to see every Muse UI state at once.

---

## Run it

```bash
npm install
npm run dev
```

Open the localhost URL it prints (default http://localhost:5173). The repo ships its own docs site as the demo surface — the page you're reading **is** the editable surface, so you can open Muse and reshape anything on it.

To add Muse to **your** app, install the skill and point your coding agent at your project:

```bash
npx skills add thientran01/Muse
```

It detects your bundler (Vite, Next.js, or webpack), copies the engine in, and wires the three pieces Muse needs. To wire it by hand, [`docs/HOSTING.md`](docs/HOSTING.md) covers every host step by step.

### Backends

Muse's `/chat` engine (the agent) has two backends, chosen by `MUSE_BACKEND`. **Canvas needs neither — it's deterministic and key-free.**

| Backend | Default? | Auth | Notes |
|---|---|---|---|
| `claude-cli` | ✅ yes | Your logged-in Claude subscription (`claude auth status`) | Shells out to the `claude` CLI. **No `ANTHROPIC_API_KEY` needed for `/chat`.** Requires Claude Code installed and on PATH. |
| `anthropic` | — | `ANTHROPIC_API_KEY` | The metered Messages API path. |

The `/observe` endpoint (the agent's starter-chip reads) always uses the cheap Messages API (Haiku by default), so an `ANTHROPIC_API_KEY` is needed for those regardless of which `/chat` backend you pick. Without a key, Shift-click still works — the client falls back to a heuristic opener.

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
| `MUSE_DESIGN_MD` | — | Path to a `DESIGN.md` brief so chat edits reach for your real tokens. |
| `ANTHROPIC_API_KEY` | — | Required for the `anthropic` backend and for `/observe`. |

---

## Architecture

### Element → source mapping (a Babel locator, fiber as fallback)

The first question was: how do you go from a clicked DOM element to the source file it came from? Muse stamps every JSX opening element with a `data-muse-loc="file:line:col"` attribute via a small **Babel plugin** ([`server/babelPluginMuseLoc.ts`](server/babelPluginMuseLoc.ts), with a CJS twin at [`babel/muse-loc.cjs`](babel/muse-loc.cjs) for non-Vite hosts). The locator ([`src/muse/sourceLocation.ts`](src/muse/sourceLocation.ts)) reads that straight off the clicked node, so a click resolves to an exact disk line.

Where the attribute is missing it falls back to walking React's `__reactFiber$…` → `_debugSource` chain. That fiber field is a semi-private API **React 19 removes**, so the Babel stamp is the primary path on purpose — it keeps Muse working across **React 18 and 19** and any bundler that runs a Babel transform (Vite, Next.js/Turbopack via `babel-loader`, webpack). The stamp self-gates on `NODE_ENV === 'production'`, so it never reaches a build.

### Backend: a dev-only middleware, host-agnostic

The engine needs to read source from disk, optionally call the model, and write edited files back. All endpoint logic lives in [`server/museCore.ts`](server/museCore.ts), decoupled from any framework, behind three adapters:

- **Vite** — [`server/musePlugin.ts`](server/musePlugin.ts) attaches the endpoints to the dev server via `configureServer` (`apply: 'serve'`): same origin, no CORS, never in a build.
- **Next.js** — [`server/webAdapter.ts`](server/webAdapter.ts) bridges the handlers to a same-origin App Router dev route.
- **Anything else** — [`server/standaloneServer.ts`](server/standaloneServer.ts), a tiny Node http server bound to localhost.

**Canvas endpoints** (deterministic, no model call): `/style-edit`, `/text-edit`, `/reorder`, plus the probes `/style-scope`, `/text-editable`, `/reorderable` and the token endpoints `/tokens`, `/token-edit`.
**Agent endpoints:** `/chat`, `/observe`, `/write` (and `/design` for the brief).

### AST-based Canvas edits

A direct edit is a known transform — a drag is a number changing, a reorder is a sibling moving up the file. [`server/styleEdit.ts`](server/styleEdit.ts) parses the JSX/TSX with Babel, finds the element by file + line + column + tag + current className, and rewrites that one class, style, or sibling order with a character-range splice that leaves your formatting intact. It auto-detects the writer per project, so it covers Tailwind classes, inline styles, CSS variables, CSS Modules, and styled-components / emotion — not Tailwind alone. It never uses regex.

### Shadow-DOM isolation

The overlay renders inside a **Shadow DOM** root and injects its own compiled styles there ([`src/muse/hooks/useShadowHost.ts`](src/muse/hooks/useShadowHost.ts)), so Muse's CSS can't collide with the host app and the host can't break Muse. Hosts import **zero** Muse CSS and run no Tailwind of Muse's.

### Two agent modes: propose options, or ask

The chat model produces one of two structured outputs per turn:

- **`propose_options`** (the default) — 1–3 distinct design *directions*, each a complete applyable edit, scoped to the selected element so it can be previewed in place.
- **`ask_clarifying_questions`** — the exception, used only when the answer would materially change what gets shipped: one question with 2–3 concrete visual options in plain language.

On the `anthropic` backend this is Claude tool use with `tool_choice: { type: 'any' }`. The `claude-cli` backend has no native tool-calling, so the two tools collapse into a single structured-output schema with a `mode` discriminator, reshaped server-side into the same content the frontend already consumes — so the client is identical across backends. The CLI path asks for **search/replace blocks** rather than full-file rewrites, which cut edit latency from ~80–180s to ~14–20s; the server reconstructs the full file from those blocks so the `{ fileName, newContent }` contract is identical either way.

### Security

The write path touches disk, so:

- Paths are resolved with `fs.realpathSync` and validated with `path.relative` — not a string `startsWith`, which is defeated by `../` traversal, symlinks, or a `src-evil/` prefix collision.
- Only files inside `src/` can be written.
- The agent can only write files it actually read in the same request.
- All files are validated **before** any are written (all-or-nothing), so a partial batch can't leave the codebase broken.
- A 200 KB per-file cap stops runaway model output.
- On the CLI backend, `ANTHROPIC_API_KEY` is stripped from the child process env so auth can only resolve to the logged-in subscription, never silently bill a key.
- The standalone server binds `127.0.0.1` by default and ships no auth — keep it on your own machine.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 **or** 19 + TypeScript |
| Hosts | Vite, Next.js (Turbopack), webpack |
| Styling Muse edits | Tailwind (v3 & v4), inline styles, CSS variables, CSS Modules, styled-components / emotion |
| Muse's own UI | Tailwind, isolated in a Shadow DOM root |
| AI (agent only) | Claude — via the `claude` CLI (subscription) or the Anthropic SDK (metered API) |
| Backend | Dev-only middleware (Vite plugin / Next route / standalone server) |
| Icons | Phosphor |

---

## Limitations

- **Dev-mode only.** Muse runs against `npm run dev`, not a deployed site — by design, since it edits source, not the live DOM, so you get real code instead of throwaway hacks.
- **Source under `src/`.** Writes are bounded to your project's `src/` directory, so the components you want to edit need to live there (Next.js App Router's `src/app` layout works).
- **Reorder follows document flow.** Drag-to-reorder moves an element among its source siblings. Elements placed by explicit CSS — grid line/area placement, `position: absolute/fixed` — are detected and refused, since shuffling the source wouldn't move them.
- **Best with editable styling in the markup.** Canvas reaches the most when styles live where it can splice them (utility classes, inline styles, local consts). Apps that route everything through deeply indirected systems give it less surface to act on, though the multi-format writer covers most setups.
