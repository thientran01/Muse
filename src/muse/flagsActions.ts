// Thin action layer over the flag api wrappers that keeps the reactive store in sync.
// Capture (FlagComposer / refusal affordance) and the panel (slice 4) both go through
// here so `museStore.flags` always mirrors the backend after any mutation.
import { museAddFlag, museDeleteFlag, museListFlags, museResolveFlag } from './api'
import { museStore } from './store'
import type { Flag, FlagDraft } from './types'

/** Reload all flags into the reactive store. Best-effort — a transport error leaves
 *  the current list in place rather than blanking the panel. */
export async function refreshFlags(): Promise<void> {
  try {
    museStore.setState({ flags: await museListFlags() })
  } catch {
    /* keep the last-known list */
  }
}

export async function addFlag(draft: FlagDraft): Promise<Flag> {
  const flag = await museAddFlag(draft)
  await refreshFlags()
  return flag
}

export async function resolveFlag(id: string, note?: string): Promise<void> {
  await museResolveFlag(id, note)
  await refreshFlags()
}

export async function dismissFlag(id: string): Promise<void> {
  await museDeleteFlag(id)
  await refreshFlags()
}
