import { useEffect, useRef } from 'react'
import type { ProposedOption, SelectedElement, ThreadMessage } from '../types'
import type { Pending } from '../store'
import { MessageApplied } from './messages/MessageApplied'
import { MessageClarify } from './messages/MessageClarify'
import { MessageDesign } from './messages/MessageDesign'
import { MessageHistory } from './messages/MessageHistory'
import { MessageObservation } from './messages/MessageObservation'
import { MessageOptionSet } from './messages/MessageOptionSet'
import { MessageTargetHandoff } from './messages/MessageTargetHandoff'
import { MessageThinking } from './messages/MessageThinking'
import { MessageUser } from './messages/MessageUser'

export function MuseThread({
  thread,
  pending,
  originals,
  loading,
  // clarify handlers
  answers,
  onSelectAnswer,
  onContinue,
  allAnswered,
  // option-set handlers
  onApprove,
  onPreview,
  onPreviewEnd,
  // observation starter-chip handler
  onChipClick,
  // design-brief generate handler
  onGenerateDesign,
}: {
  thread: ThreadMessage[]
  pending: Pending | null
  originals: Record<string, string>
  loading: boolean
  answers: Record<number, string>
  onSelectAnswer: (qi: number, label: string) => void
  onContinue: () => void
  allAnswered: boolean
  onApprove: (option: ProposedOption) => void
  onPreview: (option: ProposedOption) => void
  onPreviewEnd: () => void
  onChipClick: (text: string, target: SelectedElement) => void
  onGenerateDesign: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom when new bubbles arrive or while Muse is
  // thinking (so the thinking bubble stays visible).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [thread.length, loading])

  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
      {thread.map((m) => {
        switch (m.kind) {
          case 'observation':
            return (
              <MessageObservation
                key={m.id}
                observation={m.observation}
                chips={m.chips}
                pending={m.pending}
                onPick={(text) => onChipClick(text, m.target)}
                chipsDisabled={loading}
              />
            )
          case 'user':
            return <MessageUser key={m.id} text={m.text} />
          case 'clarify':
            return (
              <MessageClarify
                key={m.id}
                questions={m.questions}
                answers={answers}
                onSelect={onSelectAnswer}
                onContinue={onContinue}
                loading={loading}
                allAnswered={allAnswered}
                active={pending?.kind === 'ask' && pending.toolUseId === m.toolUseId}
                answeredWith={m.answeredWith}
              />
            )
          case 'option-set': {
            const isActive = pending?.kind === 'propose' && pending.toolUseId === m.toolUseId
            return (
              <MessageOptionSet
                key={m.id}
                options={m.options}
                originals={originals}
                rationale={m.rationale}
                loading={loading}
                onApprove={onApprove}
                onPreview={onPreview}
                onPreviewEnd={onPreviewEnd}
                active={isActive}
              />
            )
          }
          case 'applied':
            return <MessageApplied key={m.id} fileCount={m.fileCount} rationale={m.rationale} />
          case 'target-handoff':
            return <MessageTargetHandoff key={m.id} target={m.target} />
          case 'history':
            return <MessageHistory key={m.id} action={m.action} label={m.label} />
          case 'design':
            return (
              <MessageDesign
                key={m.id}
                status={m.status}
                content={m.content}
                path={m.path}
                onGenerate={() => onGenerateDesign(m.id)}
              />
            )
          case 'error':
            return (
              <p key={m.id} className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/20">
                {m.text}
              </p>
            )
        }
      })}
      {loading && <MessageThinking />}
    </div>
  )
}
