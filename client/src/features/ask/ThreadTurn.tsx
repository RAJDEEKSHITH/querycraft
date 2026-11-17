import type { ReactNode } from 'react'
import { AlertIcon, InfoIcon, LogoMark } from '../../components/icons'
import { AnswerSkeleton } from '../../components/Skeleton'
import type { Exchange, Turn } from '../../stores/ask-reducer'
import { useAskStore } from '../../stores/askStore'
import { AnswerPanel } from './AnswerPanel'
import { ApprovalCard } from './ApprovalCard'
import { BlockedCard } from './BlockedCard'
import { ClarificationCard } from './ClarificationCard'
import { FeedbackButtons } from './FeedbackButtons'
import { StepSummary } from './StepSummary'

// One question of the thread: the user's message, then the assistant's turn (steps,
// inline clarification or approval, the outcome, feedback).

const FINISHED = new Set(['answered', 'blocked', 'cannot_answer', 'failed', 'cancelled'])

const smallButton =
  'rounded-lg border border-zinc-300 px-2.5 py-1 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800'

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="qc-fade-in flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
        <span className="sr-only">You asked: </span>
        {text}
      </p>
    </div>
  )
}

function ExchangeLine({ exchange }: { exchange: Exchange }) {
  if (exchange.kind === 'clarification') {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {exchange.question !== '' && <span>{exchange.question} </span>}
        <span className="font-medium text-zinc-800 dark:text-zinc-200">You chose: {exchange.answer}</span>
      </p>
    )
  }
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400">
      Estimated cost {Math.round(exchange.estimatedCost).toLocaleString()}:{' '}
      <span className="font-medium text-zinc-800 dark:text-zinc-200">{exchange.approved ? 'you approved it' : 'you denied it'}</span>
    </p>
  )
}

function Notice({ icon, children }: { icon: 'info' | 'alert'; children: ReactNode }) {
  const Icon = icon === 'info' ? InfoIcon : AlertIcon
  return (
    <div className="qc-fade-in flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
      <Icon className="mt-0.5 size-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  )
}

export function ThreadTurn({ turn }: { turn: Turn }) {
  const busy = useAskStore((s) => s.busy)
  const answerClarification = useAskStore((s) => s.answerClarification)
  const decideApproval = useAskStore((s) => s.decideApproval)
  const reconnect = useAskStore((s) => s.reconnect)
  const rerun = useAskStore((s) => s.rerun)
  const giveFeedback = useAskStore((s) => s.giveFeedback)
  const outcome = turn.outcome
  const finished = FINISHED.has(turn.status) && !turn.streaming
  const pendingClarification = turn.clarification !== null && turn.status === 'awaiting_clarification'
  const pendingApproval = turn.approval !== null && turn.status === 'awaiting_approval'
  const working = turn.streaming && outcome === null && !pendingClarification && !pendingApproval

  return (
    <div className="space-y-5">
      <UserMessage text={turn.question} />
      <article aria-label="QueryCraft's response" aria-busy={turn.streaming} className="qc-fade-in flex gap-3">
        <LogoMark className="mt-0.5 size-6 shrink-0" />
        <div className="min-w-0 flex-1 space-y-4">
          <StepSummary turn={turn} />

          {turn.exchanges.map((exchange, i) => (
            <ExchangeLine key={i} exchange={exchange} />
          ))}

          {pendingClarification && turn.clarification !== null && (
            <ClarificationCard
              request={turn.clarification}
              disabled={busy}
              onAnswer={(answer) => void answerClarification(turn.questionId, answer)}
            />
          )}
          {pendingApproval && turn.approval !== null && (
            <ApprovalCard request={turn.approval} disabled={busy} onDecide={(approved) => void decideApproval(turn.questionId, approved)} />
          )}

          {working && <AnswerSkeleton />}

          {outcome?.kind === 'answer' && (
            <AnswerPanel data={outcome.data} rerunRows={turn.rerunRows} busy={busy} onRerun={() => void rerun(turn.questionId)} />
          )}
          {outcome?.kind === 'blocked' && <BlockedCard blocked={outcome.data} />}
          {outcome?.kind === 'cannot_answer' && (
            <section aria-label="Cannot answer">
              <Notice icon="info">
                <p className="font-medium text-zinc-900 dark:text-zinc-100">This question can't be answered from the database.</p>
                {outcome.reason !== '' && <p>{outcome.reason}</p>}
              </Notice>
            </section>
          )}
          {turn.status === 'cancelled' && outcome === null && !turn.streaming && (
            <div role="status">
              <Notice icon="info">
                <p>You denied the expensive query, so nothing was run.</p>
              </Notice>
            </div>
          )}
          {outcome?.kind === 'error' && (
            <div role="alert">
              <Notice icon="alert">
                <p>
                  {outcome.message} <span className="font-mono text-xs text-zinc-500">({outcome.code})</span>
                </p>
                {outcome.code === 'STREAM_LOST' && (
                  <button type="button" onClick={() => reconnect(turn.questionId)} className={smallButton}>
                    Reconnect
                  </button>
                )}
              </Notice>
            </div>
          )}
          {turn.detached && turn.status === 'running' && outcome === null && (
            <div role="status">
              <Notice icon="info">
                <p>You stopped waiting. The question is still running on the server; its result is saved when it finishes.</p>
                <button type="button" onClick={() => reconnect(turn.questionId)} className={smallButton}>
                  Show result
                </button>
              </Notice>
            </div>
          )}

          {finished && (outcome?.kind === 'answer' || outcome?.kind === 'blocked' || outcome?.kind === 'cannot_answer') && (
            <FeedbackButtons given={turn.feedback} disabled={busy} onSend={(rating, comment) => void giveFeedback(turn.questionId, rating, comment)} />
          )}
        </div>
      </article>
    </div>
  )
}
