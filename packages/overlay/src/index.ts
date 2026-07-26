// ============================================================
//  @thientran01/muse  —  client entry (the overlay)
// ------------------------------------------------------------
//  Mount <MuseOverlay/> dev-gated in your app root. Bundled from the repo's
//  src/muse source by tsup; react/react-dom are peers (the host's own copy).
// ============================================================
export { MuseOverlay } from '../../../src/muse/MuseOverlay'
// BREAKING in 0.2.0: the MOCK / EPHEMERAL consts are gone, replaced by isMock() /
// isEphemeral(). They were resolved once at import, so a host that set
// window.__MUSE__ after this module loaded silently lost — the failure that took
// the live case study down. Re-exporting a const alias here would reinstall that
// latch in the first file every consumer imports, so there is no compatibility shim.
export { configureMuse, getApiBase, isMock, isEphemeral } from '../../../src/muse/config'
