import { useState } from 'react'
import { chooseChart } from '../lib/chart'
import type { Column } from '../types/api'
import { Button } from './Button'
import { Chart } from './Chart'
import { ErrorBoundary } from './ErrorBoundary'
import { ResultTable } from './ResultTable'

interface ResultProps {
  columns: Column[]
  rows: unknown[][]
  truncated: boolean
}

function ResultContent({ columns, rows, truncated }: ResultProps) {
  const spec = chooseChart(columns, rows)
  const [showChart, setShowChart] = useState(true)
  return (
    <div className="space-y-3">
      {spec !== null && (
        <div className="space-y-2">
          <Button variant="ghost" className="px-2 py-0.5 text-xs" aria-expanded={showChart} onClick={() => setShowChart(!showChart)}>
            {showChart ? 'Hide chart' : 'Show chart'}
          </Button>
          {showChart && <Chart spec={spec} columns={columns} rows={rows} />}
        </div>
      )}
      <ResultTable columns={columns} rows={rows} truncated={truncated} />
    </div>
  )
}

/** Result rows as a chart (when chooseChart allows one) and a paged table. A render
 *  error here leaves the answer, SQL and feedback around it usable. */
export function ResultView(props: ResultProps) {
  return (
    <ErrorBoundary label="the result">
      <ResultContent {...props} />
    </ErrorBoundary>
  )
}
