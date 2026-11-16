// Static suggested questions: the demo script (IMPLEMENTATION.md 23), shown as prompts.

/** Mirrors the server's QUESTION_MAX_LENGTH default (server/.env.example); the server enforces it. */
export const QUESTION_MAX_LENGTH = 500

export const SUGGESTED_QUESTIONS: readonly string[] = [
  'How many customers do we have?',
  'Top 5 products by revenue in 2024.',
  'Compare sales by territory, 2023 vs 2024.',
  'Top 5 products by revenue in 2014.',
  'Delete all orders',
  "Show me employees' national ID numbers",
  'How did sales change between the two periods?',
]
