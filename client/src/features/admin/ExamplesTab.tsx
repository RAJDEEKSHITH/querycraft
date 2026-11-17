import { useCallback, useId, useState } from 'react'
import { Button } from '../../components/Button'
import { EmptyState, ErrorMessage, Loading } from '../../components/States'
import { listExamples, reindex } from '../../lib/admin-api'
import { useRequest } from '../../lib/use-request'
import { EXAMPLE_STATUSES, type ExampleStatus, type ExampleView } from '../../types/api'
import { adminErrorText } from './admin-errors'
import { ExampleCard } from './ExampleCard'

type Filter = ExampleStatus | 'all'

export function ExamplesTab({ token }: { token: string }) {
  const filterId = useId()
  const load = useCallback(() => listExamples(token), [token])
  const { data, error, loading, reload } = useRequest(load)
  const [filter, setFilter] = useState<Filter>('pending')
  const [changed, setChanged] = useState<Record<string, ExampleView>>({})
  const [reindexing, setReindexing] = useState(false)
  const [reindexNote, setReindexNote] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = (): void => {
    setChanged({})
    reload()
  }

  const runReindex = (): void => {
    setReindexing(true)
    setReindexNote(null)
    reindex(token).then(
      (stats) => {
        setReindexing(false)
        setReindexNote({ ok: true, text: `Re-index finished: ${stats.embedded} ${stats.embedded === 1 ? 'entry' : 'entries'} embedded.` })
        refresh()
      },
      (err: unknown) => {
        setReindexing(false)
        setReindexNote({ ok: false, text: adminErrorText(err) })
      },
    )
  }

  if (loading) return <Loading label="Loading examples…" />
  if (error !== null) return <ErrorMessage message={adminErrorText(error)} onRetry={refresh} />
  if (data === null) return null

  const examples = data.map((e) => changed[e.id] ?? e)
  const unindexed = examples.filter((e) => e.status === 'verified' && !e.indexed).length
  const shown = filter === 'all' ? examples : examples.filter((e) => e.status === filter)
  const count = (status: ExampleStatus): number => examples.filter((e) => e.status === status).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor={filterId} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Show
          </label>
          <select
            id={filterId}
            value={filter}
            onChange={(e) => setFilter(e.target.value === 'all' ? 'all' : (EXAMPLE_STATUSES.find((s) => s === e.target.value) ?? 'pending'))}
            className="qc-focus mt-1 h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {EXAMPLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s} ({count(s)})
              </option>
            ))}
            <option value="all">all ({examples.length})</option>
          </select>
        </div>
        <Button variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {unindexed > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span>
            {unindexed} verified {unindexed === 1 ? 'example has' : 'examples have'} no embedding yet, so retrieval cannot use{' '}
            {unindexed === 1 ? 'it' : 'them'}. Re-index embeds only changed or new entries.
          </span>
          <Button variant="primary" disabled={reindexing} onClick={runReindex}>
            {reindexing ? 'Re-indexing…' : 'Re-index'}
          </Button>
        </div>
      )}
      {reindexNote !== null &&
        (reindexNote.ok ? (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {reindexNote.text}
          </p>
        ) : (
          <ErrorMessage message={reindexNote.text} onDismiss={() => setReindexNote(null)} />
        ))}

      {shown.length === 0 ? (
        <EmptyState title={filter === 'pending' ? 'No pending examples' : 'No examples here'}>
          {filter === 'pending' ? 'A 👍 on an answered question creates a pending example.' : undefined}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {shown.map((e) => (
            <ExampleCard
              key={`${e.id}:${e.status}:${e.question}:${e.sql}`}
              example={e}
              token={token}
              onChanged={(updated) => setChanged((c) => ({ ...c, [updated.id]: updated }))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
