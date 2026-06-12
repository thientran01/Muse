/**
 * Full-page freeze for the toolbar's "Freeze page" toggle.
 *
 * The injected pause stylesheet alone isn't enough for a still canvas: zeroed
 * transitions make :hover changes SNAP instead of not happening, and JS-started
 * (WAAPI) animations ignore CSS entirely. A pointer-events shield is off the
 * table — Canvas Mode hit-tests via `e.target` on document-level capture
 * listeners, so host elements must keep receiving pointer events. Instead:
 *
 *  1. Inject the pause stylesheet (CSS animations pause, transitions go instant,
 *     smooth scroll off) — everything outside [data-muse-ui].
 *  2. Neuter interactive-state selectors (:hover/:active/:focus*) in every
 *     accessible stylesheet via CSSOM, so the state styles never match at all.
 *     Pre-freeze selectors are exposed to other CSSOM consumers via the
 *     getFrozenOriginal registry (the forced-:hover pin builds from them).
 *  3. Pause pure-WAAPI animations (element.animate). CSS-originated animations
 *     are deliberately SKIPPED: calling WAAPI pause()/play() on a CSSAnimation
 *     permanently overrides `animation-play-state`, which would make the
 *     stylesheet unable to ever pause them again.
 *  4. Pause playing <video> elements and SMIL (svg.pauseAnimations) — both are
 *     invisible to CSS and getAnimations().
 *  5. A ~500ms sweep catches anything that starts AFTER the toggle: new WAAPI
 *     animations, new/grown stylesheets (Vite HMR swaps style tags;
 *     styled-components insertRule()s into one existing sheet), autoplaying
 *     videos, newly mounted SVGs.
 *
 * Muse's own chrome stays live: its CSS lives in the shadow root (not in
 * document.styleSheets), and the API paths filter on [data-muse-ui] through
 * shadow boundaries.
 *
 * Known limitations (accepted): rAF-driven JS loops (patching
 * requestAnimationFrame would freeze the host React tree and Muse itself),
 * GIFs/APNGs, cross-origin stylesheets (cssRules access throws), styles inside
 * the host page's own shadow roots, and JS smooth scroll with an explicit
 * `behavior: 'smooth'` argument.
 */

import { walkCssRules } from './cssom'

// Interactive-state pseudo-classes neutered while frozen. :focus* is included
// deliberately: a canvas mousedown still focuses host elements (only click is
// preventDefault'd), and the UA-stylesheet focus ring isn't in CSSOM so
// keyboard users keep an indicator. Longest-first so :focus can't eat the
// prefix of :focus-visible/:focus-within; the lookbehind protects escaped
// idents like Tailwind's `.hover\:bg-x` (only the real trailing :hover matches).
export const FROZEN_PSEUDOS = /(?<!\\):(hover|active|focus-visible|focus-within|focus)(?![\w-])/g

// Selectors neutered by the ACTIVE freeze, keyed by rule — so other CSSOM
// consumers (the forced-:hover pin, see forcedState.ts) can read a rule's
// pre-freeze selector instead of the `:not(*)` placeholder. Populated by
// freezePage, entries deleted on restore; at most one freeze is live at a
// time (a toolbar toggle). A WeakMap so rules orphaned by an HMR sheet swap
// mid-freeze are GC'd instead of accumulating for the freeze's lifetime.
const frozenOriginals = new WeakMap<CSSStyleRule, string>()
export function getFrozenOriginal(rule: CSSStyleRule): string | undefined {
  return frozenOriginals.get(rule)
}

// Substitute the pseudo-class predicate with constant-false. `:not(*)` never
// matches, and because selector logic composes booleans the token swap is
// correct in every context — selector lists, :is()/:where() arms, :not()
// (`.a:not(:hover)` becomes always-match = "as if never hovered"), and CSS
// nesting (`&:hover`). No comma-splitting needed. Returns null when the
// selector has nothing to neuter.
export function neuterSelectorText(selector: string): string | null {
  const out = selector.replace(FROZEN_PSEUDOS, ':not(*)')
  return out === selector ? null : out
}

function isMuseElement(el: Element): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur.closest('[data-muse-ui]')) return true
    const root = cur.getRootNode()
    cur = root instanceof ShadowRoot ? root.host : null
  }
  return false
}

// CSS-originated animations are paused by the stylesheet; WAAPI-pausing them
// would permanently detach them from `animation-play-state` (see header).
function isCssOriginated(anim: Animation): boolean {
  return (
    (typeof CSSAnimation !== 'undefined' && anim instanceof CSSAnimation) ||
    (typeof CSSTransition !== 'undefined' && anim instanceof CSSTransition)
  )
}

/**
 * Freeze the host page. Returns the restore function (idempotent — React
 * StrictMode double-invokes effect cleanups in dev).
 */
