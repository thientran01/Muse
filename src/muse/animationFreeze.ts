/**
 * Full-page freeze for the toolbar's "Pause animations" toggle.
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

// Interactive-state pseudo-classes neutered while frozen. :focus* is included
// deliberately: a canvas mousedown still focuses host elements (only click is
// preventDefault'd), and the UA-stylesheet focus ring isn't in CSSOM so
// keyboard users keep an indicator. Longest-first so :focus can't eat the
// prefix of :focus-visible/:focus-within; the lookbehind protects escaped
// idents like Tailwind's `.hover\:bg-x` (only the real trailing :hover matches).
export const FROZEN_PSEUDOS = /(?<!\\):(hover|active|focus-visible|focus-within|focus)(?![\w-])/g

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
  // don't retry). insertRule appends at the top level, so the sweep only walks
  // the appended tail of a grown sheet; an HMR-swapped style tag is a brand-new
  // CSSStyleSheet object and gets a full walk.
  const seenSheets = new WeakMap<CSSStyleSheet, number>()

  const neuterRules = (rules: CSSRuleList, from = 0) => {
    for (let i = from; i < rules.length; i++) {
      const rule = rules[i]
      if (rule instanceof CSSStyleRule) {
        const next = neuterSelectorText(rule.selectorText)
        if (next !== null) {
          try {
            const original = rule.selectorText
            rule.selectorText = next
            neutered.push({ rule, original })
          } catch {
            /* unparseable assignment — that one rule stays live */
          }
        }
      }
      // @import'd sheets never appear in document.styleSheets — they're only
      // reachable through the import rule itself.
      if (rule instanceof CSSImportRule && rule.styleSheet) {
        try {
          neuterRules(rule.styleSheet.cssRules)
        } catch {
          /* cross-origin import — its rules stay live */
        }
      }
      // Generic recursion: grouping rules (media/supports/layer/container/
      // scope) and CSS-nesting children of style rules all expose cssRules.
      const children = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined
      if (children && children.length) neuterRules(children)
    }
  }

  const sweepSheets = () => {
    const sheets = [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])]
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
      const from = lastCount ?? 0
      if (rules.length > from) neuterRules(rules, from)
      seenSheets.set(sheet, rules.length)
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
    }
    for (const anim of pausedAnims) {
      // Only resume what's still in OUR paused state — play() on a finished or
      // cancelled animation would restart it from zero.
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
