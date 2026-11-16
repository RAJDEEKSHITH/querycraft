import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import type { ClarificationRequest } from '../../types/api'
import { QUESTION_MAX_LENGTH } from './suggestions'

interface ClarificationCardProps {
  request: ClarificationRequest
  disabled: boolean
  onAnswer: (answer: string) => void
}

export function ClarificationCard({ request, disabled, onAnswer }: ClarificationCardProps) {
  const id = useId()
  const [text, setText] = useState('')
  const valid = text.trim() !== '' && text.length <= QUESTION_MAX_LENGTH

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (valid && !disabled) onAnswer(text.trim())
  }

  return (
    <section aria-label="Clarification needed" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">The agent needs a clarification</h3>
      <p className="text-sm text-zinc-800 dark:text-zinc-200">{request.question}</p>
      {request.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {request.options.map((option) => (
            <Button key={option} disabled={disabled} onClick={() => onAnswer(option)}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor={id} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Or answer in your own words
          </label>
          <input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={QUESTION_MAX_LENGTH}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <Button type="submit" variant="primary" disabled={disabled || !valid}>
          Send answer
        </Button>
      </form>
    </section>
  )
}
