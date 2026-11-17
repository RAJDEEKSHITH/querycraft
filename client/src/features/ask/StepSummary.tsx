import { useId, useState } from 'react'
import { Collapse } from '../../components/Collapse'
import { CheckIcon, ChevronIcon } from '../../components/icons'
import { StepTimeline } from '../../components/StepTimeline'
import { timelineSummary } from '../../lib/steps'
import type { Turn } from '../../stores/ask-reducer'

// Live timeline while the run streams; afterwards one summary line that expands it.

export function StepSummary({ turn }: { turn: Turn }) {
  const id = useId()
  const [open, setOpen] = useState(false)

  if (turn.streaming) {
    return (
      <div className="py-1">
        <StepTimeline steps={turn.steps} live />
      </div>
    )
  }
  if (turn.steps.length === 0) return null

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 qc-focus dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-200"
      >
        {turn.status === 'answered' && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
        <span>{timelineSummary(turn.steps, turn.latencyMs)}</span>
        <span className="sr-only">{open ? ', hide the steps' : ', show the steps'}</span>
        <ChevronIcon className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <Collapse open={open} id={id}>
        <div className="pt-2 pb-1 pl-1">
          <StepTimeline steps={turn.steps} live={false} />
        </div>
      </Collapse>
    </div>
  )
}
