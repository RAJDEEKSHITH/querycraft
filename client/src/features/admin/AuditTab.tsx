import { useCallback, useState } from 'react'
import { Button } from '../../components/Button'
import { EmptyState, ErrorMessage, Loading } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { listAudit } from '../../lib/admin-api'
import { formatDateTime } from '../../lib/format'
import { useRequest } from '../../lib/use-request'
import type { AuditDecision, AuditEventView } from '../../types/api'
import { adminErrorText } from './admin-errors'

type Filter = Extract<AuditDecision, 'blocked' | 'allowed'> | null

const FILTERS: { value: Filter; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'allowed', label: 'Allowed' },
]

interface MorePages {
  filter: Filter
  events: AuditEventView[]
  nextBefore: string | null
}

function AuditRow({ event }: { event: AuditEventView }) {
  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={event.decision} />
        <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{event.rule}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {event.stage} · {event.source} · {formatDateTime(event.createdAt)}
        </span>
      </div>
      <p className="text-zinc-700 dark:text-zinc-300">{event.message}</p>
      {event.sql !== null && (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-500 select-none dark:text-zinc-400">SQL</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-zinc-50 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            {event.sql}
          </pre>
        </details>
      )}
    </li>
  )
}

export function AuditTab({ token }: { token: string }) {
  const [filter, setFilter] = useState<Filter>(null)
  const load = useCallback(() => listAudit(token, { decision: filter, before: null }), [token, filter])
  const first = useRequest(load)
  const [more, setMore] = useState<MorePages | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  const extra = more !== null && more.filter === filter ? more : null
  const events = [...(first.data?.events ?? []), ...(extra?.events ?? [])]
  const nextBefore = extra !== null ? extra.nextBefore : (first.data?.nextBefore ?? null)

  const choose = (value: Filter): void => {
    setFilter(value)
    setMore(null)
    setMoreError(null)
  }

  const loadMore = (): void => {
    if (nextBefore === null) return
    setLoadingMore(true)
    setMoreError(null)
    listAudit(token, { decision: filter, before: nextBefore }).then(
      (page) => {
        setLoadingMore(false)
        setMore({ filter, events: [...(extra?.events ?? []), ...page.events], nextBefore: page.nextBefore })
      },
      (err: unknown) => {
        setLoadingMore(false)
        setMoreError(adminErrorText(err))
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by decision" className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => choose(f.value)}
              className={`rounded-md px-3 py-1 text-sm qc-focus ${
                filter === f.value
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setMore(null)
            first.reload()
          }}
        >
          Refresh
        </Button>
      </div>

      {first.loading && <Loading label="Loading audit events…" />}
      {first.error !== null && <ErrorMessage message={adminErrorText(first.error)} onRetry={first.reload} />}
      {!first.loading && first.error === null && events.length === 0 && (
        <EmptyState title="No audit events">Every safety decision (allowed or blocked) is recorded here.</EmptyState>
      )}
      {events.length > 0 && (
        <ul aria-label="Audit events, newest first" className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60">
          {events.map((e) => (
            <AuditRow key={e.id} event={e} />
          ))}
        </ul>
      )}
      {moreError !== null && <ErrorMessage message={moreError} onRetry={loadMore} />}
      {nextBefore !== null && !first.loading && (
        <Button disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
