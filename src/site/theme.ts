import { useSyncExternalStore } from 'react'

// Light/dark/system theme for the docs site, as a single shared store (so every
// ThemeToggle instance + anything reactive stays in sync — two independent
// useState copies would desync). Applies an explicit `light`/`dark` class to
// <html>: Tailwind's darkMode:'class' reads `dark`, and Muse's overlay
// (useHostTheme) reads the explicit class too, so one control themes both. The
// initial class is set pre-paint by the inline script in index.html.
export type Theme = 'light' | 'dark' | 'system'
const KEY = 'muse-site-theme'

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
export const resolvedDark = (theme: Theme): boolean => theme === 'dark' || (theme === 'system' && systemDark())

function apply(theme: Theme) {
  const r = document.documentElement
  const dark = resolvedDark(theme)
  r.classList.toggle('dark', dark)
  r.classList.toggle('light', !dark)
}

let current: Theme = ((): Theme => {
  try {
    return (localStorage.getItem(KEY) as Theme) || 'system'
  } catch {
    return 'system'
  }
})()
const subs = new Set<() => void>()

export function setTheme(t: Theme) {
  current = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* ignore */
  }
  apply(t)
  subs.forEach((f) => f())
}

// Re-apply when the OS flips, but only while following the system. Guarded so
// importing this module in a non-browser context (tests, a future SSR build)
// can't throw at import time.
if (typeof window !== 'undefined') {
  // Make the <html> light/dark class match state on load too — not only via the
  // pre-paint inline script — so the site (and the Muse overlay, which reads that
  // class) theme correctly even if that script is stripped, skipped, or runs stale.
  apply(current)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') {
      apply('system')
      subs.forEach((f) => f())
    }
  })
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => current,
  )
  return { theme, setTheme, isDark: resolvedDark(theme) }
}
