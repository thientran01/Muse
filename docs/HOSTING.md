# Running Muse on your app (any React host)

Muse is a Vite + React project by origin, but the engine is host-agnostic. Putting
Muse on **another** app — Next.js, a webpack app, a different React version — comes
down to wiring three independent pieces into the host:

1. **An element locator** — stamps `data-muse-loc="file:line:col"` so Muse can map a
   clicked DOM node back to exact source coordinates. *(One Babel plugin, every bundler.)*
2. **A write backend** — the `/api/muse/*` endpoints that read and rewrite source on
   disk. *(Three adapters; pick the one that fits the host.)*
3. **The overlay** — `<MuseOverlay/>`, mounted dev-gated.

Each piece is bundler-independent, so you mix and match. The table is the short version:

| Host | Locator | Backend | Notes |
|---|---|---|---|
| **Vite + React 18/19** | built-in (`museLoc` via `@vitejs/plugin-react`) | `musePlugin()` (built-in) | works today, zero extra wiring |
| **Next.js 16 (Turbopack)** | `babel-loader` rule via `turbopack.rules` | same-origin route (`webAdapter`) | Turbopack can't load SWC plugins — Babel is the path |
| **webpack (CRA, older Next, Remix)** | `babel-loader` rule | same-origin route, or standalone server | |
| **anything else** | `babel-loader` if it runs Babel | **standalone `muse-server`** | the universal fallback |

> **Why Babel and not SWC?** The locator is a Babel plugin on purpose. Babel plugs into
> Vite, Turbopack (as a `babel-loader` rule), and webpack — all three dominant React
> stacks. An SWC plugin would only work on the SWC/webpack path (not Turbopack, not Vite)
> and needs a Rust/WASM build whose `swc_core` ABI must match each host's bundled SWC.
> One small Babel plugin reaches more hosts with less to maintain.

