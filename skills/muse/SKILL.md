---
name: muse
description: Install the Muse visual editing overlay into a running React app (Vite, Next.js, or webpack) so you can point at elements in your live app and edit the real source. Vendors the engine and wires the dev-only locator + backend for the host's bundler.
---

# Muse Setup

Install Muse — an in-context visual editor: select any element in your running
app and edit its **real source code**. **Canvas Mode** makes deterministic edits
with no API key:

- scrub spacing / size / type / color, and drag to reorder siblings
- edit static text in place — and **prop-driven text** (`<span>{label}</span>`),
  traced one hop to the usage-site literal (`<Card label="…"/>`) in the caller and
  edited there
- edit a **shared style const** (`style={body}`) on just this element, or across
  **every instance** (its definition), via a scope toggle
- a **design-token panel** to retune the host's CSS custom properties (`--c-*`)
  without first finding an element that uses them

Every Canvas edit is a surgical, reviewable source splice that flows through the
same undo/redo history.

Muse is not yet an npm package, so this skill **vendors** the engine (copies it
into the project) and wires three pieces into the host:

1. **Locator** — a Babel plugin that stamps `data-muse-loc="file:line:col"` so a
   clicked DOM node maps back to source. Works on **React 18 and 19**.
2. **Backend** — the dev-only `/api/muse/*` endpoints that rewrite source on disk.
3. **Overlay** — `<MuseOverlay/>`, mounted dev-gated.

The canonical wiring reference is **`docs/HOSTING.md`** in the Muse repo — vendor
it (Step 1) and follow its *concepts* when a host detail here is ambiguous. Its
example file paths are illustrative; **this skill vendors to `src/muse/`,
`muse-server/`, and `muse-babel/`**, so prefer the paths shown in these steps.

## Step 0 — Detect the host and pick a track

Read the target project's `package.json` and config files. Determine the bundler
and React version, then follow the matching track in Steps 3–4. Do NOT stop on
Next.js or React 19 — those are supported.

- **Vite** — `vite` + `@vitejs/plugin-react` in deps, a `vite.config.{ts,js}`. → **Track V**.
- **Next.js** — `next` in deps. **16+** defaults to Turbopack → **Track N**.
  **15** defaults to webpack but can opt into Turbopack (a `--turbopack` flag in
  the dev script): if Turbopack is in use → **Track N**; otherwise wire the locator
  with the **Track W** webpack rule (the Next route backend in Step 4 still applies).
  App Router (`app/`) is assumed.
- **webpack / CRA / other** — `react-scripts`, a `webpack.config.*`, or anything
  else that runs Babel. → **Track W**.
- **Can't tell / unsupported bundler** — fall back to the **standalone server**
  backend (Track W backend) and tell the user the locator must be wired manually
  per `docs/HOSTING.md`.

Also confirm Muse isn't already installed: if `src/muse/` exists or `musePlugin` /
`createMuseWebRouter` / `data-muse-loc` already appear in the project, report that
Muse is set up and exit.

**Important constraint:** the engine only writes files under **`<root>/src/`**
(a safety boundary). The host's own editable components must live under `src/`.
Next.js App Router projects often keep code in `app/`/`components/` at the root —
those projects must use the `src/` layout (Next supports `src/app`). If the host's
code isn't under `src/`, tell the user Muse can select but not save edits to it
until their source moves under `src/`.

## Step 1 — Vendor the engine

Clone Muse and copy the engine into the target. Run from the target project root:

```bash
TMP="$(mktemp -d)"
git clone --depth 1 https://github.com/thientran01/Muse "$TMP/muse"
cp -r "$TMP/muse/src/muse"  ./src/muse           # overlay + deterministic engine (client)
cp -r "$TMP/muse/server"    ./muse-server         # museCore, musePlugin, webAdapter, standaloneServer, styleEdit
cp -r "$TMP/muse/babel"     ./muse-babel          # muse-loc.cjs — the universal locator plugin
cp "$TMP/muse/docs/HOSTING.md" ./muse-server/HOSTING.md   # the canonical wiring reference
```

