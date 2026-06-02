// Submits demo feedback to a Supabase table via the REST API (no SDK dependency).
// The muse_feedback table is insert-only for the anon role (RLS), so the
// publishable key shipped in the bundle can write feedback but never read it.
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const feedbackConfigured = Boolean(URL && KEY)

export type FeedbackInput = { message: string; name?: string; context?: string }

export async function submitFeedback(input: FeedbackInput): Promise<void> {
  if (!URL || !KEY) throw new Error('Feedback isn’t configured for this build.')
  const res = await fetch(`${URL}/rest/v1/muse_feedback`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      message: input.message.slice(0, 5000),
      name: input.name?.slice(0, 120) || null,
      context: input.context?.slice(0, 1000) || null,
      page: window.location.hash.replace(/^#\/?/, '') || 'overview',
      user_agent: navigator.userAgent.slice(0, 600),
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Couldn’t send feedback (${res.status}). ${detail}`.trim())
  }
}
