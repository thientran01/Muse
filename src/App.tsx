import SiteApp from './site/SiteApp'
import { MuseGallery } from './muse/MuseGallery'
import { MuseOverlay } from './muse/MuseOverlay'

export default function App() {
  // Dev-only: open /?gallery to see every Muse UI state at once. The overlay is
  // mounted alongside it so you can dogfood Canvas Mode on the gallery itself
  // (press L or click the FAB) — its components are real source files, so edits
  // map back via _debugSource like any host app.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('gallery')) {
    return (
      <>
        <MuseGallery />
        <MuseOverlay />
      </>
    )
  }

  // The Muse docs site IS the demo surface (Agentation-style): the overlay is
  // mounted alongside it, so pressing L lets you edit the page you're reading.
  // In the hosted demo build those edits are ephemeral (VITE_MUSE_EPHEMERAL).
  return (
    <>
      <SiteApp />
      <MuseOverlay />
    </>
  )
}
