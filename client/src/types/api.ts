// API types mirrored from the server contract (IMPLEMENTATION.md section 14).
// Keep in sync with server/src/services/*.ts and server/src/agent/graph.ts.

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'INTERNAL_ERROR'

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> }
}

export const QUESTION_STATUSES = [
  'running',
  'awaiting_clarification',
  'awaiting_approval',
  'answered',
  'blocked',
  'cannot_answer',
  'failed',
  'cancelled',
] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const NODE_NAMES = [
  'input_guard',
  'retrieve_context',
  'generate',
  'clarify',
  'validate_sql',
  'cost_check',
  'approval',
  'execute',
  'mask_output',
  'answer',
] as const
export type NodeName = (typeof NODE_NAMES)[number]

export interface Column {
  name: string
  type: string
}

export interface StepEvent {
  node: NodeName
  status: 'started' | 'completed'
  detail?: Record<string, unknown>
}

export interface ClarificationRequest {
  question: string
  options: string[]
}

export interface ApprovalRequest {
  estimatedCost: number
  softLimit: number
  sql: string
}

export interface BlockedInfo {
  stage: string
  rule: string
  message: string
}

export interface Tokens {
  prompt: number
  completion: number
  embedding: number
}

export interface AnswerData {
  answer: string
  explanation: string
  sql: string
  tablesUsed: string[]
  assumptions: string[]
  columns: Column[]
  /** Masked rows; null when served from the stored record (rows are never stored; use rerun). */
  rows: unknown[][] | null
  rowCount: number
  truncated: boolean
  tokens: Tokens
  latencyMs: number | null
}

export type QuestionEvent =
  | { event: 'step'; data: StepEvent }
  | { event: 'clarification_required'; data: ClarificationRequest }
  | { event: 'approval_required'; data: ApprovalRequest }
  | { event: 'blocked'; data: BlockedInfo }
  | { event: 'answer'; data: AnswerData }
  | { event: 'cannot_answer'; data: { reason: string } }
  | { event: 'error'; data: { code: string; message: string } }
  | { event: 'done'; data: { status: string } }

export type QuestionEventName = QuestionEvent['event']

export interface TraceEntry {
  node: string
  startedAt: string
  durationMs: number
  detail?: Record<string, unknown>
}

export interface QuestionView {
  id: string
  conversationId: string
  question: string
  status: QuestionStatus
  sql: string | null
  answer: string | null
  explanation: string | null
  tablesUsed: string[]
  assumptions: string[]
  columns: Column[]
  rowCount: number | null
  truncated: boolean | null
  attempts: number
  trace: TraceEntry[]
  errorCode: string | null
  tokens: Tokens
  costUsd: string
  latencyMs: number | null
  createdAt: string
  completedAt: string | null
  clarification: ClarificationRequest | null
  approval: ApprovalRequest | null
  reason: string | null
  blocked: BlockedInfo | null
  error: { code: string; message: string } | null
}

export interface ConversationView {
  id: string
  createdAt: string
  questions: QuestionView[]
}

export interface CreatedQuestion {
  questionId: string
  conversationId: string
}

export type RerunResult =
  | { status: 'executed'; columns: Column[]; rows: unknown[][]; rowCount: number; truncated: boolean }
  | ({ status: 'blocked' } & BlockedInfo)

export type FeedbackRating = 'up' | 'down'

export interface FeedbackResult {
  feedbackId: string
  exampleId: string | null
}

export const EXAMPLE_STATUSES = ['pending', 'verified', 'rejected'] as const
export type ExampleStatus = (typeof EXAMPLE_STATUSES)[number]

export interface ExampleView {
  id: string
  question: string
  sql: string
  status: ExampleStatus
  source: string
  createdAt: string
  verifiedAt: string | null
  /** Has an embedding, so retrieval can return it (when verified). */
  indexed: boolean
}

export type AuditDecision = 'allowed' | 'blocked' | 'needs_approval'

export interface AuditEventView {
  id: string
  questionId: string | null
  source: 'app' | 'mcp' | 'eval'
  stage: string
  decision: AuditDecision
  rule: string
  message: string
  sql: string | null
  detail: Record<string, unknown>
  createdAt: string
}

export interface AuditPage {
  events: AuditEventView[]
  nextBefore: string | null
}

export interface ReindexStats {
  tables: number
  examples: number
  glossary: number
  embedded: number
}
