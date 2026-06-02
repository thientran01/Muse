// Shared presentational building blocks for the docs site. These are deliberately
// styled with literal Tailwind utility classes (not CSS-variable theming) so that
// Muse Canvas Mode can edit their spacing / type / color directly on the page —
// the demo IS the case study. Keep them simple and host-app-like.
import type { ReactNode } from 'react'

// ── Code ──────────────────────────────────────────────────────────────────
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800">
      {children}
    </code>
  )
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950">
      {label && (
        <div className="border-b border-white/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed text-zinc-100">
        {children}
      </pre>
    </div>
  )
}

// ── Text ──────────────────────────────────────────────────────────────────
export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">{children}</h1>
}
export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-zinc-900">
      {children}
    </h2>
  )
}
export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 text-base font-semibold tracking-tight text-zinc-900">{children}</h3>
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[15px] leading-relaxed text-zinc-600">{children}</p>
}
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-lg leading-relaxed text-zinc-500">{children}</p>
}

// ── Callout ───────────────────────────────────────────────────────────────
export function Callout({ children, tone = 'note' }: { children: ReactNode; tone?: 'note' | 'try' }) {
  const styles =
    tone === 'try'
      ? 'border-[#7f2f2f]/25 bg-[#7f2f2f]/[0.04] text-[#7f2f2f]'
      : 'border-amber-300/50 bg-amber-50 text-amber-800'
  return (
    <div className={`my-5 flex gap-3 rounded-xl border px-4 py-3.5 text-[14px] leading-relaxed ${styles}`}>
      <span aria-hidden className="select-none">
        {tone === 'try' ? '✎' : 'ℹ'}
      </span>
      <div className="[&_strong]:font-semibold">{children}</div>
    </div>
  )
}

// ── Keyboard key ──────────────────────────────────────────────────────────
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[12px] font-medium text-zinc-700 shadow-[0_1px_0_rgb(0_0_0/0.05)]">
      {children}
    </kbd>
  )
}

// ── Buttons (also serve as editable playground elements) ────────────────────
export function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700">
      {children}
    </button>
  )
}
export function SecondaryButton({ children }: { children: ReactNode }) {
  return (
    <button className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50">
      {children}
    </button>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>
}
