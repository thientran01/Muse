// ============================================================
//  @thientran01/muse  —  client entry (the overlay)
// ------------------------------------------------------------
//  Mount <MuseOverlay/> dev-gated in your app root. Bundled from the repo's
//  src/muse source by tsup; react/react-dom are peers (the host's own copy).
// ============================================================
export { MuseOverlay } from '../../../src/muse/MuseOverlay'
export { configureMuse, getApiBase, MOCK, EPHEMERAL } from '../../../src/muse/config'
