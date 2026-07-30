import { EPHEMERAL, MOCK } from '../../../src/muse/config'
import { MuseOverlay } from '../../../src/muse/MuseOverlay'
import ScrubTarget from './ScrubTarget'

// Both flags are module-level consts in the overlay, resolved once at import and
// never exposed to the page. Re-publishing them here is what lets preflight.spec
// say "EPHEMERAL is on, so no gesture will ever reach the server" instead of
// leaving every byte assertion to fail against an unchanged file.
declare global {
  interface Window {
    __museE2E?: { mock: boolean; ephemeral: boolean }
  }
}
window.__museE2E = { mock: MOCK, ephemeral: EPHEMERAL }

// One file per spec, so specs never contend over the same source. The suite runs
// serially against a single dev server, and each spec restores only its own file
// between tests — file-level isolation rather than directory-level, which keeps
// the server (and its memoized strategy detection) stable for the whole run.
//
// MuseOverlay is mounted unconditionally. A real host gates it behind
// import.meta.env.DEV; doing that here would make the suite depend on the mode.
export default function App() {
  return (
    <>
      <main>
        <h1>Muse E2E fixture</h1>
        <ScrubTarget />
      </main>
      <MuseOverlay />
    </>
  )
}
