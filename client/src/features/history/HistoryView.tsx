import { useCallback, useState } from 'react'
import { EmptyState, ErrorMessage, Loading } from '../../components/States'
import { getQuestion } from '../../lib/questions-api'
import { useRequest } from '../../lib/use-request'
import { useHistoryStore } from '../../stores/historyStore'
import { ConversationItem } from './ConversationItem'
import { QuestionDetails } from './QuestionDetails'

function SelectedQuestion({ id }: { id: string }) {
  const load = useCallback(() => getQuestion(id), [id])
  const { data, error, loading, reload } = useRequest(load)
  if (loading) return <Loading label="Loading question…" />
  if (error !== null) return <ErrorMessage message={error.message} onRetry={reload} />
  if (data === null) return null
  return <QuestionDetails key={data.id} question={data} />
}

export function HistoryView() {
  const ids = useHistoryStore((s) => s.ids)
  const [selected, setSelected] = useState<string | null>(null)

  if (ids.length === 0) {
    return (
      <EmptyState title="No conversations yet">
        Questions you ask in this browser appear here. <a href="#/" className="text-sky-700 underline dark:text-sky-400">Ask one</a>.
      </EmptyState>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Conversations in this browser</h2>
        {ids.map((id) => (
          <ConversationItem key={id} id={id} selectedQuestionId={selected} onSelect={(_, questionId) => setSelected(questionId)} />
        ))}
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        {selected === null ? (
          <EmptyState title="Select a question">Its answer, SQL, steps and a re-run of its results show here.</EmptyState>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <SelectedQuestion id={selected} />
          </div>
        )}
      </div>
    </div>
  )
}
