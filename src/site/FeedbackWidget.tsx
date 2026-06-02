import { useEffect, useRef, useState } from 'react'
import { feedbackConfigured, submitFeedback } from './feedback'

// A floating feedback widget for demo testers. Sits bottom-LEFT to stay clear of
// Muse's own FAB (bottom-right). The root carries `data-muse-ui` so Canvas Mode
// treats it as chrome and never tries to select/edit it (the widget styles itself
// with plain Tailwind, so the Muse token scope doesn't change its look).
type Status = 'idle' | 'sending' | 'sent' | 'error'

export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Close, reset the transient state (so a stale error/success never greets the
  // next open), and restore focus to the trigger for keyboard users.
  function close() {
    setOpen(false)
    setStatus('idle')
    setError('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!feedbackConfigured) return null

  async function send() {
    if (!message.trim() || status === 'sending') return
    setStatus('sending')
    setError('')
    try {
      await submitFeedback({ message: message.trim(), name: name.trim() })
      setStatus('sent')
      setMessage('')
      setName('')
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
    }
  }

  return (
    <div data-muse-ui className="fixed bottom-5 left-5 z-[9998] font-sans">
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fb-title"
          className="w-[min(320px,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl ring-1 ring-black/5"
        >
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <h2 id="fb-title" className="text-sm font-semibold text-zinc-900">
              Send feedback
            </h2>
            <button
              onClick={close}
              aria-label="Close feedback"
              className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {status === 'sent' ? (
            <div role="status" className="px-4 py-6 text-center">
              <div className="text-2xl">✓</div>
              <p className="mt-2 text-sm text-zinc-700">Thanks — got it.</p>
              <button
                onClick={() => setStatus('idle')}
                className="mt-3 rounded-md px-2.5 py-1 text-[13px] font-medium text-[#7f2f2f] hover:bg-[#7f2f2f]/[0.06]"
              >
                Send another
              </button>
            </div>
          ) : (
            <div className="px-4 py-3.5">
              <label htmlFor="fb-message" className="sr-only">
                Your feedback
              </label>
              <textarea
                id="fb-message"
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="What worked, what felt off, what you'd want…"
                className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-[14px] text-zinc-800 outline-none transition-colors placeholder:text-zinc-500 focus:border-[#7f2f2f]/50 focus:ring-2 focus:ring-[#7f2f2f]/10"
              />
              <label htmlFor="fb-name" className="sr-only">
                Your name (optional)
              </label>
              <input
                id="fb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (optional)"
                className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-[14px] text-zinc-800 outline-none transition-colors placeholder:text-zinc-500 focus:border-[#7f2f2f]/50 focus:ring-2 focus:ring-[#7f2f2f]/10"
              />
              {status === 'error' && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}
              <button
                onClick={send}
                disabled={!message.trim() || status === 'sending'}
                aria-busy={status === 'sending'}
                className="mt-3 w-full rounded-lg bg-[#7f2f2f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6a2727] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          ref={triggerRef}
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-lg ring-1 ring-black/5 transition-colors hover:bg-zinc-50"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-[#7f2f2f]" fill="currentColor" aria-hidden>
            <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 3v-3H3a1 1 0 01-1-1V3z" />
          </svg>
          Feedback
        </button>
      )}
    </div>
  )
}
