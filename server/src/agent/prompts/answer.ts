import type { ChatMessage } from '../llm.js'

// Prompt of the `answer` node (IMPLEMENTATION.md 12.3, 17): question, SQL, column
// names, row count, truncation flag and at most the first 20 masked rows.

export const ANSWER_MAX_ROWS = 20

export const ANSWER_SYSTEM_PROMPT = `You answer a question from the result of a SQL query.
Write one to three plain sentences. Use only the data shown; do not guess beyond it.
If there are no rows, say that nothing matched. If the result was truncated or more rows exist than shown, say the answer covers only the rows shown.
Do not repeat the SQL.`

export interface AnswerPromptInput {
  question: string
  sql: string
  columns: readonly string[]
  rows: readonly unknown[][]
  rowCount: number
  truncated: boolean
}

export function buildAnswerMessages(input: AnswerPromptInput): ChatMessage[] {
  const shown = input.rows.slice(0, ANSWER_MAX_ROWS)
  const content = [
    `Question: ${input.question}`,
    `SQL: ${input.sql}`,
    `Columns: ${input.columns.join(', ')}`,
    `Rows returned: ${input.rowCount}${input.truncated ? ' (truncated at the row limit)' : ''}; shown: ${shown.length}`,
    `Rows (JSON): ${JSON.stringify(shown)}`,
  ].join('\n')
  return [
    { role: 'system', content: ANSWER_SYSTEM_PROMPT },
    { role: 'user', content },
  ]
}
