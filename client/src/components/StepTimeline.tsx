import { isRetry, nodeLabel, stepNote } from '../lib/steps'

export interface TimelineItem {
  node: string
  status: 'started' | 'completed'
  detail: Record<string, unknown> | null
  durationMs?: number
}

export function StepTimeline({ steps, live }: { steps: TimelineItem[]; live: boolean }) {
  if (steps.length === 0) {
    return live ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Starting…</p> : null
  }
  return (
    <ol aria-label="Agent steps" aria-live={live ? 'polite' : 'off'} className="space-y-1 text-sm">
      {steps.map((step, i) => {
        const note = step.status === 'completed' ? stepNote(step.node, step.detail) : null
        const retry = isRetry(step.node, step.detail)
        return (
          <li key={i} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                step.status === 'started' ? 'animate-pulse bg-sky-500' : retry ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            />
            <span className="text-zinc-800 dark:text-zinc-200">
              {nodeLabel(step.node)}
              <span className="sr-only">{step.status === 'started' ? ' (in progress)' : ' (done)'}</span>
              {note !== null && (
                <span className={`ml-2 text-xs ${retry ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {note}
                </span>
              )}
              {step.durationMs !== undefined && (
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{Math.round(step.durationMs)} ms</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
