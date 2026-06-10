// The docs site's page model. Hash-routed (e.g. #/install) so links are shareable
// and a static host needs no SPA rewrite rules.
export type PageId = 'overview' | 'install' | 'how' | 'styling' | 'reference' | 'troubleshooting'

export const NAV: { id: PageId; label: string; blurb: string }[] = [
  { id: 'overview', label: 'Overview', blurb: 'What Muse is' },
  { id: 'install', label: 'Install', blurb: 'Add it to your app' },
  { id: 'how', label: 'How it works', blurb: 'The engine' },
  { id: 'styling', label: 'Styling', blurb: 'Every system, live' },
  { id: 'reference', label: 'Reference', blurb: 'Gestures & limits' },
  { id: 'troubleshooting', label: 'Troubleshooting', blurb: 'When an edit refuses' },
]

export function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return (NAV.find((n) => n.id === raw)?.id ?? 'overview') as PageId
}
