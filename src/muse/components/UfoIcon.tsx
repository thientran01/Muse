import { useEffect, useRef } from 'react'

const EYE = 'rgb(var(--muse-surface, 20 18 16))'

/**
 * Per-state motion profiles for the manta mark. This loop is a DELIBERATE
 * exception to the EASE/DUR token system in tailwind.config.js: a swimming gait
 * is continuous and periodic, not the one-shot enter/exit a cubic-bezier
 * describes — so it lives here as a requestAnimationFrame loop instead.
 *
 * The gait is a LATERAL TRAVELLING WAVE, not a vertical bob (an up/down bob read
 * as "bouncing", not "swimming"). The body yaws about the head while the tail
 * flicks the OPPOSITE way on a slight phase lag — head bends one direction, tail
 * the other, so the silhouette traces an S that travels front→back, the way a
 * ray actually undulates. The wings add a subtle flap for life; a slow heading
 * drift keeps the loop from looking mechanically repeated.
 *
 * - swim: thinking / in-flight. A clear, propelling S-undulation. Runs for as
 *   long as `loading` holds (settleMs = Infinity — it's a progress signal).
 * - idle: at rest. A few slow, shallow undulations that DECAY to stillness over
 *   settleMs, then the loop stops entirely (zero steady-state cost). Kept tiny:
 *   Muse is a quiet side tool whose FAB sits in the host app's corner — it
 *   should glide to rest, not undulate forever in peripheral vision.
 */
const PROFILE = {
  swim: {
    period: 1700, // ms per undulation cycle
    yawAmp: 6, // deg the body swings about the head
    tailAmp: 14, // deg the tail counter-flicks (> 2×yaw so the net tail is anti-phase → S)
    tailLag: 0.4, // rad the tail lags the body (the wave travelling back)
    swayAmp: 0.55, // px lateral glide of the whole body
    swayLag: 0.35, // rad the sway lags the yaw
    spanAmp: 0.08, // subtle wing flap (wingspan draws in at each extreme)
    heightAmp: 0.02, // tiny lengthen as the span narrows (volume)
    driftPeriod: 5200, // ms — slow heading drift, non-harmonic with the undulation
    driftAmp: 2.5, // deg of that drift
    settleMs: Infinity, // never settles — runs while loading
  },
  idle: {
    period: 3200,
    yawAmp: 2.2,
    tailAmp: 5,
    tailLag: 0.45,
    swayAmp: 0.22,
    swayLag: 0.35,
    spanAmp: 0.03,
    heightAmp: 0.012,
    driftPeriod: 6000,
    driftAmp: 1,
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
  const tailRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const wings = wingsRef.current
    const tail = tailRef.current
    if (!root || !wings || !tail) return

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
      tail.removeAttribute('transform')
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

        // The S-wave. The body yaws about the head; the tail flicks the opposite
        // way on a lag, so at any instant head and tail point apart → an S that
        // travels front-to-back. A slow drift keeps the heading from looping.
        const headYaw = p.yawAmp * Math.sin(f) * env
        const drift = p.driftAmp * Math.sin((2 * Math.PI * t) / p.driftPeriod) * env
        const sway = p.swayAmp * Math.sin(f - p.swayLag) * env
        const tailYaw = -p.tailAmp * Math.sin(f - p.tailLag) * env

        // Root: lateral glide + body yaw about the head (12, 8). No vertical bob —
        // that's what read as "bouncing"; the swim is side-to-side undulation.
        root.setAttribute(
          'transform',
          `translate(${sway.toFixed(3)} 0) rotate(${(headYaw + drift).toFixed(3)} 12 8)`,
        )
        wings.setAttribute(
          'transform',
          `translate(12 10) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-12 -10)`,
        )
        // Tail rotates about a pivot INSIDE the body lobe (12, 13.7), so its root
        // stays covered and the whip never detaches; it inherits the body yaw, so
        // its net angle is headYaw + tailYaw (anti-phase → the back half of the S).
        tail.setAttribute('transform', `rotate(${tailYaw.toFixed(3)} 12 13.7)`)

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
            the joins; the tail then flicks on its own counter-phase. */}
        <g ref={wingsRef}>
          {/* tail — drawn first, root tucked high (y≈13.2) so the body's rounded
              rear lobe fully overlaps it; whips on its own lagging phase */}
          <path
            ref={tailRef}
            d="M11.55 13.2 C11.5 15 11.75 17 12 18.8 C12.25 17 12.5 15 12.45 13.2 C12.2 13.05 11.8 13.05 11.55 13.2 Z"
            fill="currentColor"
          />

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
