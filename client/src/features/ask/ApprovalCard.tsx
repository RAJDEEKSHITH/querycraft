import { SqlBlock } from '../../components/SqlBlock'
import type { ApprovalRequest } from '../../types/api'

interface ApprovalCardProps {
  request: ApprovalRequest
  disabled: boolean
  onDecide: (approved: boolean) => void
}

/** The assistant's turn: an expensive query waits for the user's approval. */
export function ApprovalCard({ request, disabled, onDecide }: ApprovalCardProps) {
  const ratio = request.softLimit > 0 ? request.estimatedCost / request.softLimit : null
  return (
    <section
      aria-label="Approval needed"
      className="qc-fade-in space-y-3 rounded-xl border border-amber-300/80 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.06]"
    >
      <p className="text-xs font-medium tracking-wide text-amber-800 uppercase dark:text-amber-300">Needs your approval</p>
      <p className="text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100">This query is expensive. Run it?</p>
      <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-zinc-600 dark:text-zinc-400">Estimated cost</dt>
        <dd className="text-right font-mono font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
          {Math.round(request.estimatedCost).toLocaleString()}
        </dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Soft limit</dt>
        <dd className="text-right font-mono text-zinc-900 tabular-nums dark:text-zinc-100">{Math.round(request.softLimit).toLocaleString()}</dd>
        {ratio !== null && (
          <>
            <dt className="text-zinc-600 dark:text-zinc-400">Over the limit by</dt>
            <dd className="text-right font-mono text-zinc-900 tabular-nums dark:text-zinc-100">{ratio.toFixed(1)}×</dd>
          </>
        )}
      </dl>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Costs are PostgreSQL planner estimates (EXPLAIN, not executed). Queries above the hard limit are always blocked.
      </p>
      <SqlBlock sql={request.sql} label="SQL to run" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide(true)}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide(false)}
          className="rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Deny
        </button>
      </div>
    </section>
  )
}
