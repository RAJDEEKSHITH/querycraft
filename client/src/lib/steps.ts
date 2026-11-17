// Labels for the agent's graph nodes and their step details (IMPLEMENTATION.md 12.1, 14.3).

import { formatMs } from './format'

const NODE_LABELS: Record<string, string> = {
  input_guard: 'Check the question',
  retrieve_context: 'Find tables, examples and definitions',
  generate: 'Write SQL',
  clarify: 'Ask for clarification',
  validate_sql: 'Check the SQL against the safety policy',
  cost_check: 'Estimate the query cost',
  approval: 'Wait for approval',
  execute: 'Run the query (read-only)',
  mask_output: 'Mask personal data',
  answer: 'Write the answer',
}

export function nodeLabel(node: string): string {
  return NODE_LABELS[node] ?? node
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A short note for a completed step, from its detail; null when there is nothing to say. */
export function stepNote(node: string, detail: Record<string, unknown> | null | undefined): string | null {
  if (detail === null || detail === undefined) return null
  const attempt = num(detail['attempt'])
  switch (node) {
    case 'generate': {
      const action = detail['action']
      const prefix = attempt !== null && attempt > 1 ? `attempt ${attempt} (self-correction)` : attempt !== null ? `attempt ${attempt}` : ''
      if (action === 'sql') return prefix === '' ? null : prefix
      if (action === 'clarify') return 'needs a clarification'
      if (action === 'cannot_answer') return 'cannot be answered from this database'
      if (action === 'invalid_output') return [prefix, 'invalid reply, retrying'].filter((s) => s !== '').join(' · ')
      return prefix === '' ? null : prefix
    }
    case 'validate_sql':
    case 'cost_check': {
      const rule = typeof detail['rule'] === 'string' ? detail['rule'] : null
      const cost = num(detail['cost'])
      return [cost === null ? null : `estimated cost ${Math.round(cost).toLocaleString()}`, rule].filter((s) => s !== null).join(' · ') || null
    }
    case 'execute': {
      const rows = num(detail['rowCount'])
      if (typeof detail['rule'] === 'string') return detail['rule']
      if (rows === null) return null
      return rows === 0 ? '0 rows' : `${rows.toLocaleString()} ${rows === 1 ? 'row' : 'rows'}${detail['truncated'] === true ? ' (row limit reached)' : ''}`
    }
    case 'approval':
      return detail['approved'] === true ? 'approved' : detail['approved'] === false ? 'denied' : null
    case 'mask_output': {
      const masked = detail['maskedColumns']
      return Array.isArray(masked) && masked.length > 0 ? `masked: ${masked.map(String).join(', ')}` : null
    }
    default:
      return null
  }
}

/** True when the step shows a retry (the self-correction moment). */
export function isRetry(node: string, detail: Record<string, unknown> | null | undefined): boolean {
  if (node !== 'generate' || detail === null || detail === undefined) return false
  const attempt = num(detail['attempt'])
  return attempt !== null && attempt > 1
}

// Present-tense labels for the step in progress (the live timeline).
const ACTIVE_LABELS: Record<string, string> = {
  input_guard: 'Checking the question…',
  retrieve_context: 'Finding tables…',
  generate: 'Writing SQL…',
  clarify: 'Asking for clarification…',
  validate_sql: 'Checking safety…',
  cost_check: 'Estimating the cost…',
  approval: 'Waiting for approval…',
  execute: 'Running the query…',
  mask_output: 'Masking personal data…',
  answer: 'Writing the answer…',
}

export function activeLabel(node: string): string {
  return ACTIVE_LABELS[node] ?? `${nodeLabel(node)}…`
}

export interface SummaryStep {
  node: string
  status: 'started' | 'completed'
  detail: Record<string, unknown> | null
}

/**
 * One-line summary of a finished timeline, e.g. "8 steps · 1 attempt · 3.2 s". Attempts
 * count the SQL the model wrote (left out when it wrote none); the time is shown only
 * when the server reported it.
 */
export function timelineSummary(steps: readonly SummaryStep[], latencyMs: number | null): string {
  const done = steps.filter((s) => s.status === 'completed')
  let attempts = 0
  for (const s of done) {
    if (s.node !== 'generate' || s.detail?.['action'] !== 'sql') continue
    const n = num(s.detail['attempt'])
    attempts = Math.max(attempts + (n === null ? 1 : 0), n ?? 0)
  }
  const parts = [`${done.length} ${done.length === 1 ? 'step' : 'steps'}`]
  if (attempts > 0) parts.push(`${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`)
  if (latencyMs !== null) parts.push(formatMs(latencyMs))
  return parts.join(' · ')
}
