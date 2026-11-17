import { useState } from 'react'
import { columnKind } from '../lib/chart'
import { formatResultCell } from '../lib/format'
import type { Column } from '../types/api'
import { Button } from './Button'

export const PAGE_SIZE = 25

interface ResultTableProps {
  columns: Column[]
  rows: unknown[][]
  truncated: boolean
}

/** Paged result table: sticky header, row hover, numbers right-aligned in monospace,
 *  horizontal scroll for wide results. */
export function ResultTable({ columns, rows, truncated }: ResultTableProps) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const numeric = columns.map((c) => columnKind(c.type) === 'number')

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">The query returned no rows.</p>
  }

  return (
    <div className="space-y-2">
      {truncated && (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          Showing the first {rows.length} rows: the result was cut at the row limit.
        </p>
      )}
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`border-b border-zinc-200 px-3 py-2 font-medium whitespace-nowrap dark:border-zinc-800 ${numeric[i] === true ? 'text-right' : ''}`}
                >
                  {c.name}
                  <span className="ml-1 font-mono font-normal text-zinc-400 dark:text-zinc-500">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, r) => (
              <tr key={current * PAGE_SIZE + r} className="text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900/70">
                {columns.map((column, i) => {
                  const cell = row[i]
                  return (
                    <td
                      key={i}
                      className={`border-b border-zinc-100 px-3 py-1.5 whitespace-nowrap dark:border-zinc-800/70 ${
                        numeric[i] === true ? 'text-right font-mono text-[13px] tabular-nums' : ''
                      }`}
                    >
                      {cell === null || cell === undefined ? (
                        <span className="text-zinc-400 italic dark:text-zinc-500">NULL</span>
                      ) : (
                        formatResultCell(cell, column)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        </span>
        {pages > 1 && (
          <nav aria-label="Result pages" className="flex items-center gap-2">
            <Button className="px-2 py-0.5 text-xs" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <Button className="px-2 py-0.5 text-xs" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </nav>
        )}
      </div>
    </div>
  )
}
