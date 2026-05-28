import { useEffect, useRef } from 'react'

// Muse's mark — a manta-ray glider (body is `currentColor`, eyes are punched in
// the surface color so they read as cut-outs on any theme). When `loading`, it
// gently banks and bobs like it's swimming; idle it sits still.
const EYE = 'rgb(var(--muse-surface, 20 18 16))'

export function UfoIcon({
  size = 18,
  loading = false,
  className = '',
}: {
  size?: number
  loading?: boolean
  className?: string
}) {
  const gRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const g = gRef.current
    if (!g) return
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!loading || reduceMotion) {
      g.removeAttribute('transform')
      return
    }

    let raf = 0
    const start = performance.now()
    const period = 2200 // ms per glide cycle — calm, not frantic
    const tick = (now: number) => {
      const a = (2 * Math.PI * ((now - start) % period)) / period
      const bank = Math.sin(a) * 13 // weave left/right
      const bob = Math.cos(a) * 0.7 // rise/fall, a quarter-cycle out of phase
      g.setAttribute('transform', `rotate(${bank.toFixed(2)} 12 11) translate(0 ${bob.toFixed(2)})`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loading])

  return (
    // viewBox is tightened to the ray's bounds (content lives in x[5,19] y[3.5,18.8])
    // with a hair of margin, so the mark fills its box instead of floating in
    // padding. overflow-visible lets the banking animation spill without clipping.
    <svg
      width={size}
      height={size}
      viewBox="4 3 16 16"
      fill="none"
      overflow="visible"
      aria-hidden
      className={className}
    >
      <g ref={gRef}>
        {/* cephalic horns — bases run under the body so the body fill hides the join */}
        <path d="M9.9 6.6 C9.5 4.8 9.4 3.8 9.9 3.5 C10.4 3.8 10.8 4.9 11.1 6.6 Z" fill="currentColor" />
        <path d="M14.1 6.6 C14.5 4.8 14.6 3.8 14.1 3.5 C13.6 3.8 13.2 4.9 12.9 6.6 Z" fill="currentColor" />
        {/* body — swept wings with concave trailing edges + short tail */}
        <path
          d="M12 6 C14.8 5.8 17 6.7 19 9 C19.8 9.9 19.5 10.8 18.4 10.8 C16 10.8 14.5 10.5 13.5 11.9 C12.8 12.9 12.5 14.5 12.3 16.4 L12 18.8 L11.7 16.4 C11.5 14.5 11.2 12.9 10.5 11.9 C9.5 10.5 8 10.8 5.6 10.8 C4.5 10.8 4.2 9.9 5 9 C7 6.7 9.2 5.8 12 6 Z"
          fill="currentColor"
        />
        <circle cx="9.9" cy="8.5" r="0.85" fill={EYE} />
        <circle cx="14.1" cy="8.5" r="0.85" fill={EYE} />
      </g>
    </svg>
  )
}
