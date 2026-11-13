import { Annotation } from '@langchain/langgraph'
import type { StoredColumn, TraceEntry } from '../db/schema.js'
import type { RequestSource } from '../services/audit.service.js'
import type { RetrievedContext } from '../services/retrieval.service.js'
import type { SqlCandidate } from './output.js'

// Agent state (IMPLEMENTATION.md 12.2). The state is checkpointed in the app
// database after every step, so it never holds result rows (10.3): rows stay in
// memory for one run (see graph.ts) and only columns, count and truncation are
// kept here.

/** Ablation configuration (20.4). All on for the app and MCP. */
export interface AgentFlags {
  schemaRetrieval: boolean
  examplesGlossaryValues: boolean
  selfCorrection: boolean
}

export const FULL_FLAGS: AgentFlags = { schemaRetrieval: true, examplesGlossaryValues: true, selfCorrection: true }

export interface ConversationTurn {
  question: string
  sql: string
}

export interface ResultMeta {
  columns: StoredColumn[]
  /** Columns masked as PII by the safety executor stage (layer 5). */
  maskedColumns: string[]
  rowCount: number
  truncated: boolean
}

export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  embeddingTokens: number
  llmRequests: number
}

export type Outcome =
  | { status: 'answered' }
  | { status: 'cannot_answer'; reason: string }
  | { status: 'blocked'; stage: string; rule: string; message: string }
  | { status: 'cancelled' }
  | { status: 'failed'; errorCode: string; message: string }

const ZERO_USAGE: UsageTotals = { promptTokens: 0, completionTokens: 0, embeddingTokens: 0, llmRequests: 0 }

function value<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_current: T, update: T) => update, default: initial })
}

export const AgentState = Annotation.Root({
  questionId: value<string>(() => ''),
  question: value<string>(() => ''),
  source: value<RequestSource>(() => 'app'),
  flags: value<AgentFlags>(() => FULL_FLAGS),
  conversationContext: value<ConversationTurn[]>(() => []),
  retrieved: value<RetrievedContext | null>(() => null),
  candidate: value<SqlCandidate | null>(() => null),
  /** Set by `generate` when the model asks; read by the `clarify` interrupt. */
  clarification: value<{ question: string; options: string[] } | null>(() => null),
  clarificationsUsed: value<number>(() => 0),
  clarificationAnswers: value<{ question: string; answer: string }[]>(() => []),
  attempts: value<number>(() => 0),
  /** Feedback for the next `generate` call: the failed SQL (if any) and the problem. */
  lastError: value<{ sql: string | null; problem: string } | null>(() => null),
  zeroRowReviewDone: value<boolean>(() => false),
  /** SQL that passed the policy, with the row limit applied (safety stage output). */
  checkedSql: value<string | null>(() => null),
  costEstimate: value<{ cost: number; softLimit: number; needsApproval: boolean } | null>(() => null),
  /** The user's answer at the approval interrupt (named apart from the `approval` node). */
  approvalDecision: value<{ approved: boolean } | null>(() => null),
  result: value<ResultMeta | null>(() => null),
  /** Final answer text (named apart from the `answer` node). */
  answerText: value<string | null>(() => null),
  outcome: value<Outcome | null>(() => null),
  usage: Annotation<UsageTotals>({
    reducer: (a, b) => ({
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      embeddingTokens: a.embeddingTokens + b.embeddingTokens,
      llmRequests: a.llmRequests + b.llmRequests,
    }),
    default: () => ZERO_USAGE,
  }),
  trace: Annotation<TraceEntry[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})

export type State = typeof AgentState.State
export type Update = typeof AgentState.Update
