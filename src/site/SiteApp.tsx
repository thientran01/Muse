import { useEffect, useState } from 'react'
import { NAV, pageFromHash, type PageId } from './nav'
import { Overview } from './pages/Overview'
import { Install } from './pages/Install'
import { Features } from './pages/Features'
import { HowItWorks } from './pages/HowItWorks'
import { Reference } from './pages/Reference'
import { FeedbackWidget } from './FeedbackWidget'
import { ThemeToggle } from './ThemeToggle'

// The Muse docs site — a self-demonstrating page (Agentation-style): the prose and
// example components you read ARE the editable surface. Muse's overlay is mounted
// alongside it (see App.tsx), so opening Muse and clicking lets you restyle anything
// here; in the hosted demo those edits are ephemeral (reset on refresh).
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
    <div className="min-h-screen bg-[#f7f4ee] text-stone-900 antialiased dark:bg-[#15130e] dark:text-stone-100">
      {/* Mobile top bar — the sidebar is desktop-only, so phones navigate here. */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#f7f4ee]/90 px-4 py-3 backdrop-blur dark:border-stone-800/80 dark:bg-[#15130e]/90 md:hidden">
        <div className="flex items-center justify-between">
          <a href="#/overview" className="flex items-center gap-2">
            <MuseMark />
            <span className="text-base font-semibold tracking-tight">Muse</span>
          </a>
          <ThemeToggle />
        </div>
        <nav className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Sections">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#/${n.id}`}
              aria-current={page === n.id ? 'page' : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:focus-visible:ring-[#e3a384]/50 ${
                page === n.id
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'bg-white text-stone-600 ring-1 ring-stone-200 dark:bg-[#201d16] dark:text-stone-400 dark:ring-stone-800'
              }`}
            >
              {n.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-6xl">
        {/* Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-stone-200/70 px-6 py-7 dark:border-stone-800/70 md:flex">
          <a href="#/overview" className="flex items-center gap-2.5">
            <MuseMark />
            <span className="text-lg font-semibold tracking-tight">Muse</span>
          </a>
          <p className="mt-1 text-[13px] leading-snug text-stone-600 dark:text-stone-400">Visual editing for design engineers</p>
          <nav className="mt-8 flex flex-col gap-1">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#/${n.id}`}
                aria-current={page === n.id ? 'page' : undefined}
                className={`group rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:focus-visible:ring-[#e3a384]/50 ${
                  page === n.id
                    ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-[#201d16] dark:ring-stone-800'
                    : 'hover:bg-white/60 dark:hover:bg-white/5'
                }`}
              >
                <span className="block text-sm font-medium text-stone-800 dark:text-stone-200">{n.label}</span>
                <span className="block text-[12px] text-stone-600 dark:text-stone-400">{n.blurb}</span>
              </a>
            ))}
          </nav>
          <div className="mt-auto flex items-center justify-between pt-6">
            <a href="https://github.com/thientran01/Muse" className="rounded text-[12px] text-stone-600 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:text-stone-400 dark:hover:text-stone-200 dark:focus-visible:ring-[#e3a384]/50">
              GitHub ↗
            </a>
            <ThemeToggle />
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 px-6 py-10 md:px-12 md:py-14">
          <div className="mx-auto max-w-2xl">
            {/* No entrance animation on navigation: switching docs sections happens
                tens of times a session, and per Emil's frequency rule a repeated,
                click-initiated transition reads as lag, not polish (Raycast ships
                its command palette with none). The page just swaps. */}
            <div key={page}>
              <Page />
            </div>
            <footer className="mt-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-stone-200 pt-6 text-[13px] text-stone-600 dark:border-stone-800 dark:text-stone-400">
              <span>Muse, visual editing for the app you already have.</span>
              <a
                href="https://www.linkedin.com/in/thien-trann/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded font-medium text-stone-700 underline-offset-2 transition-colors hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:text-stone-300 dark:hover:text-stone-100 dark:focus-visible:ring-[#e3a384]/50"
              >
                Made by Thien Tran ↗
              </a>
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
