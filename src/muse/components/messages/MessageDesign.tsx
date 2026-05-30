import { useState } from 'react'
import { CircleNotch, Sparkle } from '@phosphor-icons/react'

// Loosely summarize the brief's YAML frontmatter for a visual card — name, the
// color swatches, and the type pairing. Display-only; not a real YAML parser.
function summarize(md: string): { name: string; colors: string[]; fonts: string[] } {
  const src = (md || '').slice(0, 8000) // frontmatter lives at the top; cap the scan
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? src
  const name = (fm.match(/^name:\s*(.+)$/m)?.[1] ?? 'Design system').trim().replace(/^["']|["']$/g, '')
  const colors = [...new Set(fm.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])].slice(0, 12)
  const fonts = [
    ...new Set(
      (fm.match(/fontFamily:\s*["']?([^"'\n,}]+)/g) ?? []).map((s) =>
        s.replace(/fontFamily:\s*["']?/, '').trim(),
      ),
    ),
  ].slice(0, 3)
  return { name, colors, fonts }
}

// The app's design system, shown in the thread. Three states:
//  - offer:      no brief yet → prompt to generate one
//  - generating: the LLM is writing it (~45s)
//  - view:       a compact card (name + swatches + type) with "view full" to
//                expand the raw markdown.
export function MessageDesign({
  status,
  content,
  path,
  onGenerate,
}: {
  status: 'offer' | 'generating' | 'view'
  content?: string
  path?: string
  onGenerate: () => void
}) {
  const [open, setOpen] = useState(false)

  if (status === 'offer') {
    return (
      <div className="animate-muse-rise space-y-2.5 rounded-xl bg-line/[0.03] p-3 ring-1 ring-line/10 motion-reduce:animate-none">
        <p className="text-sm leading-relaxed text-fg">
          No design system on file yet. Want me to read your app's styles and write one? It keeps
          every edit on-brand.
        </p>
        <button
          onClick={onGenerate}
          className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90"
        >
          <Sparkle size={13} weight="fill" /> Generate design system
        </button>
      </div>
    )
  }

  if (status === 'generating') {
    return (
      <div className="animate-muse-rise flex items-center gap-2 rounded-xl bg-line/[0.03] p-3 text-sm text-fg-muted ring-1 ring-line/10 motion-reduce:animate-none">
        <CircleNotch size={15} className="animate-spin motion-reduce:animate-none" />
        Reading your styles and writing a brief… (~45s)
      </div>
    )
  }

  const { name, colors, fonts } = summarize(content ?? '')
  return (
    <div className="animate-muse-rise space-y-3 rounded-xl bg-line/[0.03] p-3 ring-1 ring-line/10 motion-reduce:animate-none">
      <div className="space-y-2">
        <div className="text-sm font-semibold text-fg">{name}</div>
        {colors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => (
              <span
                key={c}
                title={c}
                className="h-5 w-5 rounded-full ring-1 ring-line/20"
                style={{ background: c }}
              />
            ))}
          </div>
        )}
        {fonts.length > 0 && <div className="text-xs text-fg-faint">{fonts.join(' · ')}</div>}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={() => setOpen((v) => !v)}
          className="font-medium text-accent transition hover:underline"
        >
          {open ? 'Hide' : 'View full'}
        </button>
        {path && <span className="truncate font-mono text-fg-faint">{path}</span>}
      </div>
      {open && (
        // No inner scroll — the brief flows in the panel's single scroll area
        // so expanding it never stacks a second scrollbar inside the first.
        <pre className="whitespace-pre-wrap rounded-lg bg-line/5 p-2.5 text-[11px] leading-relaxed text-fg-muted ring-1 ring-line/10">
          {content}
        </pre>
      )}
    </div>
  )
}
