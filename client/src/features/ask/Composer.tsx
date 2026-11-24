import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '../../components/Button'
import { ArrowUpIcon, StopIcon } from '../../components/icons'
import { activeTurn } from '../../stores/ask-reducer'
import { useAskStore } from '../../stores/askStore'
import { QUESTION_MAX_LENGTH, SALES_DATA_HINT } from './suggestions'

// Composer (IMPLEMENTATION.md 15): auto-growing textarea, Enter sends, Shift+Enter adds a
// line, a counter near the limit, "Stop waiting" (client only) while a question runs.

const MAX_HEIGHT_PX = 200
const COUNTER_FROM = QUESTION_MAX_LENGTH - 100

export function Composer() {
  const ask = useAskStore((s) => s.ask)
  const busy = useAskStore((s) => s.busy)
  const loading = useAskStore((s) => s.loading)
  const conversationId = useAskStore((s) => s.conversationId)
  const followUp = useAskStore((s) => s.turns.length > 0)
  const active = useAskStore((s) => activeTurn(s))
  const stopWaiting = useAskStore((s) => s.stopWaiting)
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  const waitingForUser = active !== null && (active.status === 'awaiting_clarification' || active.status === 'awaiting_approval')
  const running = active !== null && active.streaming && !waitingForUser
  const disabled = busy || active !== null || loading !== null
  const tooLong = text.length > QUESTION_MAX_LENGTH
  const empty = text.trim() === ''

  // Grow with the text up to a limit, then scroll inside.
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [text])

  // Focus on a new conversation and when the box becomes usable again (not on touch screens,
  // where focusing opens the keyboard).
  useEffect(() => {
    if (disabled || !window.matchMedia('(pointer: fine)').matches) return
    box.current?.focus()
  }, [disabled, conversationId])

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    if (disabled || empty || tooLong) return
    const question = text.trim()
    setText('')
    await ask(question)
    // Keep what the user typed when the question could not be sent.
    if (useAskStore.getState().actionError !== null) setText(question)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="shrink-0 px-4 pt-2 pb-3 sm:pb-4">
      <form onSubmit={(e) => void submit(e)} className="mx-auto w-full max-w-[760px]">
        {(running || waitingForUser) && (
          <div role="status" className="mb-2 flex items-center justify-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            {running ? (
              <>
                <span>Working on your question…</span>
                <Button size="sm" onClick={() => stopWaiting(active.questionId)}>
                  <StopIcon className="size-3.5" />
                  Stop waiting
                </Button>
              </>
            ) : (
              <span>Answer the question above to continue.</span>
            )}
          </div>
        )}
        <div className="relative rounded-xl border border-zinc-300 bg-white shadow-sm transition-colors focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
          <label htmlFor="composer" className="sr-only">
            {followUp ? 'Ask a follow-up question' : 'Ask a question about the AdventureWorks database'}
          </label>
          <textarea
            ref={box}
            id="composer"
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={followUp ? 'Ask a follow-up…' : 'Ask a question about the AdventureWorks database…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby="composer-hint"
            aria-invalid={tooLong}
            className="block max-h-[200px] w-full resize-none bg-transparent py-3.5 pr-14 pl-4 text-base leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            type="submit"
            aria-label="Send question"
            disabled={disabled || empty || tooLong}
            className="qc-focus absolute right-2.5 bottom-2.5 inline-flex size-9 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            <ArrowUpIcon />
          </button>
        </div>
        <div id="composer-hint" className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Read-only. Every query is checked and audited. {SALES_DATA_HINT}</span>
          {text.length >= COUNTER_FROM && (
            <span className={`tabular-nums ${tooLong ? 'font-medium text-red-600 dark:text-red-400' : ''}`}>
              {text.length} / {QUESTION_MAX_LENGTH}
              {tooLong ? ' (too long)' : ''}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
