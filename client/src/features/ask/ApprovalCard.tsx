import { Button } from '../../components/Button'
import { SqlBlock } from '../../components/SqlBlock'
import { formatCount } from '../../lib/units'
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
      <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">This query is expensive. Run it?</p>
      <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-zinc-600 dark:text-zinc-400">Estimated cost</dt>
        <dd className="text-right font-medium text-zinc-900 tabular-nums dark:text-zinc-100">{formatCount(request.estimatedCost)}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Soft limit</dt>
        <dd className="text-right text-zinc-900 tabular-nums dark:text-zinc-100">{formatCount(request.softLimit)}</dd>
        {ratio !== null && (
          <>
            <dt className="text-zinc-600 dark:text-zinc-400">Over the limit by</dt>
            <dd className="text-right text-zinc-900 tabular-nums dark:text-zinc-100">{ratio.toFixed(1)}×</dd>
          </>
        )}
      </dl>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Costs are PostgreSQL planner estimates (EXPLAIN, not executed). Queries above the hard limit are always blocked.
      </p>
      <SqlBlock sql={request.sql} label="SQL to run" />
      <div className="flex gap-2">
        <Button variant="primary" disabled={disabled} onClick={() => onDecide(true)}>
          Approve
        </Button>
        <Button disabled={disabled} onClick={() => onDecide(false)}>
          Deny
        </Button>
      </div>
    </section>
  )
}
