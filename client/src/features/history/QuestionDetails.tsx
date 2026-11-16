import { useState } from 'react'
import { Button } from '../../components/Button'
import { ResultView } from '../../components/ResultView'
import { SqlBlock } from '../../components/SqlBlock'
import { ErrorMessage } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { StepTimeline } from '../../components/StepTimeline'
import { BlockedCard } from '../ask/BlockedCard'
import { errorText } from '../../lib/http'
import { formatDateTime, formatMs } from '../../lib/format'
import { rerunQuestion } from '../../lib/questions-api'
import type { QuestionView, RerunResult } from '../../types/api'

export function QuestionDetails({ question }: { question: QuestionView }) {
  const [rerun, setRerun] = useState<RerunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAgain = (): void => {
    setRunning(true)
    setError(null)
    rerunQuestion(question.id).then(
      (result) => {
        setRerun(result)
        setRunning(false)
      },
      (err: unknown) => {
        setError(errorText(err))
        setRunning(false)
      },
    )
  }

  const steps = question.trace.map((t) => ({
    node: t.node,
    status: 'completed' as const,
    detail: t.detail ?? null,
    durationMs: t.durationMs,
  }))

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100">{question.question}</h3>
          <StatusBadge status={question.status} />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Asked {formatDateTime(question.createdAt)} · {question.attempts} SQL {question.attempts === 1 ? 'attempt' : 'attempts'} · Time{' '}
          {formatMs(question.latencyMs)} · Tokens {(question.tokens.prompt + question.tokens.completion).toLocaleString()}
        </p>
      </header>

      {question.answer !== null && (
        <div className="space-y-1">
          <p className="text-zinc-900 dark:text-zinc-100">{question.answer}</p>
          {question.explanation !== null && question.explanation !== '' && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{question.explanation}</p>
          )}
        </div>
      )}
      {question.assumptions.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300" aria-label="Assumptions">
          {question.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {question.tablesUsed.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tables: <span className="font-mono text-xs">{question.tablesUsed.join(', ')}</span>
        </p>
      )}
      {question.reason !== null && <p className="text-sm text-zinc-700 dark:text-zinc-300">Cannot answer: {question.reason}</p>}
      {question.blocked !== null && <BlockedCard blocked={question.blocked} />}
      {question.error !== null && (
        <p className="text-sm text-rose-700 dark:text-rose-300">
          {question.error.message} <span className="font-mono text-xs">({question.error.code})</span>
        </p>
      )}
      {question.clarification !== null && (
        <p className="text-sm text-amber-800 dark:text-amber-300">Waiting for a clarification: {question.clarification.question}</p>
      )}
      {question.approval !== null && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Waiting for approval (estimated cost {Math.round(question.approval.estimatedCost).toLocaleString()}).
        </p>
      )}

      {question.sql !== null && <SqlBlock sql={question.sql} />}

      {question.status === 'answered' && (
        <div className="space-y-3">
          <Button disabled={running} onClick={runAgain}>
            {running ? 'Running…' : rerun === null ? 'Re-run query' : 'Run again'}
          </Button>
          {error !== null && <ErrorMessage message={error} />}
          {rerun?.status === 'executed' && <ResultView columns={rerun.columns} rows={rerun.rows} truncated={rerun.truncated} />}
          {rerun?.status === 'blocked' && <BlockedCard blocked={rerun} />}
        </div>
      )}

      {steps.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Agent steps</h4>
          <div className="mt-2">
            <StepTimeline steps={steps} live={false} />
          </div>
        </div>
      )}
    </div>
  )
}
