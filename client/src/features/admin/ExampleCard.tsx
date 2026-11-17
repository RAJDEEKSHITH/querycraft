import { useId, useState } from 'react'
import { Button } from '../../components/Button'
import { SqlBlock } from '../../components/SqlBlock'
import { ErrorMessage } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { updateExample, type ExamplePatch } from '../../lib/admin-api'
import { formatDateTime } from '../../lib/format'
import type { ExampleView } from '../../types/api'
import { adminErrorText } from './admin-errors'

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'

interface ExampleCardProps {
  example: ExampleView
  token: string
  onChanged: (example: ExampleView) => void
}

export function ExampleCard({ example, token, onChanged }: ExampleCardProps) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [question, setQuestion] = useState(example.question)
  const [sql, setSql] = useState(example.sql)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (patch: ExamplePatch): void => {
    setSaving(true)
    setError(null)
    updateExample(token, example.id, patch).then(
      (updated) => {
        setSaving(false)
        setEditing(false)
        onChanged(updated)
      },
      (err: unknown) => {
        setSaving(false)
        setError(adminErrorText(err))
      },
    )
  }

  const saveEdit = (): void => {
    const patch: ExamplePatch = {}
    if (question.trim() !== example.question) patch.question = question.trim()
    if (sql.trim() !== example.sql) patch.sql = sql.trim()
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }
    save(patch)
  }

  return (
    <article className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <header className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <StatusBadge status={example.status} />
        <span>source: {example.source}</span>
        <span>· {formatDateTime(example.createdAt)}</span>
        {example.status === 'verified' && (
          <span className={example.indexed ? '' : 'font-medium text-amber-700 dark:text-amber-400'}>
            · {example.indexed ? 'indexed' : 'not indexed yet (re-index to use it in retrieval)'}
          </span>
        )}
      </header>

      {editing ? (
        <div className="space-y-2">
          <div>
            <label htmlFor={`${id}-q`} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Question
            </label>
            <input id={`${id}-q`} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${id}-s`} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              SQL
            </label>
            <textarea
              id={`${id}-s`}
              value={sql}
              rows={6}
              maxLength={10_000}
              onChange={(e) => setSql(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{example.question}</p>
          <SqlBlock sql={example.sql} />
        </>
      )}

      {error !== null && <ErrorMessage message={error} onDismiss={() => setError(null)} />}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button variant="primary" disabled={saving || question.trim() === '' || sql.trim() === ''} onClick={saveEdit}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                setEditing(false)
                setQuestion(example.question)
                setSql(example.sql)
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            {example.status !== 'verified' && (
              <Button variant="primary" disabled={saving} onClick={() => save({ status: 'verified' })}>
                Verify
              </Button>
            )}
            {example.status !== 'rejected' && (
              <Button variant="danger" disabled={saving} onClick={() => save({ status: 'rejected' })}>
                Reject
              </Button>
            )}
            <Button disabled={saving} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        )}
      </div>
      {!editing && example.status !== 'verified' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Verifying runs the SQL through the safety pipeline first; it must pass and execute.</p>
      )}
    </article>
  )
}
