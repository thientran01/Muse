import { useEffect, useState } from 'react'
import { OVERLAY_CSS } from '../generated/overlayCss'

// ============================================================
//  useShadowHost — mount the overlay inside an isolated Shadow DOM root
// ------------------------------------------------------------
//  The overlay's chrome is portaled into a Shadow DOM root so its CSS is fully
//  encapsulated: the host page's styles can't reach in, and Muse's Tailwind
//  utilities can't leak out and collide with the host (the bug that broke a
//  Tailwind v4 host). Shadow roots don't inherit document stylesheets, so the
//  overlay's compiled CSS (generated/overlayCss.ts) is injected here once.
//
//  Returns the mount element (a <div> inside the shadow root) to portal into, or
//  null until it's created (client-only; SSR-safe — render nothing until mounted).
//
//  The shadow HOST element carries `data-muse-ui`. That matters: the overlay's
//  hit-testing reads `e.target` from capture-phase document listeners and asks
//  `closest('[data-muse-ui]')`. Events from inside the shadow retarget `e.target`
//  to this host element at the boundary, so the existing guards keep recognizing
//  the chrome as Muse's own — no change to the selection logic.
// ============================================================
export function useShadowHost(): HTMLElement | null {
  const [mount, setMount] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-muse-ui', '')
    // Light-DOM host: out of layout flow, never intercepts page clicks. The chrome
    // inside re-enables pointer-events per interactive element (as it always has).
    // Max z-index so the overlay stacks ABOVE the host's own positioned chrome (a
    // fixed header/nav would otherwise paint over the top banner): the inner z-[…]
    // values only order things WITHIN the shadow; the host's z-index is what places
    // the whole overlay in the page's stacking order.
    host.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;'

    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    const content = document.createElement('div')
    shadow.append(style, content)

    document.body.appendChild(host)
    setMount(content)

    return () => {
      // Drop the stale mount before removing the host so a StrictMode teardown/
      // remount cycle never portals into the detached node for a render.
      setMount(null)
      host.remove()
    }
  }, [])

  return mount
}
