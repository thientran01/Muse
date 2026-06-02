// MOCK mode: when on, the overlay runs the whole flow on fixtures —
// no Claude API calls, no file writes — so the UI can be polished for free.
// Toggle with VITE_MUSE_MOCK=1 in .env.local, then restart `npm run dev`.
export const MOCK = import.meta.env.VITE_MUSE_MOCK === '1'

// EPHEMERAL mode: Canvas Mode edits apply in-browser only — no server style/
// text/reorder calls, no disk writes; the live preview becomes the committed
// state and undo/redo run on DOM snapshots. Edits persist for the session and
// reset on refresh. For the hosted static demo, which has no musePlugin backend
// (it's `apply: 'serve'`, never in a build). Independent of MOCK (a demo build is
// both, but the two are distinct concerns). Toggle with VITE_MUSE_EPHEMERAL=1.
export const EPHEMERAL = import.meta.env.VITE_MUSE_EPHEMERAL === '1'
