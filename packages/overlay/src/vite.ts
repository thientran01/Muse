// ============================================================
//  @thientran01/muse/vite  —  Vite dev-server backend
// ------------------------------------------------------------
//  Add musePlugin() to your vite.config plugins (after react()). It registers
//  the /api/muse/* endpoints as dev middleware (apply: 'serve', never a build).
// ============================================================
export { musePlugin } from '../../../server/musePlugin'
