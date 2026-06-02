// Shared presentational building blocks for the docs site. Styled with literal
// Tailwind utility classes (warm stone palette + brick accent, light/dark via the
// `dark` class on <html>) so the look stays cohesive. The editable page CONTENT is
// written inline in each page (see pages/*) so Canvas Mode can map and edit it;
// these are the surrounding chrome (code blocks, callouts, keys).
import type { ReactNode } from 'react'

// ── Code ──────────────────────────────────────────────────────────────────
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-stone-200/60 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-800 dark:bg-stone-800 dark:text-stone-200">
      {children}
    </code>
  )
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-stone-200 bg-[#1c1a17] dark:border-stone-800">
      {label && (
        <div className="border-b border-white/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-stone-400">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed text-stone-100">{children}</pre>
    </div>
  )
}

// ── Text ──────────────────────────────────────────────────────────────────
export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">{children}</h1>
}
export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
      {children}
    </h2>
  )
}
export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 text-base font-semibold tracking-tight text-stone-900 dark:text-stone-100">{children}</h3>
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">{children}</p>
}
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-lg leading-relaxed text-stone-500 dark:text-stone-400">{children}</p>
}

// ── Callout ───────────────────────────────────────────────────────────────
export function Callout({ children, tone = 'note' }: { children: ReactNode; tone?: 'note' | 'try' }) {
  const styles =
    tone === 'try'
      ? 'border-[#7f2f2f]/25 bg-[#7f2f2f]/[0.05] text-[#7f2f2f] dark:border-[#dd8e6b]/25 dark:bg-[#dd8e6b]/[0.08] dark:text-[#e3a384]'
      : 'border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/[0.08] dark:text-amber-200/90'
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
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[12px] font-medium text-stone-700 shadow-[0_1px_0_rgb(0_0_0/0.05)] dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:shadow-none">
      {children}
    </kbd>
  )
}

// ── Buttons (also serve as editable playground elements) ────────────────────
export function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
      {children}
    </button>
  )
}
export function SecondaryButton({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-[#201d16] dark:text-stone-200 dark:hover:bg-stone-800">
      {children}
    </button>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
      {children}
    </div>
  )
}
