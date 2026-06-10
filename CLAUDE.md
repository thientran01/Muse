# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

**Global instructions** (PRs, branching, self-review, vault cadence): `~/.claude/CLAUDE.md`  
**Project decisions & longitudinal history**: Obsidian vault note `Projects/Muse.md` — read it before major decisions.  
**Project memory** (current state, active PRs, root causes): `~/.claude/projects/C--Users-Thien-Downloads-Muse/memory/MEMORY.md` — auto-loaded.

Code workflow summary: branch off `main` (`feature/`, `fix/`), open a PR via `gh pr create`, run `/quick-review` before merging, squash-merge. Never commit directly to `main`.

---

## Commands

```bash
npm run dev              # Vite dev server — includes musePlugin + museLoc Babel transform
npm run build            # build:overlay-css → tsc → vite build (prod, no musePlugin)
npm run build:demo       # Same but forces dev JSX runtime so _debugSource survives the build
npm run preview          # Serve dist/ locally
npm run muse-server      # Standalone Node server (non-Vite hosts) via tsx
npm run build:overlay-css  # Regenerate src/muse/generated/overlayCss.ts
npm test                 # Engine test harness (vitest) — server/__tests__/, all 5 style strategies
npm run test:watch       # Same, watch mode
```

Engine changes (server/, src/muse/style/) are covered by the vitest harness in `server/__tests__/` — run `npm test` (fixtures assert byte-exact output incl. CRLF; handler suites build throwaway tmp-dir projects). UI changes still verify via `npm run dev` (the docs site at `src/site/` IS the editable surface).

> **Canvas-only (2026-06-04).** The AI agent/chat was removed from `main` for the public release; Canvas Mode (direct manipulation) is the only feature. The full agent is preserved on the `feature/agent` branch + the `agent-snapshot` tag — revive from there. No `@anthropic-ai/sdk`, no `ANTHROPIC_API_KEY`, no `/chat` or `/observe`. The **DESIGN.md brief + its AI generator were also removed** — only the deterministic **CSS token editor** survives, re-homed as the toolbar's "Design tokens" popover (`/tokens` + `/token-edit`). No model-backed call remains anywhere.

---

## Architecture

Muse is a floating overlay that loads alongside a React + Vite app in dev. You click an element and shape it directly (drag/scrub/pick/reorder), and Muse rewrites the source file — Vite HMR reloads the app.

### Element → source mapping

`src/muse/sourceLocation.ts` resolves a clicked DOM element to a source location two ways:
1. **`data-muse-loc="file:line:col"`** attribute — stamped by `server/babelPluginMuseLoc.ts` (Babel plugin in `vite.config.ts` for `serve` + `demo` modes). Preferred; exact disk line.
2. **React fiber `_debugSource`** — walk `__reactFiber$` → `_debugSource`/`_debugOwner`. Fallback only; has a React Fast Refresh line-offset bug (+19 lines). See memory: `canvas-mode-line-offset-rootcause.md`.

React 18 is pinned intentionally — React 19 removes `_debugSource`.

### Backend: Vite plugin middleware

`server/musePlugin.ts` is a thin adapter; all logic lives in `server/museCore.ts` (`createMuseHandlers`). Registered via `configureServer` hook (`apply: 'serve'`) — same origin as the dev server, no CORS, direct filesystem access, never enters a prod build. Every endpoint is deterministic (no model call):

Canvas: `POST /api/muse/style-edit`, `/text-edit`, `/reorder`, `/write`, plus probes `/style-scope`, `/text-editable`, `/reorderable` and tokens `/tokens`, `/token-edit`. Flags: `/flag`, `/flags`, `/flag-resolve`, `/flag-delete`. Share: `/share-probe`, `/share`.

For non-Vite hosts: `server/standaloneServer.ts` (Node http) and `server/webAdapter.ts` (Web Request/Response for Next App Router). See `docs/HOSTING.md`.

### Share changes (session → branch/PR)

`server/gitShare.ts` turns the session's touched files into a reviewable PR for a designer who doesn't know git. Core invariant: **never checkout, never touch the user's index/working tree** — the commit is built against a temporary index (`GIT_INDEX_FILE` plumbing: `read-tree` → `update-index` → `write-tree` → `commit-tree`) and lands on a fresh `muse/*` ref via `update-ref`; hooks/signing never run. Push + `gh pr create --head` (compare-URL fallback). All process spawns via `execFile` (no shell) with a prompt-proof env. Client: `src/muse/sessionChanges.ts` (undo-reconciled fold over store history) feeds `ChangesPanel` (the toolbar's paper-plane popover, hidden in EPHEMERAL/MOCK); the `share` store slice carries the lifecycle + session branch. Tests: `server/__tests__/gitShare.test.ts` (real tmp-dir git repos; gh always faked).

