// The docs site's page model. Hash-routed (e.g. #/install) so links are shareable
// and a static host needs no SPA rewrite rules.
export type PageId = 'overview' | 'install' | 'features' | 'how' | 'reference'

export const NAV: { id: PageId; label: string; blurb: string }[] = [
  { id: 'overview', label: 'Overview', blurb: 'What Muse is' },
  { id: 'install', label: 'Install', blurb: 'Add it to your app' },
  { id: 'features', label: 'Features', blurb: 'Canvas Mode + chat' },
  { id: 'how', label: 'How it works', blurb: 'The engine' },
  { id: 'reference', label: 'Reference', blurb: 'Config & limits' },
]

export function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return (NAV.find((n) => n.id === raw)?.id ?? 'overview') as PageId
}