> **Installed from npm?** `npm i -D @thientran01/muse` exposes these same three pieces as
> package subpaths — `@thientran01/muse/babel` (locator), `@thientran01/muse/vite` · `/next`
> · `/standalone` (backend), and `<MuseOverlay/>` from `@thientran01/muse`. The steps below
> reference the repo's own file paths (`babel/muse-loc.cjs`, `server/…`) — read them as
> concepts and swap in the matching package subpath. Condensed npm wiring lives in the
> [package README](https://www.npmjs.com/package/@thientran01/muse).

---

## 1. Element locator — `data-muse-loc`

The plugin lives at [`babel/muse-loc.cjs`](../babel/muse-loc.cjs) (CommonJS, so any
`babel-loader` host can reference it by path). It stamps every JSX opening element in
**dev only** (it self-gates on `NODE_ENV === 'production'`, so it can't leak into a
production build). The locator (`src/muse/sourceLocation.ts`) reads the attribute first
and only falls back to React's `_debugSource` fiber — which is why Muse works on **React
19**, where that fiber field no longer exists.

### Vite (built-in)

Already wired in [`vite.config.ts`](../vite.config.ts) via the typed twin
`server/babelPluginMuseLoc.ts` (identical logic to the `.cjs`):

```ts
react({ babel: { plugins: isDev ? [museLoc] : [] } })
```

### Next.js 16 (Turbopack — the default bundler)

Turbopack runs a subset of webpack loaders, and `babel-loader` is supported. Add a
**dev-only, src-scoped** rule. The plugin is passed as a resolved **string path**
(Turbopack forbids `require()`'d module objects as loader options — a string is fine):

```js
// next.config.js
const path = require('path')
const dev = process.env.NODE_ENV !== 'production'

/** @type {import('next').NextConfig} */
module.exports = {
  turbopack: {
    rules: dev
      ? {
          // A glob containing '/' matches the full project-relative path
          // (no leading './'), so this only runs on YOUR app source — not
          // node_modules. Adjust the folder list to match your tree.
          '{app,src,components}/**/*.{tsx,jsx}': {
            loaders: [
              {
                loader: 'babel-loader',
                options: {
                  babelrc: false,
                  configFile: false,
                  // next/babel parses TSX (preset-typescript + preset-react);
                  // the loader output is JS, which Turbopack then bundles.
                  presets: ['next/babel'],
                  plugins: [require.resolve('./muse/babel/muse-loc.cjs')],
                },
              },
            ],
            as: '*.js',
          },
        }
      : {},
  },
}
```

> Adjust the glob to your source folders and the `require.resolve` path to wherever you
> vendored `muse-loc.cjs`. Keeping the rule behind `dev` means production builds never run
> Babel and never carry the attribute (belt-and-suspenders with the plugin's own
> `NODE_ENV` guard).

**Simpler but broader alternative:** drop a `babel.config.js` with
`{ presets: ['next/babel'], plugins: ['./muse/babel/muse-loc.cjs'] }`. Turbopack
auto-runs `babel-loader` when it finds a Babel config — but that applies to the **whole
app and all builds**, so the scoped `turbopack.rules` form above is preferred. With this
form the plugin's own `NODE_ENV === 'production'` guard is the *only* thing keeping the
attribute out of prod, so it's safe **only if your build always sets `NODE_ENV=production`**
(`next build` does; a bare `npm run build` in some CI setups may not). The scoped `dev`
form above doesn't have this caveat.

### webpack hosts

A standard `babel-loader` rule, dev-gated:

```js
// webpack.config.js (or next.config.js with --webpack)
if (process.env.NODE_ENV !== 'production') {
  config.module.rules.push({
    test: /\.(tsx|jsx)$/,
    exclude: /node_modules/,
    use: [{
      loader: 'babel-loader',
      options: { babelrc: false, configFile: false, plugins: [require.resolve('./muse/babel/muse-loc.cjs')] },
    }],
  })
}
```

---

## 2. Write backend — `/api/muse/*`

All endpoint logic is in [`server/museCore.ts`](../server/museCore.ts), decoupled from any
framework. Three adapters consume it; pick one.

### Vite — `musePlugin()` (built-in)

[`server/musePlugin.ts`](../server/musePlugin.ts) is a ~65-line Vite dev-server adapter.
Nothing to do beyond keeping it in `vite.config.ts`.

### Next.js — same-origin dev API route

[`server/webAdapter.ts`](../server/webAdapter.ts) bridges `museCore`'s Node handlers to the
Web `Request`/`Response` that App Router route handlers speak. Add one catch-all route,
**gated to development** (Muse writes to source on disk). First add a path alias so the
import resolves to the **root-level** `muse-server/` — a Next `src/` project's default
`@/` points at `src/`, not the root — in `tsconfig.json` `compilerOptions.paths`:
`"@muse-server/*": ["./muse-server/*"]`. Then:

```ts
// app/api/muse/[...muse]/route.ts
import { createMuseContext } from '@muse-server/museCore'
import { createMuseWebRouter } from '@muse-server/webAdapter'

export const runtime = 'nodejs' // museCore uses fs / child_process — never Edge
export const dynamic = 'force-dynamic'

const enabled = process.env.NODE_ENV !== 'production'
const router = enabled ? createMuseWebRouter(createMuseContext(process.env, process.cwd())) : null

async function handle(req: Request) {
  if (!router) return new Response('Not found', { status: 404 })
  return router(req)
}
export { handle as GET, handle as POST }
```

This is same-origin, so the overlay's default `apiBase` (`''`) just works — no CORS, no
extra process.

All three adapters expose the same surface, including the **Share changes** endpoints
(`POST /api/muse/share-probe`, `POST /api/muse/share`) and the **Flags** endpoints
(`POST /api/muse/flag`, `GET /api/muse/flags`, `POST /api/muse/flag-resolve`,
`POST /api/muse/flag-delete`). Share runs
`git` (and uses the `gh` CLI for the pull request when present) **from the backend's
process**, so whatever process hosts the adapter needs `git` on its PATH and a
`MUSE_ROOT` inside the repository — automatic for the in-process Vite/Next adapters,
worth checking for the standalone server. Without `gh`, Share still pushes the branch
and falls back to a GitHub compare link.

The **Flags** endpoints only *capture* annotations to `.muse/flags.json`. To resolve them,
your own Claude Code reads that file through the published
[`muse-mcp`](https://www.npmjs.com/package/muse-mcp) server — run
`claude mcp add muse -- npx muse-mcp` from the repo root. See
[`packages/muse-mcp`](../packages/muse-mcp) for the tools it exposes.

### Universal — standalone `muse-server`

For any host whose bundler can't serve the backend in-process,
[`server/standaloneServer.ts`](../server/standaloneServer.ts) is a tiny Node http server:

```bash
MUSE_ROOT=/path/to/your/app npx tsx server/standaloneServer.ts   # binds 127.0.0.1:4747
```

Then point the overlay at it (see §3): `configureMuse({ apiBase: 'http://localhost:4747' })`.

> **⚠️ No authentication — it rewrites source on disk.** It binds **`127.0.0.1` (localhost)
> by default**, so it isn't reachable from the network. Its CORS default also allows only
> localhost browser origins, but neither is real auth — keep it on your own machine and
> never deploy it. Only set `MUSE_HOST=0.0.0.0` if you genuinely need LAN access (e.g. a
> remote dev box), and only on a trusted network. The same-origin Next route above is the
> safer default when the host can serve it.

> **Request guard (all backends).** Because Muse writes source on `POST`, every endpoint —
> on the Vite plugin, the Next route, and the standalone server alike — rejects a request
> whose `Origin` header is present and **not loopback** (403), and requires
> `Content-Type: application/json` on writes (415). This blocks a random site you visit
> while the dev server runs from silently `fetch`-ing the write endpoints (drive-by CSRF /
> DNS-rebinding). If you serve your dev app from a **non-loopback origin** (a LAN IP, a
> `*.local` host, a remote dev box), allow it explicitly with `MUSE_CORS_ORIGIN=<your-origin>`
> (or `MUSE_CORS_ORIGIN='*'` to allow any — localhost is always allowed regardless).

---

## 3. Mount the overlay

Mount `<MuseOverlay/>` **dev-gated** in your tree. No CSS import is needed — the overlay
renders inside a **Shadow DOM** root and injects its own compiled styles there, so it's
fully isolated from the host (it can't break the host's CSS, or be broken by it) and runs
no Tailwind in the host. The config is bundler-neutral
([`src/muse/config.ts`](../src/muse/config.ts)): it reads `import.meta.env` (Vite),
`window.__MUSE__` (any host), or `process.env`, and never throws off-Vite.

```tsx
'use client' // Next.js: the overlay is client-only

import { MuseOverlay } from '@/muse/MuseOverlay'
import { configureMuse } from '@/muse/config'

// Only needed for the standalone-server backend; omit for same-origin routes.
// configureMuse({ apiBase: 'http://localhost:4747' })

export function DevMuse() {
  if (process.env.NODE_ENV === 'production') return null
  return <MuseOverlay />
}
```

> **One React instance only.** The overlay walks React fibers; two copies of React break
> that. Always mount it from the host's own React, never a bundled-in second copy.

---

## 4. Stand your own pointer UI down — `data-muse-active`

While Canvas Mode is on, Muse sets a marker attribute on the document root:

```html
<html data-muse-active>
```

It is present exactly while Canvas is active and removed the moment it closes (and on
unmount). **Presence is the whole contract** — there is no value and there are no states.
It is set in every mode, including the demo/ephemeral one.

Scope anything of your own that competes for the pointer or the keyboard to
`:not([data-muse-active])`:

```css
/* A custom cursor that replaces the native one */
html:not([data-muse-active]) .my-cursor-ring { display: block; }
html[data-muse-active]      .my-cursor-ring { display: none; }
```

```ts
// A command palette or global hotkey
if (!document.documentElement.hasAttribute('data-muse-active')) openPalette()
```

**Why this exists.** A host that replaces the native cursor fights Canvas directly: a
spring-lagged ring trails the true pointer through a gap or resize drag, and an enlarged
hover state covers the element you're trying to select. Without a signal, the only fix was
disabling the cursor for a whole route. This generalises to command palettes, drag-and-drop
surfaces, and any global key handler.

> **Watch for affordances that live only in your cursor.** If your buttons rely on a custom
> cursor for their hover feedback — e.g. variants keyed off a `data-cursor` attribute, with
> no real `cursor: pointer` on the element — then standing the cursor down reveals that they
> had no affordance of their own. Give them real CSS states.

---

## Environment

| Var | Purpose |
|---|---|
| `MUSE_ROOT` | project root for the standalone server (defaults to cwd). |
| `MUSE_API_BASE` | client default for `apiBase` (or call `configureMuse`). |
| `MUSE_CORS_ORIGIN` | extra allowed request origin (or `'*'` for any). Default: loopback only. Needed only when the dev app is served from a non-loopback origin. |

Canvas Mode (direct manipulation: spacing/type/color/text/reorder) and the design-token
editor are fully deterministic — Muse needs **no API key and no model-backed services**.

---

## Troubleshooting

- **Clicking an element does nothing / Canvas can't find the source.** The locator stamp
  isn't reaching the DOM. Check `document.querySelector('[data-muse-loc]')` in the console:
  if it's empty, the Babel rule isn't running on your source (wrong glob, prod gate firing,
  or `babel-loader` not passing a `filename` — the plugin silently skips elements with no
  filename). Confirm the rule's glob matches your folders and that you're in dev.
- **The attribute shows up in a production build.** A build ran without `NODE_ENV=production`.
  Prefer the scoped `dev` `turbopack.rules` form over a global `babel.config.js`.

## What's verified

- **Vite + React 18:** the origin host — Canvas and reorder all round-trip in
  development.
- **Next.js 16 + React 19 + Turbopack (Windows):** verified end-to-end on a live app
  (Turbopack `babel-loader` rule → `data-muse-loc` stamp → select → same-origin App
  Router route → write → reload). Canvas style/text edits, the design-token panel, the
  cross-file prop-text trace, and reorder all round-trip; CRLF line endings are preserved.
  The Shadow-DOM overlay imports zero host CSS, so it coexists with the host's Tailwind v4
  without collisions.
- **Locator parity:** the Babel plugin stamps identically through bare `@babel/core` (the
  `babel-loader` pathway) and the Vite twin, and the overlay config is bundler-safe.

> **Re-vendor on install.** The engine is copied into the host, so a host can drift behind
> this repo. When you install or update Muse on a host, re-vendor the engine to `main`.
