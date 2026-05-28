// Tag-aware starter prompts under an observation. Clicking one sends it as the
// user's first message (visible — it lands as a user bubble, not a silent call).
export function MessageStarterChips({
  chips,
  onPick,
  disabled = false,
}: {
  chips: string[]
  onPick: (text: string) => void
  disabled?: boolean
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => onPick(chip)}
          className="rounded-full border border-line/15 bg-line/[0.03] px-3 py-1 text-xs text-fg-muted transition hover:border-line/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {chip}
        </button>
      ))}
    </div>
  )
}
