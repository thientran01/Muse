# Muse

**Point at anything in your running app, shape it the way you would in a design tool, and Muse rewrites the real source code.** A visual editing layer for design engineers — change the rendered product, get a mergeable diff.

Muse is a floating overlay that loads alongside a **React** app in development. You click an element on the running page and shape it directly — **Canvas (direct manipulation).** Drag the spacing, scrub the size, pick a color, rewrite the copy in place, or drag an element among its siblings to reorder it. Each gesture is a known transform, so Muse applies it **without a model call** — instant, key-free, and reversible.

The change lands in the source file and HMR reloads the app. Full undo / redo / revert history is kept for the session.

It's built for the loop a design engineer actually works in: you're looking at the rendered output, you know how you want it to feel, but acting on it means inspecting the element, hunting down the file, finding the className, and tabbing back to check. Muse collapses that — point at the thing in the running app and work from there, instead of from the file tree. v0 and Lovable generate a *new* app from a blank prompt; editor copilots work from the file tree and expect you to already know what to open. Muse works from the rendered output of the app you already have.

---

## How it works

**Canvas — direct edits, no model call:**

1. **Open Muse** from the button in the corner (or press `R`), then click any element to select it.
2. **Shape it directly.** Drag the padding / margin / gap bands on the element, resize it from the corners, scrub size and weight, pick colors, double-click to rewrite text, or drag the element among its siblings to reorder. Each is a deterministic AST rewrite of the one element you touched.
3. **It's already written.** A Canvas edit is applied to the source the moment you make it — no key, no wait — and lands on the same undo stack as everything else.

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

**Canvas needs no API key and no configuration** — every edit is a deterministic AST rewrite. The toolbar also has a **Design tokens** popover that lists your host's CSS custom properties (`--c-*`) and lets you retune any of them in place, written straight back to the defining stylesheet.

---

## Architecture

### Element → source mapping (a Babel locator, fiber as fallback)

The first question was: how do you go from a clicked DOM element to the source file it came from? Muse stamps every JSX opening element with a `data-muse-loc="file:line:col"` attribute via a small **Babel plugin** ([`server/babelPluginMuseLoc.ts`](server/babelPluginMuseLoc.ts), with a CJS twin at [`babel/muse-loc.cjs`](babel/muse-loc.cjs) for non-Vite hosts). The locator ([`src/muse/sourceLocation.ts`](src/muse/sourceLocation.ts)) reads that straight off the clicked node, so a click resolves to an exact disk line.

Where the attribute is missing it falls back to walking React's `__reactFiber$…` → `_debugSource` chain. That fiber field is a semi-private API **React 19 removes**, so the Babel stamp is the primary path on purpose — it keeps Muse working across **React 18 and 19** and any bundler that runs a Babel transform (Vite, Next.js/Turbopack via `babel-loader`, webpack). The stamp self-gates on `NODE_ENV === 'production'`, so it never reaches a build.

### Backend: a dev-only middleware, host-agnostic

The engine needs to read source from disk and write edited files back. All endpoint logic lives in [`server/museCore.ts`](server/museCore.ts), decoupled from any framework, behind three adapters:

- **Vite** — [`server/musePlugin.ts`](server/musePlugin.ts) attaches the endpoints to the dev server via `configureServer` (`apply: 'serve'`): same origin, no CORS, never in a build.
- **Next.js** — [`server/webAdapter.ts`](server/webAdapter.ts) bridges the handlers to a same-origin App Router dev route.
- **Anything else** — [`server/standaloneServer.ts`](server/standaloneServer.ts), a tiny Node http server bound to localhost.

**Canvas endpoints** (deterministic, no model call): `/style-edit`, `/text-edit`, `/reorder`, plus the probes `/style-scope`, `/text-editable`, `/reorderable`, the token endpoints `/tokens`, `/token-edit`, and `/write` to commit.

### AST-based Canvas edits

A direct edit is a known transform — a drag is a number changing, a reorder is a sibling moving up the file. [`server/styleEdit.ts`](server/styleEdit.ts) parses the JSX/TSX with Babel, finds the element by file + line + column + tag + current className, and rewrites that one class, style, or sibling order with a character-range splice that leaves your formatting intact. It auto-detects the writer per project, so it covers Tailwind classes, inline styles, CSS variables, CSS Modules, and styled-components / emotion — not Tailwind alone. It never uses regex.

### Shadow-DOM isolation

The overlay renders inside a **Shadow DOM** root and injects its own compiled styles there ([`src/muse/hooks/useShadowHost.ts`](src/muse/hooks/useShadowHost.ts)), so Muse's CSS can't collide with the host app and the host can't break Muse. Hosts import **zero** Muse CSS and run no Tailwind of Muse's.

### Security

The write path touches disk, so:

- Paths are resolved with `fs.realpathSync` and validated with `path.relative` — not a string `startsWith`, which is defeated by `../` traversal, symlinks, or a `src-evil/` prefix collision.
- Only files inside `src/` can be written.
- Muse can only write files it actually read in the same request.
- All files are validated **before** any are written (all-or-nothing), so a partial batch can't leave the codebase broken.
- A 200 KB per-file cap stops a runaway write.
- The standalone server binds `127.0.0.1` by default and ships no auth — keep it on your own machine.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 **or** 19 + TypeScript |
| Hosts | Vite, Next.js (Turbopack), webpack |
| Styling Muse edits | Tailwind (v3 & v4), inline styles, CSS variables, CSS Modules, styled-components / emotion |
| Muse's own UI | Tailwind, isolated in a Shadow DOM root |
| Backend | Dev-only middleware (Vite plugin / Next route / standalone server) |
| Icons | Phosphor |

---

## Limitations

- **Dev-mode only.** Muse runs against `npm run dev`, not a deployed site — by design, since it edits source, not the live DOM, so you get real code instead of throwaway hacks.
- **Source under `src/`.** Writes are bounded to your project's `src/` directory, so the components you want to edit need to live there (Next.js App Router's `src/app` layout works).
- **Reorder follows document flow.** Drag-to-reorder moves an element among its source siblings. Elements placed by explicit CSS — grid line/area placement, `position: absolute/fixed` — are detected and refused, since shuffling the source wouldn't move them.
- **Best with editable styling in the markup.** Canvas reaches the most when styles live where it can splice them (utility classes, inline styles, local consts). Apps that route everything through deeply indirected systems give it less surface to act on, though the multi-format writer covers most setups.
