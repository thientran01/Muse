import { useEffect, useState } from 'react'
import { NAV, pageFromHash, type PageId } from './nav'
import { Overview } from './pages/Overview'
import { Install } from './pages/Install'
import { Features } from './pages/Features'
import { HowItWorks } from './pages/HowItWorks'
import { Reference } from './pages/Reference'
import { FeedbackWidget } from './FeedbackWidget'

// The Muse docs site — a self-demonstrating page (Agentation-style): the prose and
// example components you read ARE the editable surface. Muse's overlay is mounted
// alongside it (see App.tsx), so pressing L lets you restyle anything here; in the
// hosted demo those edits are ephemeral (reset on refresh).
const PAGES: Record<PageId, () => JSX.Element> = {
  overview: Overview,
  install: Install,
  features: Features,
  how: HowItWorks,
  reference: Reference,
}

export default function SiteApp() {
  const [page, setPage] = useState<PageId>(pageFromHash)

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const Page = PAGES[page]

  return (
    <div className="min-h-screen bg-[#faf9f7] text-zinc-900 antialiased">
      <div className="mx-auto flex max-w-6xl">
        {/* Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200/80 px-6 py-7 md:flex">
          <a href="#/overview" className="flex items-center gap-2.5">
            <MuseMark />
            <span className="text-lg font-semibold tracking-tight">Muse</span>
          </a>
          <p className="mt-1 text-[13px] leading-snug text-zinc-500">
            Visual editing for design engineers
          </p>
          <nav className="mt-8 flex flex-col gap-1">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#/${n.id}`}
                aria-current={page === n.id ? 'page' : undefined}
                className={`group rounded-lg px-3 py-2 transition-colors ${
                  page === n.id ? 'bg-white shadow-sm ring-1 ring-zinc-200' : 'hover:bg-white/60'
                }`}
              >
                <span className="block text-sm font-medium text-zinc-800">{n.label}</span>
                <span className="block text-[12px] text-zinc-500">{n.blurb}</span>
              </a>
            ))}
          </nav>
          <div className="mt-auto pt-6 text-[12px] text-zinc-400">
            <a href="https://github.com/thientran01/Muse" className="hover:text-zinc-600">
              GitHub ↗
            </a>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 px-6 py-10 md:px-12 md:py-14">
          <div className="mx-auto max-w-2xl">
            <Page />
            <footer className="mt-20 border-t border-zinc-200 pt-6 text-[13px] text-zinc-400">
              Muse — point at your running app, say what you want, get real code.
            </footer>
          </div>
        </main>
      </div>

      <FeedbackWidget />
    </div>
  )
}

// The manta-ray mark, simplified for the host site header (the overlay has its own
// animated version). Inline so the docs site has no dependency on Muse internals.
function MuseMark() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#7f2f2f] text-white">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M12 4c-1 0-2 .8-3.2 2.2C7 8 4 9.5 3 12c2.2-.4 3.8-.2 5.2.6-.4 1.2-.3 2.6.3 4 .9-1.4 1.7-2.2 2.5-2.5v.002c.8.3 1.6 1.1 2.5 2.5.6-1.4.7-2.8.3-4 1.4-.8 3-1 5.2-.6-1-2.5-4-4-5.8-5.8C14 4.8 13 4 12 4z" />
      </svg>
    </span>
  )
}
