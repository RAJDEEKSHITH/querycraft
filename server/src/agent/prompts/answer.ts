import { rangeInWords, type DataRange } from '../date-range.js'
import type { ChatMessage } from '../llm.js'

// Prompt of the `answer` node (IMPLEMENTATION.md 12.3, 17): question, SQL, column
// names, row count, truncation flag and at most the first 20 masked rows.

export const ANSWER_MAX_ROWS = 20

export const ANSWER_SYSTEM_PROMPT = `You answer a question from the result of a SQL query.
Write one to three plain sentences. State only facts present in the rows: values, names, and comparisons of two values in the same row. Do not compute totals, averages, differences or rankings across rows, and do not use words like largest, only, all, most or none unless a column in the rows states it. If the question asks for such a summary, describe a few rows and point to the table.
If there are more than 5 rows, describe at most three notable rows and refer to the table for the rest; do not list every row.
Round decimal numbers to 2 decimals; keep whole numbers as they are.
If there are no rows, say that nothing matched. Say that rows were cut off only when the message says "truncated: yes".
Do not repeat the SQL.`

export interface AnswerPromptInput {
  question: string
  sql: string
  columns: readonly string[]
  rows: readonly unknown[][]
  rowCount: number
  truncated: boolean
  /** Set when a first query returned no rows and its date column's range was looked up (12.3). */
  dataRange?: DataRange | null | undefined
  /** The final SQL's assumptions; sent only together with a data range. */
  assumptions?: readonly string[] | undefined
  /** The period the user chose at the date-range clarification; sent only with a data range. */
  periodChoice?: string | null | undefined
}

/** Sent only with a data range and no period choice, so every other answer prompt stays unchanged. */
export const DATA_RANGE_RULE =
  'A first query returned no rows. If the question asks for a period outside the data range, start by saying there is no data for that period and give the data range in words as written above. If the asked period is inside the data range, say that nothing matched.'

/**
 * The user chose another period at the date-range clarification and the rows are for
 * it: the code knows this case, so the instruction is direct, not conditional.
 */
export function chosenPeriodRule(range: DataRange, choice: string): string {
  return `The question's period has no data, so the user chose "${choice}" instead and the rows are for "${choice}". Start with one sentence: "There is no data for <the period in the question>; the data covers ${rangeInWords(range)}." Then answer the question for "${choice}" from the rows, naming "${choice}".`
}

function dataRangeLines(range: DataRange, assumptions: readonly string[], periodChoice: string | null, rowCount: number): string[] {
  const chosen = periodChoice !== null && rowCount > 0
  return [
    `Data range: ${range.schema}.${range.table}.${range.column} has values from ${range.min} to ${range.max} (${rangeInWords(range)})`,
    ...(periodChoice === null ? [] : [`Period chosen by the user instead: ${periodChoice}`]),
    `Assumptions: ${assumptions.length === 0 ? 'none' : assumptions.join(' | ')}`,
    chosen ? chosenPeriodRule(range, periodChoice) : DATA_RANGE_RULE,
  ]
}

export function buildAnswerMessages(input: AnswerPromptInput): ChatMessage[] {
  const shown = input.rows.slice(0, ANSWER_MAX_ROWS)
  const content = [
    `Question: ${input.question}`,
    `SQL: ${input.sql}`,
    `Columns: ${input.columns.join(', ')}`,
    `Rows returned: ${input.rowCount}; shown: ${shown.length}; truncated: ${input.truncated ? 'yes' : 'no'}`,
    `Rows (JSON): ${JSON.stringify(shown)}`,
    ...(input.dataRange == null ? [] : dataRangeLines(input.dataRange, input.assumptions ?? [], input.periodChoice ?? null, input.rowCount)),
  ].join('\n')
  return [
    { role: 'system', content: ANSWER_SYSTEM_PROMPT },
    { role: 'user', content },
  ]
}
