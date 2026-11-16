import { useId, useState } from 'react'
import { Button } from '../../components/Button'
import type { FeedbackRating } from '../../types/api'

const COMMENT_MAX = 1000

interface FeedbackButtonsProps {
  given: { rating: FeedbackRating; exampleCreated: boolean } | null
  disabled: boolean
  onSend: (rating: FeedbackRating, comment: string) => void
}

export function FeedbackButtons({ given, disabled, onSend }: FeedbackButtonsProps) {
  const id = useId()
  const [comment, setComment] = useState('')

  if (given !== null) {
    return (
      <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
        Thanks for the feedback ({given.rating === 'up' ? 'helpful' : 'not helpful'}).
        {given.exampleCreated ? ' This question and its SQL are now a pending example for the admin to review.' : ''}
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <label htmlFor={id} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Was this answer right? Optional comment
        </label>
        <input
          id={id}
          value={comment}
          maxLength={COMMENT_MAX}
          onChange={(e) => setComment(e.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>
      <Button disabled={disabled} onClick={() => onSend('up', comment)} aria-label="Rate the answer as helpful">
        👍 Helpful
      </Button>
      <Button disabled={disabled} onClick={() => onSend('down', comment)} aria-label="Rate the answer as not helpful">
        👎 Not helpful
      </Button>
    </div>
  )
}
