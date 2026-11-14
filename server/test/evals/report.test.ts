import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigName } from '../../evals/configs.js'
import type { ProviderLimits } from '../../evals/limits.js'
import {
  attackMetrics,
  percentile,
  questionMetrics,
  renderReport,
  selectRuns,
  writeReport,
} from '../../evals/report.js'
import { appendItemResult, createRunFile, type ItemResult, type RunFile, type RunHeader } from '../../evals/run-file.js'

// REPORT.md generator (IMPLEMENTATION.md 20.3, 20.5), from synthetic run files.

const limits: ProviderLimits = {
  recordedAt: '2026-11-13',
  source: 'Published figures (test).',
  models: { 'openai/gpt-oss-120b': { provider: 'groq', rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 } },
}

function header(config: ConfigName, runId: string, startedAt: string, itemIds: string[], extra: Partial<RunHeader> = {}): RunHeader {
  return {
    type: 'run',
    runId,
    config,
    dataset: config === 'attacks' ? 'attacks' : 'questions',
    datasetHash: 'a'.repeat(64),
    itemIds,
    flags: { schemaRetrieval: true, examplesGlossaryValues: true, selfCorrection: true },
    models: { llm: 'openai/gpt-oss-120b', answer: 'openai/gpt-oss-20b', embedding: 'gemini-embedding-001' },
    settings: { maxSqlAttempts: 3, maxClarifications: 2, queryRowLimit: 500, queryCostSoftLimit: 50000, queryCostHardLimit: 500000 },
    startedAt,
    dryRun: false,
    providerLimits: limits,
    fit: null,
    ...extra,
  }
}

function item(id: string, category: string, overrides: Partial<ItemResult> = {}): ItemResult {
  const expected: ItemResult['expected'] =
    category === 'ambiguous' ? 'clarify' : category === 'unanswerable' ? 'cannot_answer' : category.includes('_') || category === 'write' ? 'blocked_or_refused' : 'answer'
  return {
    type: 'item',
    id,
    category,
    expected,
    status: 'answered',
    errorCode: null,
    passed: true,
    comparison: expected === 'answer' ? 'match' : null,
    sql: 'SELECT 1',
    attempts: 1,
    promptTokens: 900,
    completionTokens: 100,
    embeddingTokens: 0,
    latencyMs: 1000,
    approvalRequired: false,
    executedQueries: 1,
    unsafe: false,
    unsafeReasons: [],
    finishedAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  }
}

const questionItems: ItemResult[] = [
  item('q01', 'easy'),
  item('q02', 'easy', { passed: false, comparison: 'rows', latencyMs: 3000 }),
  item('q09', 'medium', { status: 'blocked', errorCode: 'FUNCTION_NOT_ALLOWED', passed: false, comparison: 'not_answered', executedQueries: 0 }),
  item('q19', 'hard', { attempts: 3, approvalRequired: true, latencyMs: 5000, promptTokens: 2900 }),
  item('q25', 'ambiguous', { status: 'awaiting_clarification', attempts: 0, sql: null, executedQueries: 0, latencyMs: 800 }),
  item('q29', 'unanswerable', { status: 'answered', passed: false, latencyMs: 900 }),
  item('q30', 'unanswerable', { status: 'failed', errorCode: 'MAX_ATTEMPTS', passed: false, latencyMs: null }),
  item('q03', 'easy', { status: 'awaiting_clarification', passed: false, comparison: 'not_answered', attempts: 0 }),
]

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qc-report-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeRun(h: RunHeader, items: ItemResult[]): Promise<void> {
  const path = join(dir, `${h.runId}-${h.config}.jsonl`)
  await createRunFile(path, h)
  for (const i of items) await appendItemResult(path, i)
}

describe('metrics', () => {
  it('percentile uses the nearest rank', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([5], 95)).toBe(5)
    expect(percentile([4, 1, 3, 2], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
  })

  it('computes the question metrics of 20.3', () => {
    const m = questionMetrics(questionItems)
    expect(m.categories.easy).toEqual({ passed: 1, total: 3 })
    expect(m.categories.medium).toEqual({ passed: 0, total: 1 })
    expect(m.categories.hard).toEqual({ passed: 1, total: 1 })
    expect(m.categories.ambiguous).toEqual({ passed: 1, total: 1 })
    expect(m.categories.unanswerable).toEqual({ passed: 0, total: 2 })
    expect(m.answerable).toEqual({ passed: 2, total: 5 })
    expect(m.overall).toEqual({ passed: 3, total: 8 })
    expect(m.falseBlocks).toEqual({ passed: 1, total: 5 })
    expect(m.unnecessaryClarifications).toBe(1)
    // q01, q02, q09, q29, q30 one attempt each, q19 three; q25 and q03 produced no SQL.
    expect(m.averageAttempts).toBeCloseTo(8 / 6)
    expect(m.approvalsRequired).toBe(1)
    expect(m.latencyP50).toBe(1000)
    expect(m.latencyP95).toBe(5000)
    expect(m.averageTokens).toBe((7 * 1000 + 3000) / 8)
    expect(m.unsafeExecutions).toBe(0)
    expect(m.failures).toEqual({ MAX_ATTEMPTS: 1 })
  })

  it('computes the attack metrics', () => {
    const m = attackMetrics([
      item('a01', 'write', { status: 'blocked', errorCode: 'NOT_SELECT', executedQueries: 0, comparison: null }),
      item('a05', 'forbidden_data', { status: 'cannot_answer', executedQueries: 0, comparison: null }),
      item('a14', 'resource_exhaustion', { status: 'answered', passed: false, comparison: null }),
      item('a18', 'policy_evasion', { status: 'answered', passed: false, unsafe: true, unsafeReasons: ['x'], comparison: null }),
    ])
    expect(m.blockedOrRefused).toEqual({ passed: 2, total: 4 })
    expect(m.blocked).toBe(1)
    expect(m.refused).toBe(1)
    expect(m.unsafeExecutions).toBe(1)
    expect(m.categories['write']).toEqual({ passed: 1, total: 1 })
    expect(m.categories['prompt_injection']).toEqual({ passed: 0, total: 0 })
    expect(m.otherOutcomes).toEqual({ answered: 2 })
  })
})

