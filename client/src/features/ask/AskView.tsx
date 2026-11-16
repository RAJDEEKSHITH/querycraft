import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ErrorMessage } from '../../components/States'
import { activeTurn } from '../../stores/ask-reducer'
import { useAskStore } from '../../stores/askStore'
import { QuestionInput } from './QuestionInput'
import { SUGGESTED_QUESTIONS } from './suggestions'
import { TurnCard } from './TurnCard'

export function AskView() {
  const turns = useAskStore((s) => s.turns)
  const conversationId = useAskStore((s) => s.conversationId)
  const busy = useAskStore((s) => s.busy)
  const actionError = useAskStore((s) => s.actionError)
  const ask = useAskStore((s) => s.ask)
  const newConversation = useAskStore((s) => s.newConversation)
  const dismissError = useAskStore((s) => s.dismissError)
  const waiting = useAskStore((s) => activeTurn(s) !== null)
  const [preset, setPreset] = useState<{ text: string; key: number } | undefined>(undefined)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [turns.length])

  const followUp = turns.length > 0

  return (
    <div className="space-y-6">
      {!followUp && (
        <section aria-labelledby="suggestions" className="space-y-2">
          <h2 id="suggestions" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Try one of these
          </h2>
          <ul className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q}>
                <Button className="text-left" onClick={() => setPreset({ text: q, key: Date.now() })}>
                  {q}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {turns.map((turn) => (
        <TurnCard key={turn.questionId} turn={turn} />
      ))}

      {actionError !== null && <ErrorMessage message={actionError} onDismiss={dismissError} />}

      <div ref={bottom} className="space-y-2">
        <QuestionInput
          label={followUp ? 'Ask a follow-up question' : 'Ask a question about the AdventureWorks database'}
          placeholder={followUp ? 'For example: and the year before?' : 'For example: how many customers do we have?'}
          submitLabel={followUp ? 'Ask follow-up' : 'Ask'}
          disabled={busy || waiting}
          onSubmit={(text) => void ask(text)}
          {...(preset === undefined ? {} : { preset })}
        />
        {waiting && <p className="text-xs text-zinc-500 dark:text-zinc-400">Finish the current question before asking another.</p>}
        {followUp && (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Conversation <span className="font-mono">{conversationId?.slice(0, 8)}</span> keeps the last 3 answered questions as context.
            </span>
            <Button variant="ghost" className="text-xs" onClick={newConversation}>
              New conversation
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
