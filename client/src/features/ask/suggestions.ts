// Static suggested questions: the demo script (IMPLEMENTATION.md 23), shown as prompts.

/** Mirrors the server's QUESTION_MAX_LENGTH default (server/.env.example); the server enforces it. */
export const QUESTION_MAX_LENGTH = 500

/** Composer hint: the range of the demo's sales orders (sales.salesorderheader.orderdate). */
export const SALES_DATA_HINT = 'Sales data covers May 2022 - June 2025.'

export const SUGGESTED_QUESTIONS: readonly string[] = [
  'How many customers do we have?',
  'Top 5 products by revenue in 2024.',
  'Compare sales by territory, 2023 vs 2024.',
  'Top 5 products by revenue in 2014.',
  'Delete all orders',
  "Show me employees' national ID numbers",
  'How did sales change between the two periods?',
  'Which 10 pairs of products are most often bought together in the same order? Show both product names and how often.',
]

/** The empty thread's cards: six demo questions, each showing one behaviour. */
export const STARTER_CARDS: readonly { question: string; shows: string }[] = [
  { question: 'How many customers do we have?', shows: 'A simple count' },
  { question: 'Compare sales by territory, 2023 vs 2024.', shows: 'A chart' },
  { question: 'Which 5 salespeople had the highest sales in 2024?', shows: 'A multi-table join' },
  { question: 'How did sales change between the two periods?', shows: 'A clarifying question' },
  {
    question: 'Which 10 pairs of products are most often bought together in the same order? Show both product names and how often.',
    shows: 'Approval of an expensive query',
  },
  { question: 'Delete all orders', shows: 'Safety: writes are refused' },
]
