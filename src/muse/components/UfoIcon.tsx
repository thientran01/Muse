import { useEffect, useRef } from 'react'

const EYE = 'rgb(var(--muse-surface, 20 18 16))'

/**
 * Per-state motion profiles for the manta mark. This loop is a DELIBERATE
 * exception to the EASE/DUR token system in tailwind.config.js: a swimming gait
 * is continuous and periodic, not the one-shot enter/exit a cubic-bezier
 * describes — so it lives here as a requestAnimationFrame loop instead.
 *
 * The gait is a LATERAL TRAVELLING WAVE, not a vertical bob (an up/down bob read
 * as "bouncing", not "swimming"). The structural key: a real S needs the tail to
 * curve one way and then BACK, which a single rigid tail can't do — two rigid
 * segments only ever make one bend (a C/J). So the tail is a 3-SEGMENT CHAIN
 * (root › mid › tip), each link rotating about its own joint a quarter-cycle
 * behind the one above it. At any instant the root bends one way while the tip
 * bends the other → an S that travels front-to-back, the way a ray undulates.
 * The body adds a gentle yaw about the nose so the head leads the wave; the wings
 * add a subtle flap for life; a slow drift keeps the loop from looking repeated.
 *
 * - swim: thinking / in-flight. A clear, propelling S-undulation. Runs for as
 *   long as `loading` holds (settleMs = Infinity — it's a progress signal).
 * - idle: at rest. A few slow, shallow undulations that DECAY to stillness over
 *   settleMs, then the loop stops entirely (zero steady-state cost). Kept tiny:
 *   Muse is a quiet side tool whose FAB sits in the host app's corner — it
 *   should glide to rest, not undulate forever in peripheral vision.
 */
// Per-link amplitude weights, root → tip. The free tip whips hardest (1.7×) so
// it crosses the centerline — that crossing is what turns a one-sided C/J into a
// real S. The wave carries the undulation; the body just banks underneath it.
const LINK = [0.55, 1.1, 1.7] as const

// The body yaw pivots LOW in the body (not at the nose): the same rotation then
// swings the head visibly while leaving the tail base nearly fixed, so the body
// reads as a deliberate bank rather than a faint left/right jitter — and it
// doesn't drag the tail wave to one side. There is NO lateral translate (a sway
// slides the whole mark side to side, which reads as bouncing); the motion is
// pure rotation.
const BODY_PIVOT_Y = 11.5

const PROFILE = {
  swim: {
    period: 1700, // ms per undulation cycle
    yawAmp: 3.5, // deg the body banks about BODY_PIVOT_Y
    tailAmp: 20, // deg base for the tail links (scaled per-link by LINK)
    tailLag: 0.5, // rad the tail root lags the body — the wave entering the tail
    segPhase: Math.PI / 2, // rad each link lags the previous — π/2 ⇒ root & tip bend OPPOSITE → S
    spanAmp: 0.08, // subtle wing flap (wingspan draws in at each extreme)
    heightAmp: 0.02, // tiny lengthen as the span narrows (volume)
    driftPeriod: 5200, // ms — slow heading drift, non-harmonic with the undulation
    driftAmp: 2, // deg of that drift
    settleMs: Infinity, // never settles — runs while loading
  },
  idle: {
    period: 3200,
    yawAmp: 1.2,
    tailAmp: 9,
    tailLag: 0.5,
    segPhase: Math.PI / 2,
    spanAmp: 0.03,
    heightAmp: 0.012,
    driftPeriod: 6000,
    driftAmp: 0.8,
    settleMs: 3200, // a few slow undulations, then decays to rest
  },
} as const

