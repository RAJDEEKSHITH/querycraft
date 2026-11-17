import { useId, useState } from 'react'
import { Collapse } from '../../components/Collapse'
import { ChevronIcon } from '../../components/icons'
import { SqlBlock } from '../../components/SqlBlock'
import { formatMs } from '../../lib/format'
import type { AnswerData } from '../../types/api'

// Collapsible details of an answer: SQL (with copy), tables used, assumptions, tokens, time.

export function AnswerDetails({ data }: { data: AnswerData }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const assumptions = data.assumptions.length
  const hint = [
    `${data.tablesUsed.length} ${data.tablesUsed.length === 1 ? 'table' : 'tables'}`,
    assumptions > 0 ? `${assumptions} ${assumptions === 1 ? 'assumption' : 'assumptions'}` : null,
  ]
    .filter((s) => s !== null)
    .join(' · ')

  return (
    <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800/80">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
      >
        <ChevronIcon className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        Details
        <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{hint}</span>
      </button>
      <Collapse open={open} id={id}>
        <div className="space-y-4 pt-3 pb-1">
          <SqlBlock sql={data.sql} />

          {data.tablesUsed.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Tables used</h4>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {data.tablesUsed.map((t) => (
                  <li key={t} className="rounded-md border border-zinc-200 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assumptions > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Assumptions</h4>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {data.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {data.tokens.prompt.toLocaleString()} prompt + {data.tokens.completion.toLocaleString()} completion tokens · {formatMs(data.latencyMs)}
          </p>
        </div>
      </Collapse>
    </div>
  )
}