export function freezePage(): () => void {
  // --- 1. The pause stylesheet -------------------------------------------
  const style = document.createElement('style')
  style.id = 'muse-animation-pause'
  style.textContent =
    ':not([data-muse-ui]):not([data-muse-ui] *)' +
    '{animation-play-state:paused!important;transition-duration:0s!important;' +
    'transition-delay:0s!important;scroll-behavior:auto!important;}'
  document.head.appendChild(style)

  // --- 2. Neuter interactive-state selectors -----------------------------
  const neutered: { rule: CSSStyleRule; original: string }[] = []
  // Last-seen TOP-LEVEL rule count per processed sheet (-1 = inaccessible,
  // don't retry). A count CHANGE triggers a full re-walk — not a tail walk,
  // because insertRule defaults to index 0 (front), so new rules can land
  // anywhere. Re-walking is idempotent: an already-neutered selector has no
  // frozen pseudo left, so neuterSelectorText returns null and it can't be
  // re-recorded with a wrong "original". An HMR-swapped style tag is a
  // brand-new CSSStyleSheet object and gets walked as unseen. Known blind
  // spot: insertions INSIDE an existing grouping rule (@media etc.) don't
  // change the top-level count and are missed until the sheet's count moves.
  const seenSheets = new WeakMap<CSSStyleSheet, number>()
  // @import'd sheets never appear in document.styleSheets — they're only
  // reachable through their CSSImportRule. Collected during walks so the
  // sweep re-checks them with the same count bookkeeping.
  const importedSheets = new Set<CSSStyleSheet>()

  // Traversal lives in cssom.ts (shared with the forced-:hover pin); only the
  // neuter action is ours. Behavior identical to the pre-extraction walk.
  const neuterRules = (rules: CSSRuleList) => {
    walkCssRules(
      rules,
      (rule) => {
        const next = neuterSelectorText(rule.selectorText)
        if (next !== null) {
          try {
            const original = rule.selectorText
            rule.selectorText = next
            neutered.push({ rule, original })
            frozenOriginals.set(rule, original)
          } catch {
            /* unparseable assignment — that one rule stays live */
          }
        }
      },
      (sheet) => importedSheets.add(sheet),
    )
  }

  const sweepSheets = () => {
    // Walks can discover new @import'd sheets; loop until the set is stable so
    // a freshly-found import chain is neutered in this pass, not next tick.
    // Terminates: importedSheets only grows and is bounded by the page's sheets.
    let known = -1
    while (known !== importedSheets.size) {
      known = importedSheets.size
      const sheets = [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? []), ...importedSheets]
      for (const sheet of sheets) {
        if (!(sheet instanceof CSSStyleSheet)) continue
        const lastCount = seenSheets.get(sheet)
        if (lastCount === -1) continue // cross-origin — don't retry every tick
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          seenSheets.set(sheet, -1)
          continue
        }
        if (rules.length !== lastCount) neuterRules(rules)
        seenSheets.set(sheet, rules.length)
      }
    }
  }

  // --- 3/4. API-paused players --------------------------------------------
  const pausedAnims = new Set<Animation>()
  const pausedVideos = new Set<HTMLVideoElement>()
  const pausedSvgs = new Set<SVGSVGElement>()

  const sweepPlayers = () => {
    for (const anim of document.getAnimations()) {
      if (pausedAnims.has(anim) || isCssOriginated(anim) || anim.playState !== 'running') continue
      const target = anim.effect instanceof KeyframeEffect ? anim.effect.target : null
      if (target && isMuseElement(target)) continue
      try {
        anim.pause()
        pausedAnims.add(anim)
      } catch {
        /* unpausable (e.g. scroll-timeline quirk) — leave it */
      }
    }
    // querySelectorAll never reaches into shadow roots, so Muse's own chrome is
    // unreachable here; the isMuseElement guard covers the light-DOM
    // [data-muse-canvas-host] gallery frames (excluded today by the CSS rule).
    for (const video of Array.from(document.querySelectorAll('video'))) {
      if (video.paused || video.ended || pausedVideos.has(video) || isMuseElement(video)) continue
      try {
        video.pause()
        pausedVideos.add(video)
      } catch {
        /* leave it */
      }
    }
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (pausedSvgs.has(svg) || typeof svg.pauseAnimations !== 'function' || isMuseElement(svg)) continue
      try {
        if (!svg.animationsPaused()) {
          svg.pauseAnimations()
          pausedSvgs.add(svg)
        }
      } catch {
        /* leave it */
      }
    }
  }

  sweepSheets()
  sweepPlayers()
  const sweepTimer = window.setInterval(() => {
    sweepSheets()
    sweepPlayers()
  }, 500)

  // --- Restore -------------------------------------------------------------
  let restored = false
  return () => {
    if (restored) return
    restored = true
    window.clearInterval(sweepTimer)
    for (const { rule, original } of neutered) {
      try {
        rule.selectorText = original
      } catch {
        /* sheet was HMR-replaced — nothing to restore */
      }
      frozenOriginals.delete(rule)
    }
    for (const anim of pausedAnims) {
      // Only resume what's still in OUR paused state — play() on a finished or
      // cancelled animation would restart it from zero. Accepted ambiguity (for
      // these and the videos below): if host code ALSO paused one of these
      // while frozen, that's indistinguishable from our pause and it resumes.
      if (anim.playState === 'paused') {
        try {
          anim.play()
        } catch {
          /* leave it */
        }
      }
    }
    for (const video of pausedVideos) {
      if (video.isConnected && video.paused) void video.play().catch(() => {})
    }
    for (const svg of pausedSvgs) {
      if (svg.isConnected) {
        try {
          svg.unpauseAnimations()
        } catch {
          /* leave it */
        }
      }
    }
    // The pause stylesheet goes LAST so nothing transitions/animates while the
    // hover rules and players come back.
    style.remove()
  }
}
