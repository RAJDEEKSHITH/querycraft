import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button, IconButton } from '../../components/Button'
import { CheckIcon, ThumbDownIcon, ThumbUpIcon } from '../../components/icons'
import type { FeedbackRating } from '../../types/api'

const COMMENT_MAX = 1000

interface FeedbackButtonsProps {
  given: { rating: FeedbackRating; exampleCreated: boolean } | null
  disabled: boolean
  onSend: (rating: FeedbackRating, comment: string) => void
}

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
        <IconButton aria-label="Rate the answer as helpful" pressed={rating === 'up'} disabled={disabled} onClick={() => setRating('up')}>
          <ThumbUpIcon />
        </IconButton>
        <IconButton aria-label="Rate the answer as not helpful" pressed={rating === 'down'} disabled={disabled} onClick={() => setRating('down')}>
          <ThumbDownIcon />
        </IconButton>
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
            className="h-8 min-w-48 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <Button type="submit" variant="primary" disabled={disabled}>
            Send feedback
          </Button>
          <Button variant="ghost" onClick={() => setRating(null)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}
