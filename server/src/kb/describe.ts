import { z } from 'zod'
import type { LlmClient } from '../agent/llm.js'
import { DESCRIBE_TABLES_SYSTEM_PROMPT, describeTableEntry } from '../agent/prompts/describe-tables.js'
import { compactColumns } from '../retrieval/table-text.js'
import type { SchemaFile, TableDescriptions } from './seed-files.js'

// kb:describe (IMPLEMENTATION.md 11.2): drafts descriptions only for tables that
// have none yet, in batches. After each batch the caller saves the drafts, so a
// stopped run (quota, invalid reply) keeps its progress and can simply be re-run.

export const DESCRIBE_BATCH_SIZE = 10

export function tableKey(table: { schema: string; table: string }): string {
  return `${table.schema}.${table.table}`
}

/** The JSON object in a reply, also when the model wrapped it in a code fence. */
export function parseDescriptionsReply(text: string, expectedKeys: readonly string[]): TableDescriptions {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch (err) {
    throw new Error('kb:describe: the model reply is not JSON', { cause: err })
  }
  const shape = z.strictObject(
    Object.fromEntries(expectedKeys.map((k) => [k, z.string().trim().min(1).max(400)])),
  )
  const parsed = shape.safeParse(json)
  if (!parsed.success) {
    throw new Error(`kb:describe: the model reply does not match the requested tables: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export interface DescribeResult {
  descriptions: TableDescriptions
  drafted: number
  remaining: number
}

/**
 * Drafts missing descriptions. `save` is called with the merged descriptions after
 * every batch. Existing descriptions are never changed.
 */
export async function draftMissingDescriptions(
  schema: SchemaFile,
  existing: TableDescriptions,
  llm: LlmClient,
  save: (descriptions: TableDescriptions) => Promise<void>,
): Promise<DescribeResult> {
  const missing = schema.tables.filter((t) => existing[tableKey(t)] === undefined)
  let descriptions: TableDescriptions = { ...existing }
  let drafted = 0
  for (let start = 0; start < missing.length; start += DESCRIBE_BATCH_SIZE) {
    const batch = missing.slice(start, start + DESCRIBE_BATCH_SIZE)
    const keys = batch.map(tableKey)
    const user = batch
      .map((t) => describeTableEntry(tableKey(t), t.comment, compactColumns(t.columns)))
      .join('\n\n')
    const reply = await llm.chat(
      [
        { role: 'system', content: DESCRIBE_TABLES_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      { source: 'app', model: 'main' },
    )
    const drafts = parseDescriptionsReply(reply.text, keys)
    descriptions = Object.fromEntries(Object.entries({ ...descriptions, ...drafts }).sort(([a], [b]) => a.localeCompare(b)))
    drafted += batch.length
    await save(descriptions)
  }
  return { descriptions, drafted, remaining: missing.length - drafted }
}
