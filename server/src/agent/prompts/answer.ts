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
}

export function buildAnswerMessages(input: AnswerPromptInput): ChatMessage[] {
  const shown = input.rows.slice(0, ANSWER_MAX_ROWS)
  const content = [
    `Question: ${input.question}`,
    `SQL: ${input.sql}`,
    `Columns: ${input.columns.join(', ')}`,
    `Rows returned: ${input.rowCount}; shown: ${shown.length}; truncated: ${input.truncated ? 'yes' : 'no'}`,
    `Rows (JSON): ${JSON.stringify(shown)}`,
  ].join('\n')
  return [
    { role: 'system', content: ANSWER_SYSTEM_PROMPT },
    { role: 'user', content },
  ]
}
