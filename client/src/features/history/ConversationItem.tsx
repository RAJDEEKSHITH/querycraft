import { useCallback } from 'react'
import { Button } from '../../components/Button'
import { ErrorMessage, Loading } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../lib/format'
import { getConversation } from '../../lib/questions-api'
import { useRequest } from '../../lib/use-request'
import { useHistoryStore } from '../../stores/historyStore'

interface ConversationItemProps {
  id: string
  selectedQuestionId: string | null
  onSelect: (conversationId: string, questionId: string) => void
}

export function ConversationItem({ id, selectedQuestionId, onSelect }: ConversationItemProps) {
  const load = useCallback(() => getConversation(id), [id])
  const { data, error, loading, reload } = useRequest(load)
  const remove = useHistoryStore((s) => s.remove)

  if (loading) return <Loading label="Loading conversation…" />
  if (error !== null) {
    return error.code === 'NOT_FOUND' ? (
      <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        This conversation no longer exists on the server.
        <Button variant="ghost" onClick={() => remove(id)}>
          Remove from history
        </Button>
      </div>
    ) : (
      <ErrorMessage message={error.message} onRetry={reload} />
    )
  }
  if (data === null) return null

  return (
    <section aria-label={`Conversation from ${formatDateTime(data.createdAt)}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <header className="border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {formatDateTime(data.createdAt)} · {data.questions.length} {data.questions.length === 1 ? 'question' : 'questions'}
      </header>
      {data.questions.length === 0 ? (
        <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">No questions in this conversation.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.questions.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                aria-current={selectedQuestionId === q.id}
                onClick={() => onSelect(id, q.id)}
                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-zinc-800/60 ${
                  selectedQuestionId === q.id ? 'bg-sky-50 dark:bg-sky-950/40' : ''
                }`}
              >
                <span className="text-zinc-800 dark:text-zinc-200">{q.question}</span>
                <StatusBadge status={q.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
