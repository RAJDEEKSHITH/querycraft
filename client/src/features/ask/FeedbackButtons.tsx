import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CheckIcon, ThumbDownIcon, ThumbUpIcon } from '../../components/icons'
import type { FeedbackRating } from '../../types/api'

const COMMENT_MAX = 1000

interface FeedbackButtonsProps {
  given: { rating: FeedbackRating; exampleCreated: boolean } | null
  disabled: boolean
  onSend: (rating: FeedbackRating, comment: string) => void
}

const iconButton =
  'inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'

/** Thumbs up / down under a finished answer; a rating can carry an optional comment. */
export function FeedbackButtons({ given, disabled, onSend }: FeedbackButtonsProps) {
  const id = useId()
  const [rating, setRating] = useState<FeedbackRating | null>(null)
  const [comment, setComment] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (rating !== null) input.current?.focus()
  }, [rating])

  if (given !== null) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        Thanks for the feedback ({given.rating === 'up' ? 'helpful' : 'not helpful'}).
        {given.exampleCreated ? ' The question and its SQL are now a pending example for the admin to review.' : ''}
      </p>
    )
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (rating !== null && !disabled) onSend(rating, comment)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Rate the answer as helpful"
          aria-pressed={rating === 'up'}
          disabled={disabled}
          onClick={() => setRating('up')}
          className={`${iconButton} ${rating === 'up' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : ''}`}
        >
          <ThumbUpIcon />
        </button>
        <button
          type="button"
          aria-label="Rate the answer as not helpful"
          aria-pressed={rating === 'down'}
          disabled={disabled}
          onClick={() => setRating('down')}
          className={`${iconButton} ${rating === 'down' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : ''}`}
        >
          <ThumbDownIcon />
        </button>
      </div>
      {rating !== null && (
        <form onSubmit={submit} className="qc-fade-in flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="sr-only">
            Optional comment
          </label>
          <input
            ref={input}
            id={id}
            value={comment}
            maxLength={COMMENT_MAX}
            placeholder={rating === 'up' ? 'What was good? (optional)' : 'What was wrong? (optional)'}
            onChange={(e) => setComment(e.target.value)}
            className="min-w-48 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={disabled}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Send feedback
          </button>
          <button
            type="button"
            onClick={() => setRating(null)}
            className="rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
