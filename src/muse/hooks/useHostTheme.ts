import { useEffect } from 'react'

/**
 * Mirrors the host app's color scheme onto the Muse UI root by writing
 * `data-theme="light" | "dark"` on the passed element. The CSS variables in
 * `muse.css` flip based on that attribute.
 *
 * Detection order:
 *   1. `html.dark` class (the de facto Tailwind dark-mode convention)
 *   2. `prefers-color-scheme: dark` media query
 *
 * Listens to both, so toggling the host's theme propagates without a refresh.
 *
 * `ready` lets the caller re-run this once the ref is actually attached. The
 * overlay is portaled into a Shadow DOM root that mounts asynchronously, so on
 * first render `rootRef.current` is still null — without a changing dependency
 * the effect would bail on that null and never write `data-theme`, leaving the
 * overlay stuck on its CSS default (dark) no matter the host theme.
 */
export function useHostTheme(rootRef: React.RefObject<HTMLElement | null>, ready?: unknown) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')

    const compute = (): 'light' | 'dark' => {
      const html = document.documentElement
      if (html.classList.contains('dark')) return 'dark'
      if (html.classList.contains('light')) return 'light'
      const dt = html.getAttribute('data-theme')
      if (dt === 'dark' || dt === 'light') return dt
      return mql.matches ? 'dark' : 'light'
    }

    const apply = () => root.setAttribute('data-theme', compute())
    apply()

    const mo = new MutationObserver(apply)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    mql.addEventListener('change', apply)

    return () => {
      mo.disconnect()
      mql.removeEventListener('change', apply)
    }
  }, [rootRef, ready])
}
