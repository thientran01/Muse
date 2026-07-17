# @thientran01/muse

**Point at anything in your running React app, shape it like a design tool, and Muse rewrites the real source code.** A dev-only visual editing overlay — every edit is a deterministic AST rewrite, so it needs **no API key and no model call**.

This is the npm package. For the vendored (skill) install or to wire a host by hand, see [`docs/HOSTING.md`](https://github.com/thientran01/Muse/blob/main/docs/HOSTING.md) in the repo.

> **Dev-only.** Muse reads and rewrites source on disk. The Vite plugin is `apply: 'serve'`, the Next route and locator self-gate to development, and the overlay is dev-gated — nothing reaches a production build.

## Install

```bash
npm i -D @thientran01/muse
```

`react` and `react-dom` (18 **or** 19) are peers — Muse uses your app's own copy.

## Wire it

Muse needs three pieces: a **locator** (a Babel plugin that stamps `data-muse-loc` so a clicked element maps to source), a **backend** (`/api/muse/*`, dev-only, rewrites source), and the **overlay** (`<MuseOverlay/>`).

### Vite

```ts
// vite.config.ts
import react from '@vitejs/plugin-react'
import { musePlugin } from '@thientran01/muse/vite'
import museLoc from '@thientran01/muse/babel'

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'
  return {
    plugins: [
      react({ babel: { plugins: isDev ? [museLoc] : [] } }),
      musePlugin(),
    ],
  }
})
```

### Next.js (App Router, Turbopack)

Add a dev-only `babel-loader` rule for the locator, then a same-origin route for the backend:

```ts
// app/api/muse/[...muse]/route.ts
import { createMuseContext, createMuseWebRouter } from '@thientran01/muse/next'

export const runtime = 'nodejs' // museCore uses fs/child_process — never Edge
export const dynamic = 'force-dynamic'

const router = process.env.NODE_ENV !== 'production'
  ? createMuseWebRouter(createMuseContext(process.env, process.cwd()))
  : null

async function handle(req: Request) {
  return router ? router(req) : new Response('Not found', { status: 404 })
}
export { handle as GET, handle as POST }
```

The locator (`@thientran01/muse/babel`) wires via `turbopack.rules` / `babel-loader` — see [`docs/HOSTING.md`](https://github.com/thientran01/Muse/blob/main/docs/HOSTING.md) for the exact Next / webpack rule.

### Mount the overlay (any host)

```tsx
'use client' // Next.js only
import { MuseOverlay } from '@thientran01/muse'

export function DevMuse() {
  if (process.env.NODE_ENV === 'production') return null
  return <MuseOverlay />
}
```

Render `<DevMuse/>` once at the app root. No CSS import — the overlay renders in a Shadow DOM root and injects its own styles, isolated from the host. One React instance only.

## Exports

| Entry | What |
|---|---|
| `@thientran01/muse` | `MuseOverlay`, `configureMuse`, `getApiBase` |
| `@thientran01/muse/vite` | `musePlugin()` — Vite dev middleware |
| `@thientran01/muse/next` | `createMuseWebRouter`, `createMuseContext` — Next App Router backend |
| `@thientran01/muse/babel` | the `data-muse-loc` locator plugin (CJS, for `babel-loader` / Vite) |

Requires **React 18 or 19**. Hosts: Vite, Next.js (Turbopack), webpack. Full reference: [`docs/HOSTING.md`](https://github.com/thientran01/Muse/blob/main/docs/HOSTING.md).

## License

MIT
