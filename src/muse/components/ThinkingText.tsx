import { useEffect, useState } from 'react'

const PHRASES = [
  'Thinking',
  'Tinkering',
  'Analyzing',
  'Editing',
  'Crafting',
  'Tweaking',
  'Brainstorming',
  'Figuring it out',
  'Cooking things up',
  'Redesigning',
  'Changing',
  'Planning',
]

export function ThinkingText({ className = '' }: { className?: string }) {
  const [idx, setIdx] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true)
      setTimeout(() => {
        setIdx((i) => (i + 1) % PHRASES.length)
        setFading(false)
      }, 200) // keep in sync with the duration-200 cross-fade below
    }, 2200)
    return () => clearInterval(id)
  }, [])

  return (
    <span
      className={`transition-opacity duration-200 ${fading ? 'opacity-0' : 'opacity-100'} ${className}`}
    >
      {PHRASES[idx]}…
    </span>
  )
}
