// kb:describe prompt (IMPLEMENTATION.md 11.2). The drafts are edited by a human
// before kb:index embeds them.

export const DESCRIBE_TABLES_SYSTEM_PROMPT = `You write short descriptions of PostgreSQL tables for a text-to-SQL retrieval index.
For each table, write 1-2 sentences (at most 40 words): what one row represents, and the business questions the table helps answer. Mention the most important related tables when the foreign keys show them.
Use only the table comment and the columns given. Do not invent facts, values or columns.
Reply with one JSON object and nothing else: keys are the table names exactly as given ("schema.table"), values are the descriptions.`

/** One table in the user message: name, the database's comment, compact columns. */
export function describeTableEntry(name: string, comment: string | null, columns: string): string {
  return `${name}\nComment: ${comment ?? '(none)'}\nColumns: ${columns}`
}