### Canvas Mode (direct manipulation)

`src/muse/useCanvasMode.ts` + `src/muse/components/canvas/`. The FAB (or `R`) opens the overlay, making the page selectable. **Plain-click selects** and floats the properties card by the element; **Alt-click** steps to the parent; **double-click** edits text; **drag** reorders siblings; **Esc** deselects then exits. Every edit is a deterministic AST rewrite — no model call.

All canvas edits flow through `museStyleEdit`/`museTextEdit`/`museReorder` → `museWrite` → undo/redo `HistoryEntry`.

### AST-based style editing

`server/styleEdit.ts` (`computeStyleEdit`, `computeTextEdit`, `computeReorder`) uses Babel to parse JSX/TSX and locate elements by file + line + column + tag + current className. Never regex. Supports: Tailwind classes, inline styles, CSS Modules (`ModuleEdit`), styled-components/emotion templates and object syntax (`StyledEdit`), CSS variables (`VarEdit`).

Strategy auto-detected per project (`detectStrategy` in `museCore.ts`): checks for `tailwind.config.*`, package deps, and `@tailwind`/`@import "tailwindcss"` in CSS files.

### Shadow DOM isolation

`src/muse/hooks/useShadowHost.ts` — overlay chrome renders in a Shadow DOM root so Muse CSS never collides with the host app. All Muse UI portaled into the shadow root; `data-muse-ui` marks Muse elements (skipped by Canvas selection).

### State

`src/muse/store.ts` — custom in-memory store (Zustand-like). Holds the undo/redo history (`past`/`future`, `historyLoading`, `showRevertConfirm`) plus the EPHEMERAL DOM-snapshot stacks. Resets on full page refresh or store.ts HMR.

### Demo / ephemeral mode

`VITE_MUSE_EPHEMERAL=1` — canvas edits stay in-browser (no server/write calls), DOM snapshot undo/redo. Used by the hosted demo at Vercel (`npm run build:demo`). `VITE_MUSE_MOCK=1` — fixtures only, no API calls.

### Styling conventions

Motion system in `tailwind.config.js` (Emil Kowalski rules): all animations use `cubic-bezier(0.16, 1, 0.3, 1)` (easeOutExpo), under 300ms, never scale from 0. Duration tokens: 90ms (fast) / 160ms (base) / 200ms (mid) / 220ms (slow). Dark mode via `dark` class on `<html>`.

---

## Key files

| File | Role |
|---|---|
| `src/muse/MuseOverlay.tsx` | Root overlay — Canvas shell: CanvasMode + FAB/toolbar + undo/redo + revert |
| `src/muse/sourceLocation.ts` | Element → source mapping (fiber + attribute) |
| `src/muse/store.ts` | Client state (undo/redo history + ephemeral stacks) |
| `src/muse/useCanvasMode.ts` | Canvas selection + gesture logic |
| `src/muse/components/MuseToolbar.tsx` | Morphing FAB/toolbar dock + the Design tokens popover |
| `src/muse/api.ts` | Fetch wrappers for `/api/muse/*` |
| `src/muse/config.ts` | Runtime config (MOCK, EPHEMERAL, apiBase) |
| `src/muse/types.ts` | Shared types (client ↔ server contract) |
| `server/museCore.ts` | All handler logic (canvas edits + design tokens) |
| `server/musePlugin.ts` | Vite adapter (thin wrapper over museCore) |
| `server/styleEdit.ts` | AST-based style/text/reorder rewriting |
| `server/babelPluginMuseLoc.ts` | Babel plugin that stamps `data-muse-loc` |
| `server/webAdapter.ts` | Web Request/Response adapter (Next App Router) |
| `src/site/SiteApp.tsx` | Docs site root (self-demonstrating — Muse runs on its own pages) |
| `src/muse/components/TokenList.tsx` | The CSS design-token editor (the toolbar's Design tokens popover) |
| `server/gitShare.ts` | Share-changes git plumbing (temp-index commit → muse/* branch → push/PR) |
| `src/muse/components/ChangesPanel.tsx` | Session-changes list + the Share action (toolbar paper-plane popover) |
| `src/muse/sessionChanges.ts` | Undo-reconciled per-file fold over the history (feeds panel + share request) |
| `babel/muse-loc.cjs` | Host-consumable CJS twin of babelPluginMuseLoc (for Next/webpack) |
| `docs/HOSTING.md` | Integration guide for non-Vite hosts |
