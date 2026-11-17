import { ShieldIcon } from '../../components/icons'
import type { BlockedInfo } from '../../types/api'

const STAGE_LABELS: Record<string, string> = {
  input: 'Input guard',
  validation: 'SQL policy (parser)',
  cost: 'Cost check',
  execution: 'Read-only execution',
  output: 'Output masking',
}

/** A blocked run: calm, with the layer, rule and reason (the only red in the thread). */
export function BlockedCard({ blocked }: { blocked: BlockedInfo }) {
  return (
    <section aria-label="Blocked" className="qc-fade-in rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-500/30 dark:bg-red-500/[0.06]">
      <p className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-300">
        <ShieldIcon className="size-4" />
        Blocked by the safety pipeline. Nothing was run.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-600 dark:text-zinc-400">Layer</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{STAGE_LABELS[blocked.stage] ?? blocked.stage}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Rule</dt>
        <dd className="font-mono text-zinc-900 dark:text-zinc-100">{blocked.rule}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Reason</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{blocked.message}</dd>
      </dl>
    </section>
  )
}
