import type { ChatMessage } from '../llm.js'
import type { RetrievedContext } from '../../services/retrieval.service.js'
import { compactColumns } from '../../retrieval/table-text.js'
import { completeYears, rangeInWords, rangeOptions, type DataRange } from '../date-range.js'

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
- Each clarify option is one complete interpretation the user can pick without being asked again: name exact periods, values or definitions (for example "2023 vs 2024", "First half vs second half of 2024"), never a placeholder such as "two years you choose".
- cannot_answer when the data in the context does not contain what is asked.`

export const ZERO_ROW_REVIEW =
  'The query returned no rows. Check the filters, joins and values against the context. If the SQL is right, return the same SQL.'

/**
 * The zero-row review when the SQL filters on a date column whose range is known
 * (12.3). A period outside the data is never replaced silently: the model asks the
 * user which period to use (concrete options), or, when no clarification is left,
 * keeps the SQL so the answer states the range.
 */
export function zeroRowReviewWithRange(range: DataRange, clarifyAllowed: boolean): string {
  const years = completeYears(range)
  const words = rangeInWords(range)
  const yearText = years === null ? '' : `; complete calendar years: ${years.first} to ${years.last}`
  const outside = clarifyAllowed
    ? `If the question asks for a period outside this range, do not change the period yourself and do not return the same SQL: reply with clarify. The clarify question is "There is no data for <period>; the data covers ${words}. Which period should I use?", with <period> replaced by the period the question names, and the options are: ${rangeOptions(range).map((o) => `"${o}"`).join(', ')}.`
    : 'If the question asks for a period outside this range, do not change the period: return the same SQL; the answer will state the data range.'
  return [
    ZERO_ROW_REVIEW,
    `The filtered column ${range.schema}.${range.table}.${range.column} has values from ${range.min} to ${range.max} (${words})${yearText}.`,
    outside,
  ].join(' ')
}

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
  /** The user's answer to the date-range clarification: it replaces the question's period (12.3). */
  periodChoice: { range: DataRange; answer: string } | null
}

/** Tells the model that the user's choice replaces the question's period (12.3). */
export function periodChoiceLine(choice: { range: DataRange; answer: string }): string {
  const { range } = choice
  return `Period chosen by the user: the question's period has no data (${range.schema}.${range.table}.${range.column} covers ${rangeInWords(choice.range)}), so the user chose "${choice.answer}" instead. Write the SQL for that period, not the question's period, and do not reply cannot_answer because of the question's period.`
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
    ...(input.periodChoice === null ? [] : [periodChoiceLine(input.periodChoice), '']),
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
