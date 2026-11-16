import { Button } from '../../components/Button'
import { ResultView } from '../../components/ResultView'
import { SqlBlock } from '../../components/SqlBlock'
import { formatMs } from '../../lib/format'
import type { AnswerData, Column } from '../../types/api'

interface AnswerPanelProps {
  data: AnswerData
  rerunRows: { columns: Column[]; rows: unknown[][]; truncated: boolean } | null
  busy: boolean
  onRerun: () => void
}

export function AnswerPanel({ data, rerunRows, busy, onRerun }: AnswerPanelProps) {
  const rows = data.rows ?? rerunRows?.rows ?? null
  const columns = data.rows === null && rerunRows !== null ? rerunRows.columns : data.columns
  const truncated = data.rows === null && rerunRows !== null ? rerunRows.truncated : data.truncated

  return (
    <section aria-label="Answer" className="space-y-4">
      <div className="space-y-2">
        <p className="text-base text-zinc-900 dark:text-zinc-100">{data.answer}</p>
        {data.explanation !== '' && <p className="text-sm text-zinc-600 dark:text-zinc-400">{data.explanation}</p>}
      </div>

      {data.assumptions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Assumptions</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {data.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {data.tablesUsed.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Tables used</h4>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {data.tablesUsed.map((t) => (
              <li key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SqlBlock sql={data.sql} />

      {rows === null ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {data.rowCount} {data.rowCount === 1 ? 'row' : 'rows'}. Result rows are not stored; run the SQL again to see them.
          </span>
          <Button disabled={busy} onClick={onRerun}>
            Re-run query
          </Button>
        </div>
      ) : (
        <ResultView columns={columns} rows={rows} truncated={truncated} />
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Tokens: {data.tokens.prompt.toLocaleString()} prompt · {data.tokens.completion.toLocaleString()} completion · Time{' '}
        {formatMs(data.latencyMs)}
      </p>
    </section>
  )
}
