import SiteApp from './site/SiteApp'
import { MuseOverlay } from './muse/MuseOverlay'

export default function App() {
  // The Muse docs site IS the demo surface (Agentation-style): the overlay is
  // mounted alongside it, so pressing R lets you edit the page you're reading.
  // In the hosted demo build those edits are ephemeral (VITE_MUSE_EPHEMERAL).
  return (
    <>
      <SiteApp />
      <MuseOverlay />
    </>
  )
}
