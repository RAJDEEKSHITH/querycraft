import { useId, useState, type FormEvent } from 'react'
import { ArrowUpIcon } from '../../components/icons'
import type { ClarificationRequest } from '../../types/api'
import { QUESTION_MAX_LENGTH } from './suggestions'

interface ClarificationCardProps {
  request: ClarificationRequest
  disabled: boolean
  onAnswer: (answer: string) => void
}

/** The assistant's turn: a question back, with option buttons and a free-text answer. */
export function ClarificationCard({ request, disabled, onAnswer }: ClarificationCardProps) {
  const id = useId()
  const [text, setText] = useState('')
  const valid = text.trim() !== '' && text.length <= QUESTION_MAX_LENGTH

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (valid && !disabled) onAnswer(text.trim())
  }

  return (
    <section
      aria-label="Clarification needed"
      className="qc-fade-in space-y-3 rounded-xl border border-amber-300/80 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.06]"
    >
      <p className="text-base leading-relaxed font-medium text-zinc-900 dark:text-zinc-100">{request.question}</p>
      {request.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {request.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(option)}
              className="rounded-full border border-amber-300 bg-white px-3.5 py-1.5 text-left text-sm text-zinc-800 hover:border-amber-400 hover:bg-amber-50 qc-focus disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/40 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-amber-500/10"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="relative">
        <label htmlFor={id} className="sr-only">
          Or answer in your own words
        </label>
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={QUESTION_MAX_LENGTH}
          placeholder="Or answer in your own words"
          className="block w-full rounded-md border border-zinc-300 bg-white py-2 pr-11 pl-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          aria-label="Send answer"
          disabled={disabled || !valid}
          className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 qc-focus disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          <ArrowUpIcon className="size-4" />
        </button>
      </form>
    </section>
  )
}
