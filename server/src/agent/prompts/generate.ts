import type { ChatMessage } from '../llm.js'
import type { RetrievedContext } from '../../services/retrieval.service.js'
import { compactColumns } from '../../retrieval/table-text.js'

// Prompt of the `generate` node (IMPLEMENTATION.md 12.3, 12.5). Compact by design
// (section 17): retrieved context only, abbreviated types, no comments. Changes
// that affect evaluation results are recorded in NOTES.md.

export const GENERATE_SYSTEM_PROMPT = `You turn questions about a PostgreSQL database into SQL.
Reply with JSON: {"result": {...}} where result is one of
- {"action":"sql","sql":...,"tablesUsed":[...],"assumptions":[...],"explanation":...}
- {"action":"clarify","question":...,"options":[2 to 4 short options]}
- {"action":"cannot_answer","reason":...}
SQL rules:
- PostgreSQL only. Exactly one SELECT statement (WITH is fine). No comments.
- Schema-qualify every table (schema.table). Use only the tables and columns listed in the context; never invent columns.
- Apply a business definition exactly when the question uses its term.
- Use the stored values given in the context for filters, spelled exactly as given.
- tablesUsed lists every schema.table the SQL reads. assumptions lists each interpretation you chose; empty if none.
- explanation says in one or two plain sentences what the query does.
When to ask or refuse:
- clarify only when reasonable interpretations would materially change the result and the question implies none of them.
- cannot_answer when the data in the context does not contain what is asked.`

export const ZERO_ROW_REVIEW =
  'The query returned no rows. Check the filters, joins and values against the context. If the SQL is right, return the same SQL.'

export const NO_MORE_CLARIFICATIONS =
  'Do not ask for clarification: choose the most reasonable interpretation and state it in assumptions.'

export interface GeneratePromptInput {
  question: string
  context: RetrievedContext
  conversation: readonly { question: string; sql: string }[]
  clarifications: readonly { question: string; answer: string }[]
  previous: { sql: string; problem: string } | null
  /** Plain feedback without a previous SQL (e.g. a reply that did not match the format). */
  feedback: string | null
  clarifyAllowed: boolean
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}:`, ...lines, '']
}

export function buildGenerateMessages(input: GeneratePromptInput): ChatMessage[] {
  const { context } = input
  const parts = [
    ...section(
      'Tables',
      context.tables.map((t) => `${t.schema}.${t.table}: ${t.description} | Columns: ${compactColumns(t.columns)}`),
    ),
    ...section(
      'Business definitions',
      context.glossary.map((g) => `- ${g.term}: ${g.definition}${g.sqlHint === null ? '' : ` (SQL: ${g.sqlHint})`}`),
    ),
    ...section(
      'Verified examples',
      context.examples.flatMap((e) => [`Q: ${e.question}`, `SQL: ${e.sql}`]),
    ),
    ...section(
      'Stored values',
      context.values.map((v) => `- ${v.schema}.${v.table}.${v.column} = '${v.value.replaceAll("'", "''")}'`),
    ),
    ...section(
      'Earlier questions in this conversation',
      input.conversation.flatMap((t) => [`Q: ${t.question}`, `SQL: ${t.sql}`]),
    ),
    ...section(
      'Clarifications from the user',
      input.clarifications.flatMap((c) => [`Q: ${c.question}`, `A: ${c.answer}`]),
    ),
    ...(input.previous === null ? [] : ['Previous attempt:', `SQL: ${input.previous.sql}`, `Problem: ${input.previous.problem}`, '']),
    ...(input.feedback === null ? [] : [`Previous reply problem: ${input.feedback}`, '']),
    ...(input.clarifyAllowed ? [] : [NO_MORE_CLARIFICATIONS, '']),
    `Question: ${input.question}`,
  ]
  return [
    { role: 'system', content: GENERATE_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ]
}
