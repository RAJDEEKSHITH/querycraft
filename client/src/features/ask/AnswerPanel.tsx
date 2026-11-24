import { AnswerText } from '../../components/AnswerText'
import { Button } from '../../components/Button'
import { RefreshIcon } from '../../components/icons'
import { ResultView } from '../../components/ResultView'
import { formatCount } from '../../lib/units'
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
    <section aria-label="Answer" className="space-y-6">
      <div className="space-y-1.5">
        <AnswerText text={data.answer} className="text-base leading-relaxed text-zinc-900 dark:text-zinc-50" />
        {data.explanation !== '' && <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{data.explanation}</p>}
      </div>

      {rows === null ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {formatCount(data.rowCount)} {data.rowCount === 1 ? 'row' : 'rows'}. Result rows are not stored; run the SQL again to see them.
          </span>
          <Button size="sm" disabled={busy} onClick={onRerun}>
            <RefreshIcon className="size-3.5" />
            Re-run query
          </Button>
        </div>
      ) : (
        <ResultView columns={columns} rows={rows} truncated={truncated} />
      )}

      <AnswerDetails data={data} />
    </section>
  )
}