`src/muse/` is the client (overlay, components, hooks, store, `style/`, `muse.css`).
`muse-server/` is dev-only and never ships to a production build. Adjust the
destination folder names if they collide with the host's layout.

## Step 2 — Install dependencies

The engine parses ASTs; the overlay uses Phosphor icons. Detect the package
manager (`pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, else npm) and install:

```bash
npm install @babel/parser @babel/traverse @babel/types @phosphor-icons/react
npm install -D @types/babel__traverse babel-loader   # babel-loader only needed for Track N/W
```

Canvas Mode is deterministic and needs no API key.

## Step 3 — Wire the locator (`data-muse-loc`)

The plugin self-gates on `NODE_ENV === 'production'`, so it never leaks the
attribute into a prod build. Pick the track from Step 0.

**Track V — Vite.** Add the stamp to `@vitejs/plugin-react`'s Babel plugins, dev/serve only:

```ts
// vite.config.ts
import museLoc from './muse-babel/muse-loc.cjs'
// inside defineConfig(({ command }) => ({ ... }))
const isDev = command === 'serve'
plugins: [react({ babel: { plugins: isDev ? [museLoc] : [] } }), /* musePlugin() — Step 4 */]
```

**Track N — Next.js 16 (Turbopack).** Add a dev-only, src-scoped `babel-loader`
rule. Pass the plugin as a resolved string path (Turbopack forbids `require()`'d
module objects as loader options):

```js
// next.config.js
const dev = process.env.NODE_ENV !== 'production'
module.exports = {
  turbopack: {
    rules: dev ? {
      '{app,src,components}/**/*.{tsx,jsx}': {
        loaders: [{
          loader: 'babel-loader',
          options: { babelrc: false, configFile: false, presets: ['next/babel'],
                     plugins: [require.resolve('./muse-babel/muse-loc.cjs')] },
        }],
        as: '*.js',
      },
    } : {},
  },
}
```

(Next.js **<16** uses webpack — use the Track W webpack rule instead.)

**Track W — webpack / CRA.** Add a dev-gated `babel-loader` rule for `.tsx/.jsx`:

```js
if (process.env.NODE_ENV !== 'production') {
  config.module.rules.push({
    test: /\.(tsx|jsx)$/, exclude: /node_modules/,
    use: [{ loader: 'babel-loader', options: { babelrc: false, configFile: false,
            plugins: [require.resolve('./muse-babel/muse-loc.cjs')] } }],
  })
}
```

## Step 4 — Wire the backend (`/api/muse/*`)

**Track V — Vite plugin** (same-origin, simplest):

```ts
import { musePlugin } from './muse-server/musePlugin'
// add musePlugin() to the plugins array, after react()
```

**Track N — Next.js same-origin route.** Add `app/api/muse/[...muse]/route.ts`,
gated to development (Muse writes to disk). First add a path alias so the import
resolves to the **root-level** `muse-server/` (a Next `src/` project's default `@/`
points at `src/`, not the root) — in `tsconfig.json` `compilerOptions.paths`:
`"@muse-server/*": ["./muse-server/*"]`. Then:

```ts
import { createMuseContext } from '@muse-server/museCore'
import { createMuseWebRouter } from '@muse-server/webAdapter'
export const runtime = 'nodejs'          // museCore uses fs/child_process — never Edge
export const dynamic = 'force-dynamic'
const router = process.env.NODE_ENV !== 'production'
  ? createMuseWebRouter(createMuseContext(process.env, process.cwd())) : null
async function handle(req: Request) { return router ? router(req) : new Response('Not found', { status: 404 }) }
export { handle as GET, handle as POST }
```

Same-origin, so the overlay's default `apiBase` (`''`) just works.

**Track W / fallback — standalone server.** For hosts that can't serve the backend
in-process, run the bundled Node server (binds localhost by default):

```bash
MUSE_ROOT="$(pwd)" npx tsx muse-server/standaloneServer.ts   # http://127.0.0.1:4747
```

Then point the overlay at it in Step 6: `configureMuse({ apiBase: 'http://localhost:4747' })`.

## Step 5 — Styling (nothing to do)

There is **no styling step**. The overlay renders inside a **Shadow DOM** root and
injects its own compiled stylesheet there, so its CSS is fully isolated from the
host — it can't collide with the host's styles (or be broken by them), and the host
imports **no CSS** and runs **no Tailwind** for Muse. Do NOT generate a stylesheet or
touch the host's Tailwind config. (Earlier versions of this skill generated a global
utility stylesheet here — that is what broke Tailwind hosts; it's gone.)

## Step 6 — Mount the overlay (dev-only)

Mount `<MuseOverlay/>` behind a dev gate. The overlay config is bundler-neutral and
brings its own styles (no CSS import needed).

```tsx
'use client'                                       // Next.js ONLY — omit on Vite / webpack
import { MuseOverlay } from './muse/MuseOverlay'    // adjust import path to your tree
import { configureMuse } from './muse/config'

// configureMuse({ apiBase: 'http://localhost:4747' })   // only for the standalone-server backend
export function DevMuse() {
  // process.env.NODE_ENV is replaced at build time by Vite, Next, AND webpack —
  // this one guard works on every host. (Do NOT swap in import.meta.env.DEV; it's
  // undefined outside Vite.)
  if (process.env.NODE_ENV === 'production') return null
  return <MuseOverlay />
}
```

Render `<DevMuse/>` once at the app root, as the last child so it floats on top.
One React instance only — mount from the host's own React, never a second copy.

## Step 7 — Verify

1. Start the dev server and open the app.
2. In the console, `document.querySelectorAll('[data-muse-loc]').length` should be
   > 0 — that confirms the locator stamp is running. If it's 0, the Step 3 rule
   isn't hitting your source (wrong glob, prod gate, or no `filename`); re-check it.
3. The **Muse FAB** appears (bottom-right), console clean. Open it, select an
   element, scrub its padding — it updates live and the change is written to the
   real source file (`git diff`). Undo with Cmd/Ctrl+Z. (To see the rest: double-
   click prop text to trace it to its usage site, select an element styled via a
   shared `style={const}` for the scope toggle, or open the **Design tokens**
   popover from the toolbar to retune a CSS custom property.)

## Notes

- **Dev-only.** The Vite plugin is `apply: 'serve'`, the Next route and standalone
  server self-gate to dev, the locator self-gates on `NODE_ENV`, and the overlay is
  dev-gated — nothing reaches a production build.
- **Works on React 18 and 19, any bundler that runs Babel.** The `data-muse-loc`
  stamp replaced the old React-18-only fiber dependency.
- **Canvas Mode is free + deterministic** (no model call, no key).
- **Vendored copy** — it won't auto-update when Muse changes. Re-run the skill to
  refresh. The full per-host reference is the vendored `muse-server/HOSTING.md`.

## Next.js gotchas

- **SSR is fine.** The overlay is SSR-safe (it renders nothing until its shadow root
  mounts client-side, and the store carries a server snapshot). If a host wrapper
  still throws during SSR, mount via `next/dynamic` with `{ ssr: false }` as a
  fallback — but you shouldn't need to.
- **A "redundant babel-loader" notice** can appear once you wire the Track N
  `turbopack.rules` rule. It's expected (Turbopack noting Babel runs alongside its
  SWC); silence it with `experimental.turbopackUseBuiltinBabel: true` in
  `next.config.js`. Not an error.
- **Tailwind v4 scans the vendored `src/muse/`.** Muse source is kept Tailwind-scan-safe
  (no parseable class strings in comments), so this is normally a no-op. If your host's
  Tailwind ever flags a vendored Muse file, exclude `src/muse` from its content scan
  (`@source not` in your CSS) — the overlay never needs the host's Tailwind.
