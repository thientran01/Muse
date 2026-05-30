import { useEffect, useRef } from 'react'

const EYE = 'rgb(var(--muse-surface, 20 18 16))'

/**
 * Per-state motion profiles. The icon is a top-down manta ray, so "swimming"
 * reads as: wings flapping (wingspan draws IN about the spine at each stroke
 * extreme, widest mid-stroke), a thrust→glide surge once per stroke, a slow
 * banking weave, and a tail that trails the turn with a lagging whip.
 *
 * - swim: thinking / in-flight. Purposeful, alive, clearly propelling forward.
 * - idle: at rest. A whisper-quiet hover-breath so the icon feels living, not
 *   frozen — kept tiny on purpose (Muse is a quiet side tool, must not pull focus).
 */
const PROFILE = {
  swim: {
    flapPeriod: 1500, // ms per wingbeat
    spanAmp: 0.15, // wingtips draw in by 15% at each stroke extreme
    heightAmp: 0.06, // slight lengthen as the span narrows (volume)
    thrustAmp: 1.0, // px forward surge on the power stroke
    bobAmp: 0.45, // px gentle rise/fall across the beat
    bankPeriod: 3700, // ms — non-harmonic with the flap so it feels organic
    bankAmp: 6, // deg roll as it banks through a turn
    tailAmp: 12, // deg trailing whip
    tailLag: 0.7, // rad the tail lags behind the body's turn
    tailFlap: 4, // deg follow-through coupled to the wingbeat
  },
  idle: {
    flapPeriod: 3400,
    spanAmp: 0.05,
    heightAmp: 0.025,
    thrustAmp: 0,
    bobAmp: 0.35,
    bankPeriod: 5400,
    bankAmp: 2.5,
    tailAmp: 4,
    tailLag: 0.8,
    tailFlap: 1.5,
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

    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      root.removeAttribute('transform')
      wings.removeAttribute('transform')
      tail.removeAttribute('transform')
      return
    }

    const p = loading ? PROFILE.swim : PROFILE.idle
    let raf = 0
    const start = performance.now()

    const tick = (now: number) => {
      const t = now - start
      const f = (2 * Math.PI * t) / p.flapPeriod
      const bf = (2 * Math.PI * t) / p.bankPeriod

      const flap = Math.sin(f) // -1..1, wing vertical position over the beat
      const flap2 = flap * flap // 0..1, peaks at each stroke extreme

      // Wings: span narrows about the spine at each extreme, widest mid-stroke.
      const sx = 1 - p.spanAmp * flap2
      const sy = 1 + p.heightAmp * flap2

      // Body: a forward surge once per beat (the power stroke) layered on a soft bob.
      const surge = -p.thrustAmp * (0.5 - 0.5 * Math.cos(f))
      const bob = p.bobAmp * Math.cos(f)
      const ty = bob + surge

      // Banking weave + a tail that lags the turn and follows through on the beat.
      const bank = p.bankAmp * Math.sin(bf)
      const tailAngle = -p.tailAmp * Math.sin(bf - p.tailLag) + p.tailFlap * Math.sin(f - 0.9)

      root.setAttribute('transform', `translate(0 ${ty.toFixed(3)}) rotate(${bank.toFixed(3)} 12 11)`)
      wings.setAttribute(
        'transform',
        `translate(12 10) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-12 -10)`,
      )
      tail.setAttribute('transform', `rotate(${tailAngle.toFixed(3)} 12 13.9)`)

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
        {/* tail — its own element so it can whip and trail the body's turn */}
        <path
          ref={tailRef}
          d="M11.55 13.9 C11.45 15.3 11.7 17 12 18.8 C12.3 17 12.55 15.3 12.45 13.9 C12.2 13.75 11.8 13.75 11.55 13.9 Z"
          fill="currentColor"
        />

        {/* wings + head — flap about the spine (x=12); horns and eyes ride with them */}
        <g ref={wingsRef}>
          {/* cephalic horns — bases run under the body so the body fill hides the join */}
          <path d="M9.9 6.6 C9.5 4.8 9.4 3.8 9.9 3.5 C10.4 3.8 10.8 4.9 11.1 6.6 Z" fill="currentColor" />
          <path d="M14.1 6.6 C14.5 4.8 14.6 3.8 14.1 3.5 C13.6 3.8 13.2 4.9 12.9 6.6 Z" fill="currentColor" />

          {/* body — swept wings with concave trailing edges, rounded rear where the tail joins */}
          <path
            d="M12 6 C14.8 5.8 17 6.7 19 9 C19.8 9.9 19.5 10.8 18.4 10.8 C16 10.8 14.5 10.5 13.5 11.9 C12.9 13.0 12.4 13.5 12 13.9 C11.6 13.5 11.1 13.0 10.5 11.9 C9.5 10.5 8 10.8 5.6 10.8 C4.5 10.8 4.2 9.9 5 9 C7 6.7 9.2 5.8 12 6 Z"
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
