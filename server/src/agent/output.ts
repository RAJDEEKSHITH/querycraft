import { z } from 'zod'
import type { StructuredOutput } from './llm.js'

// Structured output of `generate` (IMPLEMENTATION.md 12.4). Groq's strict JSON-schema
// mode needs an object at the root, so the 12.4 union is sent wrapped in one field,
// `{ result: … }` (user decision, M3 Q1); the inner value is validated with exactly
// the 12.4 schema. After MAX_CLARIFICATIONS the `clarify` variant is left out, so
// the model must choose an interpretation and state it in `assumptions`.

const sqlAction = z.object({
  action: z.literal('sql'),
  sql: z.string(),
  tablesUsed: z.array(z.string()),
  assumptions: z.array(z.string()),
  explanation: z.string(),
})

const clarifyAction = z.object({
  action: z.literal('clarify'),
  question: z.string(),
  options: z.array(z.string()).min(2).max(4),
})

const cannotAnswerAction = z.object({ action: z.literal('cannot_answer'), reason: z.string() })

/** The 12.4 schema. */
export const generateOutputSchema = z.discriminatedUnion('action', [sqlAction, clarifyAction, cannotAnswerAction])

export type GenerateOutput = z.infer<typeof generateOutputSchema>
export type SqlCandidate = z.infer<typeof sqlAction>

const withClarify: StructuredOutput<{ result: GenerateOutput }> = {
  name: 'generate_result',
  schema: z.object({ result: generateOutputSchema }),
}

const withoutClarify: StructuredOutput<{ result: GenerateOutput }> = {
  name: 'generate_result',
  schema: z.object({ result: z.discriminatedUnion('action', [sqlAction, cannotAnswerAction]) }),
}

/** The wrapped schema for one `generate` call. */
export function generateOutput(clarifyAllowed: boolean): StructuredOutput<{ result: GenerateOutput }> {
  return clarifyAllowed ? withClarify : withoutClarify
}
