import { activeLabel, isRetry, nodeLabel, stepNote } from '../lib/steps'

export interface TimelineItem {
  node: string
  status: 'started' | 'completed'
  detail: Record<string, unknown> | null
  durationMs?: number | null
}

/** The agent's steps: a step in progress shows a present-tense label ("Writing SQL…"). */
export function StepTimeline({ steps, live }: { steps: TimelineItem[]; live: boolean }) {
  if (steps.length === 0) {
    return live ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Starting…</p> : null
  }
  return (
    <ol aria-label="Agent steps" aria-live={live ? 'polite' : 'off'} className="space-y-1.5 text-sm">
      {steps.map((step, i) => {
        const running = step.status === 'started'
        const note = running ? null : stepNote(step.node, step.detail)
        const retry = isRetry(step.node, step.detail)
        return (
          <li key={i} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-[7px] size-1.5 shrink-0 rounded-full ${
                running ? 'bg-indigo-500 motion-safe:animate-pulse' : retry ? 'bg-indigo-500' : 'bg-emerald-500'
              }`}
            />
            <span className={running ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'}>
              {running ? activeLabel(step.node) : nodeLabel(step.node)}
              <span className="sr-only">{running ? ' (in progress)' : ' (done)'}</span>
              {note !== null && (
                <span className={`ml-2 text-xs ${retry ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-zinc-500 dark:text-zinc-500'}`}>
                  {note}
                </span>
              )}
              {step.durationMs !== undefined && step.durationMs !== null && (
                <span className="ml-2 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{Math.round(step.durationMs)} ms</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