export function UfoIcon({
  size = 18,
  loading = false,
  className = '',
}: {
  size?: number
  loading?: boolean
  className?: string
}) {
  const rootRef = useRef<SVGGElement>(null)
  const wingsRef = useRef<SVGGElement>(null)
  // The tail's three links, root → tip. Nested in the DOM, so each rotates about
  // its joint relative to the link above it — that nesting IS the spine.
  const t1Ref = useRef<SVGGElement>(null)
  const t2Ref = useRef<SVGGElement>(null)
  const t3Ref = useRef<SVGGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const wings = wingsRef.current
    const t1 = t1Ref.current
    const t2 = t2Ref.current
    const t3 = t3Ref.current
    if (!root || !wings || !t1 || !t2 || !t3) return

    const mq =
      typeof window !== 'undefined'
        ? window.matchMedia?.('(prefers-reduced-motion: reduce)')
        : undefined

    let raf = 0
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    const rest = () => {
      root.removeAttribute('transform')
      wings.removeAttribute('transform')
      t1.removeAttribute('transform')
      t2.removeAttribute('transform')
      t3.removeAttribute('transform')
    }

    // (Re)start the loop from a fresh time origin. Re-invoked whenever the
    // reduced-motion preference or tab visibility changes, so the gait always
    // reflects the current environment (mirrors useHostTheme's mq subscription).
    const begin = () => {
      stop()
      if (mq?.matches || (typeof document !== 'undefined' && document.hidden)) {
        rest()
        return
      }

      const p = loading ? PROFILE.swim : PROFILE.idle
      const t0 = performance.now()

      const tick = (now: number) => {
        const t = now - t0

        // Idle eases its amplitude to zero, then the loop ends — the ray glides
        // to a stop instead of undulating forever. Swim's settleMs is Infinity,
        // so env stays 1 and it runs until `loading` flips.
        let env = 1
        if (Number.isFinite(p.settleMs)) {
          const e = Math.max(0, 1 - t / p.settleMs)
          env = e * e
          if (env <= 0.0001) {
            rest()
            raf = 0
            return
          }
        }

        const f = (2 * Math.PI * t) / p.period
        const flap2 = Math.sin(f) * Math.sin(f) // 0..1, peaks at each stroke extreme

        // Wings: span narrows about the spine at each extreme, widest mid-stroke.
        const sx = 1 - p.spanAmp * flap2 * env
        const sy = 1 + p.heightAmp * flap2 * env

        // Body: a bank about a low pivot (BODY_PIVOT_Y) so the head swings while
        // the tail base stays put. A slow drift keeps the heading from looping
        // mechanically. No vertical bob and no lateral slide — both read as
        // "bouncing"; the body's motion is pure rotation.
        const bodyYaw = p.yawAmp * Math.sin(f) * env
        const drift = p.driftAmp * Math.sin((2 * Math.PI * t) / p.driftPeriod) * env


        // The travelling wave. Each tail link bends about its joint a quarter
        // cycle behind the one above it (segPhase = π/2), so at the wave's peak
        // the root link bends one way (th1 > 0) while the tip link bends the
        // other (th3 < 0) — the tail is an S, not a stiff swinging line. The lag
        // grows down the chain, so the bend visibly travels front → back.
        const th1 = p.tailAmp * LINK[0] * Math.sin(f - p.tailLag) * env
        const th2 = p.tailAmp * LINK[1] * Math.sin(f - p.tailLag - p.segPhase) * env
        const th3 = p.tailAmp * LINK[2] * Math.sin(f - p.tailLag - 2 * p.segPhase) * env

        // The body banks about a low pivot — pure rotation, no translation.
        root.setAttribute(
          'transform',
          `rotate(${(bodyYaw + drift).toFixed(3)} 12 ${BODY_PIVOT_Y})`,
        )
        wings.setAttribute(
          'transform',
          `translate(12 10) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-12 -10)`,
        )
        // Each link rotates about its own joint (the top of that link), so the
        // links stay hinged together and the spine never separates.
        t1.setAttribute('transform', `rotate(${th1.toFixed(3)} 12 13.7)`)
        t2.setAttribute('transform', `rotate(${th2.toFixed(3)} 12 15.4)`)
        t3.setAttribute('transform', `rotate(${th3.toFixed(3)} 12 17.0)`)

        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    begin()

    const onChange = () => begin()
    mq?.addEventListener?.('change', onChange)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onChange)

    return () => {
      stop()
      mq?.removeEventListener?.('change', onChange)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onChange)
    }
  }, [loading])

  return (
    <svg
      width={size}
      height={size}
      viewBox="4 3 16 16"
      fill="none"
      overflow="visible"
      aria-hidden
      className={className}
    >
      <g ref={rootRef}>
        {/* The whole body undulates as one unit so the parts never separate at
            the joins; the tail chain then carries the S on its own phase. */}
        <g ref={wingsRef}>
          {/* tail — a 3-link chain, drawn first so the body's rounded rear lobe
              overlaps link 1's root. Each <g> nests inside the previous and
              rotates about that link's top joint, so the chain stays connected
              while curving into an S. Links overlap their joints so a bend never
              opens a gap. */}
          <g ref={t1Ref}>
            <path
              d="M11.55 13.2 C11.55 14 11.62 14.7 11.66 15.4 L12.34 15.4 C12.38 14.7 12.45 14 12.45 13.2 C12.2 13.05 11.8 13.05 11.55 13.2 Z"
              fill="currentColor"
            />
            <g ref={t2Ref}>
              <path
                d="M11.64 15.0 L12.36 15.0 C12.32 15.7 12.27 16.4 12.22 17.1 L11.78 17.1 C11.73 16.4 11.68 15.7 11.64 15.0 Z"
                fill="currentColor"
              />
              <g ref={t3Ref}>
                <path
                  d="M11.76 16.8 L12.24 16.8 C12.18 17.5 12.06 18.2 12 18.8 C11.94 18.2 11.82 17.5 11.76 16.8 Z"
                  fill="currentColor"
                />
              </g>
            </g>
          </g>

          {/* cephalic horns — bases run under the body so the body fill hides the join */}
          <path d="M9.9 6.6 C9.5 4.8 9.4 3.8 9.9 3.5 C10.4 3.8 10.8 4.9 11.1 6.6 Z" fill="currentColor" />
          <path d="M14.1 6.6 C14.5 4.8 14.6 3.8 14.1 3.5 C13.6 3.8 13.2 4.9 12.9 6.6 Z" fill="currentColor" />

          {/* body — swept wings with concave trailing edges; the rear closes into a
              rounded lobe (down to y≈14.1) that the tail emerges from, so the join
              reads as continuous instead of a gap behind a sharp point */}
          <path
            d="M12 6 C14.8 5.8 17 6.7 19 9 C19.8 9.9 19.5 10.8 18.4 10.8 C16 10.8 14.5 10.5 13.5 11.9 C12.9 13.0 12.6 14.1 12 14.1 C11.4 14.1 11.1 13.0 10.5 11.9 C9.5 10.5 8 10.8 5.6 10.8 C4.5 10.8 4.2 9.9 5 9 C7 6.7 9.2 5.8 12 6 Z"
            fill="currentColor"
          />

          {/* eyes — punched out as surface color so they read as cut-outs */}
          <circle cx="9.9" cy="8.5" r="0.85" fill={EYE} />
          <circle cx="14.1" cy="8.5" r="0.85" fill={EYE} />
        </g>
      </g>
    </svg>
  )
}
