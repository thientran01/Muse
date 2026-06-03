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
**gated to development** (Muse writes to source on disk):

```ts
// app/api/muse/[...muse]/route.ts
import { createMuseContext } from '@/muse-server/museCore'
import { createMuseWebRouter } from '@/muse-server/webAdapter'

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

---

## 3. Mount the overlay

Mount `<MuseOverlay/>` **dev-gated** in your tree. The overlay's config is bundler-neutral
([`src/muse/config.ts`](../src/muse/config.ts)): it reads `import.meta.env` (Vite),
`window.__MUSE__` (any host), or `process.env`, and never throws off-Vite.

```tsx
'use client' // Next.js: the overlay is client-only

import { MuseOverlay } from '@/muse/MuseOverlay'
import { configureMuse } from '@/muse/config'
import '@/muse/muse.css'

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

## Environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | the AI chat (`/chat`) on the `anthropic` backend + `/observe` (Haiku). |
| `MUSE_BACKEND` | `claude-cli` (default, uses your Claude subscription via `claude -p`) or `anthropic`. |
| `MUSE_ROOT` | project root for the standalone server (defaults to cwd). |
| `MUSE_API_BASE` | client default for `apiBase` (or call `configureMuse`). |

Canvas Mode (direct manipulation: spacing/type/color/text/reorder) is deterministic and
needs **no API key** — only the AI chat does.

---

## Troubleshooting

- **Clicking an element does nothing / Canvas can't find the source.** The locator stamp
  isn't reaching the DOM. Check `document.querySelector('[data-muse-loc]')` in the console:
  if it's empty, the Babel rule isn't running on your source (wrong glob, prod gate firing,
  or `babel-loader` not passing a `filename` — the plugin silently skips elements with no
  filename). Confirm the rule's glob matches your folders and that you're in dev.
- **The attribute shows up in a production build.** A build ran without `NODE_ENV=production`.
  Prefer the scoped `dev` `turbopack.rules` form over a global `babel.config.js`.

## What's verified vs. pending

- **Verified here:** the locator plugin stamps correctly through bare `@babel/core` (the
  `babel-loader` pathway) and is byte-identical to the Vite twin; the Web adapter routes,
  reads bodies, and returns correct statuses; the overlay config is bundler-safe.
- **Pending on a real host:** end-to-end on a live Next.js 16 + React 19 app (Turbopack
  rule → stamp → select → same-origin route → write → reload). Wire it per the above and
  confirm a Canvas scrub and a chat edit both round-trip.