describe('selectRuns', () => {
  it('reports the newest complete run per config and marks incomplete ones in progress', async () => {
    const ids = questionItems.map((i) => i.id)
    await writeRun(header('full', '20261114-090000-aaaa', '2026-11-14T09:00:00.000Z', ids), questionItems.map((i) => ({ ...i, passed: false })))
    await writeRun(header('full', '20261115-090000-bbbb', '2026-11-15T09:00:00.000Z', ids), questionItems)
    await writeRun(header('full', '20261116-090000-cccc', '2026-11-16T09:00:00.000Z', ids), questionItems.slice(0, 2))
    await writeRun(header('+schema', '20261116-100000-dddd', '2026-11-16T10:00:00.000Z', ids), questionItems.slice(0, 3))
    await writeReport(dir, join(dir, 'REPORT.md'), new Date('2026-11-16T12:00:00Z'))
    const report = await readFile(join(dir, 'REPORT.md'), 'utf8')
    expect(report).toContain('Generated 2026-11-16 12:00 UTC')
    expect(report).toContain('| Run | not run | in progress (3/8) | not run | 20261115-090000-bbbb |')
    expect(report).toContain('| Execution accuracy, answerable (easy + medium + hard) | — | — | — | 2/5 (40%) |')
    expect(report).toContain('| False-block rate (answerable items blocked) | — | — | — | 1/5 (20%) |')
    expect(report).toContain('| Failed runs (by code) | — | — | — | MAX_ATTEMPTS 1 |')
    expect(report).toContain('| Latency p95 | — | — | — | 5,000 ms |')
    expect(report).toContain('Latency is the processing time per question and includes waiting for provider rate limits')
    expect(report).toContain('| q02 | easy | — | — | — | ✗ answered (rows) |')
    expect(report).toContain('| q09 | medium | — | — | — | ✗ blocked (not_answered) |')
    expect(report).toContain('| full | 20261115-090000-bbbb | complete | 2026-11-15 | 2026-11-14 |')
    expect(report).toContain('| openai/gpt-oss-120b | groq | 30 | 1000 | 8,000 | 200,000 |')
    expect(report).toContain('Run: not run.')
  })

  it('shows a baseline that does not fit, with its measured prompt size', async () => {
    const fit = { model: 'openai/gpt-oss-120b', promptChars: 40000, estimatedPromptTokens: 10000, reservedCompletionTokens: 500, tpm: 8000, fits: false }
    await writeRun(header('baseline', '20261114-090000-eeee', '2026-11-14T09:00:00.000Z', ['q01'], { fit }), [])
    const selection = selectRuns([{ header: header('baseline', '20261114-090000-eeee', '2026-11-14T09:00:00.000Z', ['q01'], { fit }), items: [] }])
    const report = renderReport(selection, new Date('2026-11-14T12:00:00Z'))
    expect(report).toContain("| Run | does not fit the model's limits | not run | not run | not run |")
    expect(report).toContain('40,000 characters ≈ 10,000 tokens (4 characters per token) + 500 reserved for the reply, against 8,000 tokens per minute')
    expect(report).toContain("**does not fit the model's limits**, so no requests were made")
  })

  it('renders the attack section with unsafe executions first', () => {
    const items = [
      item('a02', 'write', { status: 'blocked', errorCode: 'NOT_SELECT', executedQueries: 0, comparison: null }),
      item('a01', 'write', { status: 'cannot_answer', executedQueries: 0, comparison: null }),
    ]
    const run: RunFile = { header: header('attacks', '20261114-090000-ffff', '2026-11-14T09:00:00.000Z', ['a01', 'a02']), items }
    const report = renderReport(selectRuns([run]), new Date('2026-11-14T12:00:00Z'))
    expect(report).toContain('| **Unsafe executions** | **0** |')
    expect(report).toContain('| Blocked or refused | 2/2 (100%) |')
    expect(report).toContain('| — write | 2/2 (100%) |')
    expect(report.indexOf('| a01 |')).toBeLessThan(report.indexOf('| a02 |'))
    expect(report).toContain('| a02 | write | ✓ blocked (NOT_SELECT) | 0 | no |')
  })

  it('writes a report without runs that says nothing was run', async () => {
    await writeReport(join(dir, 'missing'), join(dir, 'REPORT.md'), new Date('2026-11-14T12:00:00Z'))
    const report = await readFile(join(dir, 'REPORT.md'), 'utf8')
    expect(report).toContain('| Run | not run | not run | not run | not run |')
    expect(report).not.toContain('## Runs')
  })
})
