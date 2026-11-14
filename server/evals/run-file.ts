import { randomBytes } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CONFIG_NAMES, type ConfigName } from './configs.js'
import { providerLimitsSchema } from './limits.js'

// One run = one JSON Lines file `<runId>-<config>.jsonl` (IMPLEMENTATION.md 20.5):
// a header line, then one line per finished item, appended as items finish so a
// stopped run can be resumed. Result rows are never written (10.3).

export const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/

const count = z.number().int().nonnegative()

export const fitCheckSchema = z.strictObject({
  model: z.string(),
  promptChars: count,
  estimatedPromptTokens: count,
  reservedCompletionTokens: count,
  tpm: z.number().int().positive(),
  fits: z.boolean(),
})

export const runHeaderSchema = z.strictObject({
  type: z.literal('run'),
  runId: z.string().regex(RUN_ID_PATTERN),
  config: z.enum(CONFIG_NAMES),
  dataset: z.enum(['questions', 'attacks']),
  datasetHash: z.string().regex(/^[0-9a-f]{64}$/),
  itemIds: z.array(z.string()).min(1),
  flags: z.strictObject({ schemaRetrieval: z.boolean(), examplesGlossaryValues: z.boolean(), selfCorrection: z.boolean() }),
  models: z.strictObject({ llm: z.string(), answer: z.string(), embedding: z.string() }),
  settings: z.strictObject({
    maxSqlAttempts: count,
    maxClarifications: count,
    queryRowLimit: count,
    queryCostSoftLimit: z.number(),
    queryCostHardLimit: z.number(),
  }),
  startedAt: z.iso.datetime(),
  dryRun: z.boolean(),
  providerLimits: providerLimitsSchema,
  /** Baseline fit check (20.4); null for configs that send retrieved context only. */
  fit: fitCheckSchema.nullable(),
})

export const COMPARISONS = ['match', 'column_count', 'row_count', 'rows', 'not_answered', 'gold_failed'] as const

export const itemResultSchema = z.strictObject({
  type: z.literal('item'),
  id: z.string(),
  category: z.string(),
  expected: z.enum(['answer', 'clarify', 'cannot_answer', 'blocked_or_refused']),
  /** Final question status, e.g. answered, awaiting_clarification, blocked, failed. */
  status: z.string(),
  /** Failure code, or the safety rule of a blocked run. */
  errorCode: z.string().nullable(),
  /** The item met its expectation (correct result, clarified, refused, blocked). */
  passed: z.boolean(),
  /** Execution-accuracy comparison; answerable items only. */
  comparison: z.enum(COMPARISONS).nullable(),
  sql: z.string().nullable(),
  attempts: count,
  promptTokens: count,
  completionTokens: count,
  embeddingTokens: count,
  latencyMs: count.nullable(),
  approvalRequired: z.boolean(),
  executedQueries: count,
  unsafe: z.boolean(),
  unsafeReasons: z.array(z.string()),
  finishedAt: z.iso.datetime(),
})

export type FitCheck = z.infer<typeof fitCheckSchema>
export type RunHeader = z.infer<typeof runHeaderSchema>
export type ItemResult = z.infer<typeof itemResultSchema>
export type Comparison = (typeof COMPARISONS)[number]

export interface RunFile {
  header: RunHeader
  items: ItemResult[]
}

export function newRunId(now: Date): string {
  const iso = now.toISOString() // 2026-11-13T21:05:09.123Z
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`
  return `${stamp}-${randomBytes(2).toString('hex')}`
}

export function runFilePath(dir: string, runId: string, config: ConfigName): string {
  return join(dir, `${runId}-${config}.jsonl`)
}

/** Parses a run file; throws with the line number on the first invalid line. */
export function parseRunFile(content: string, label: string): RunFile {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '')
  const parseLine = <T>(schema: z.ZodType<T>, index: number): T => {
    let json: unknown
    try {
      json = JSON.parse(lines[index] ?? '')
    } catch {
      throw new Error(`${label} line ${index + 1}: not valid JSON`)
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(`${label} line ${index + 1}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`)
    }
    return parsed.data
  }
  if (lines.length === 0) throw new Error(`${label} is empty`)
  const header = parseLine(runHeaderSchema, 0)
  const items = lines.slice(1).map((_, i) => parseLine(itemResultSchema, i + 1))
  return { header, items }
}

export async function readRunFile(path: string): Promise<RunFile> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    throw new Error(`Run file not found: ${path}`)
  }
  return parseRunFile(content, path)
}

/** Creates the run file with its header; fails if the file already exists. */
export async function createRunFile(path: string, header: RunHeader): Promise<void> {
  await writeFile(path, `${JSON.stringify(runHeaderSchema.parse(header))}\n`, { flag: 'wx' })
}

export async function appendItemResult(path: string, item: ItemResult): Promise<void> {
  await appendFile(path, `${JSON.stringify(itemResultSchema.parse(item))}\n`)
}

/** Ids of items that are finished in a run (each id once). */
export function finishedIds(run: RunFile): Set<string> {
  return new Set(run.items.map((i) => i.id))
}

/** All dataset items of the run are finished (or the config did not fit and nothing runs). */
export function isComplete(run: RunFile): boolean {
  if (run.header.fit?.fits === false) return true
  const done = finishedIds(run)
  return run.header.itemIds.every((id) => done.has(id))
}
