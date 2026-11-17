import { RefreshIcon } from '../../components/icons'
import { ResultView } from '../../components/ResultView'
import type { AnswerData, Column } from '../../types/api'
import { AnswerDetails } from './AnswerDetails'

interface AnswerPanelProps {
  data: AnswerData
  rerunRows: { columns: Column[]; rows: unknown[][]; truncated: boolean } | null
  busy: boolean
  onRerun: () => void
}

/** The answer first, then the chart and table, then the collapsible details. */
export function AnswerPanel({ data, rerunRows, busy, onRerun }: AnswerPanelProps) {
  const rows = data.rows ?? rerunRows?.rows ?? null
  const columns = data.rows === null && rerunRows !== null ? rerunRows.columns : data.columns
  const truncated = data.rows === null && rerunRows !== null ? rerunRows.truncated : data.truncated

  return (
    <section aria-label="Answer" className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-[17px] leading-relaxed text-zinc-900 dark:text-zinc-50">{data.answer}</p>
        {data.explanation !== '' && <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{data.explanation}</p>}
      </div>

      {rows === null ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <span>
            {data.rowCount.toLocaleString()} {data.rowCount === 1 ? 'row' : 'rows'}. Result rows are not stored; run the SQL again to see them.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onRerun}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <RefreshIcon className="size-3.5" />
            Re-run query
          </button>
        </div>
      ) : (
        <ResultView columns={columns} rows={rows} truncated={truncated} />
      )}

      <AnswerDetails data={data} />
    </section>
  )
}
