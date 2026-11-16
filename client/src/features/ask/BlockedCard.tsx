import type { BlockedInfo } from '../../types/api'

const STAGE_LABELS: Record<string, string> = {
  input: 'Input guard',
  validation: 'SQL policy (parser)',
  cost: 'Cost check',
  execution: 'Read-only execution',
  output: 'Output masking',
}

export function BlockedCard({ blocked }: { blocked: BlockedInfo }) {
  return (
    <section aria-label="Blocked" className="space-y-2 rounded-lg border border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
      <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-200">Blocked by the safety pipeline</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
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
