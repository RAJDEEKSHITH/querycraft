import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import { StepTimeline } from '../../components/StepTimeline'
import type { Turn } from '../../stores/ask-reducer'
import { useAskStore } from '../../stores/askStore'
import { AnswerPanel } from './AnswerPanel'
import { ApprovalCard } from './ApprovalCard'
import { BlockedCard } from './BlockedCard'
import { ClarificationCard } from './ClarificationCard'
import { FeedbackButtons } from './FeedbackButtons'

const FINISHED = new Set(['answered', 'blocked', 'cannot_answer', 'failed', 'cancelled'])

export function TurnCard({ turn }: { turn: Turn }) {
  const busy = useAskStore((s) => s.busy)
  const answerClarification = useAskStore((s) => s.answerClarification)
  const decideApproval = useAskStore((s) => s.decideApproval)
  const reconnect = useAskStore((s) => s.reconnect)
  const rerun = useAskStore((s) => s.rerun)
  const giveFeedback = useAskStore((s) => s.giveFeedback)
  const outcome = turn.outcome
  const finished = FINISHED.has(turn.status) && !turn.streaming

  return (
    <article className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">{turn.question}</h2>
        <StatusBadge status={turn.status} />
      </header>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Agent steps</h3>
        <div className="mt-2">
          <StepTimeline steps={turn.steps} live={turn.streaming} />
        </div>
      </div>

      {turn.clarification !== null && turn.status === 'awaiting_clarification' && (
        <ClarificationCard
          request={turn.clarification}
          disabled={busy}
          onAnswer={(answer) => void answerClarification(turn.questionId, answer)}
        />
      )}
      {turn.approval !== null && turn.status === 'awaiting_approval' && (
        <ApprovalCard request={turn.approval} disabled={busy} onDecide={(approved) => void decideApproval(turn.questionId, approved)} />
      )}

      {outcome?.kind === 'answer' && (
        <AnswerPanel data={outcome.data} rerunRows={turn.rerunRows} busy={busy} onRerun={() => void rerun(turn.questionId)} />
      )}
      {outcome?.kind === 'blocked' && <BlockedCard blocked={outcome.data} />}
      {outcome?.kind === 'cannot_answer' && (
        <section aria-label="Cannot answer" className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">This question cannot be answered from the database</h3>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{outcome.reason}</p>
        </section>
      )}
      {turn.status === 'cancelled' && outcome === null && !turn.streaming && (
        <p role="status" className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
          You denied the expensive query, so nothing was run.
        </p>
      )}
      {outcome?.kind === 'error' && (
        <section role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <span>
            {outcome.message} <span className="font-mono text-xs">({outcome.code})</span>
          </span>
          {outcome.code === 'STREAM_LOST' && (
            <Button onClick={() => reconnect(turn.questionId)}>Reconnect</Button>
          )}
        </section>
      )}

      {finished && (outcome?.kind === 'answer' || outcome?.kind === 'blocked' || outcome?.kind === 'cannot_answer') && (
        <FeedbackButtons
          given={turn.feedback}
          disabled={busy}
          onSend={(rating, comment) => void giveFeedback(turn.questionId, rating, comment)}
        />
      )}
    </article>
  )
}
