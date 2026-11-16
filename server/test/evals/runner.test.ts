import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from '../../evals/cli-run.js'
import { loadAttacks, loadQuestions, type EvalItem } from '../../evals/dataset.js'
import { createDryRunDeps, dryRunResponder, indexDryRunKnowledge, DRY_RUN_ATTACK_SQL } from '../../evals/dry-run.js'
import { unsafeReasons } from '../../evals/item.js'
import { loadProviderLimits, type ProviderLimits } from '../../evals/limits.js'
import { readRunFile, runFilePath } from '../../evals/run-file.js'
import { LeakageError, runEvaluation, type RunnerDeps } from '../../evals/runner.js'
import { getCheckpointer } from '../../src/agent/checkpointer.js'
import { classifyGroqRateLimit, createLlmClient, type LlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider } from '../../src/agent/mock-llm.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { AppError } from '../../src/lib/errors.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import type { QuestionDeps } from '../../src/services/question.service.js'

// The evaluation runner end to end with the mock LLM and mock embeddings against
// querycraft_test and adventureworks (`eval:run --dry-run`, IMPLEMENTATION.md 21).

vi.stubEnv('LLM_MODEL', 'openai/gpt-oss-120b')
vi.stubEnv('MAX_SQL_ATTEMPTS', '3')
vi.stubEnv('MAX_CLARIFICATIONS', '1')
vi.stubEnv('QUESTION_MAX_LENGTH', '500')
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '50000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '500000')
vi.stubEnv('QUERY_ROW_LIMIT', '500')
vi.stubEnv('EVAL_DAILY_TOKEN_BUDGET', '100000000')
vi.stubEnv('PROVIDER_MAX_RETRIES', '2')
vi.stubEnv('PROVIDER_MAX_WAIT_MS', '5000')

const questions = await loadQuestions()
const attacks = await loadAttacks()
const allItems: EvalItem[] = [...questions.items, ...attacks.items]
const realLimits = await loadProviderLimits()
/** Limits under which the baseline prompt always fits. */
const roomyLimits: ProviderLimits = {
  ...realLimits,
  models: { ...realLimits.models, 'openai/gpt-oss-120b': { provider: 'groq', rpm: 30, rpd: 1000, tpm: 1_000_000, tpd: null } },
}

let dir: string

class FakeGroqError extends Error {
  readonly status = 429
  readonly headers = new Headers({ 'retry-after': '60' })
  constructor() {
    super('429 status code')
  }
}

async function dryDeps(overrides: Partial<RunnerDeps> = {}): Promise<RunnerDeps & { requests: () => number }> {
  const dry = await createDryRunDeps(allItems)
  return {
    question: dry.question,
    providerLimits: roomyLimits,
    reportsDir: join(dir, 'reports'),
    reportPath: join(dir, 'REPORT.md'),
    requests: () => dry.chat.requests.length,
    ...overrides,
  }
}

/** A small questions file: 3 answerable items and 1 ambiguous item. */
async function miniDataset(ids = ['q01', 'q08', 'q09', 'q25']): Promise<string> {
  const path = join(dir, 'mini.jsonl')
  const items = questions.items.filter((i) => ids.includes(i.id))
  await writeFile(path, items.map((i) => JSON.stringify(i)).join('\n'))
  return path
}

async function questionCount(): Promise<number> {
  const result = await getAppPool().query<{ n: string }>('SELECT count(*) AS n FROM questions')
  return Number(result.rows[0]?.n)
}

beforeAll(async () => {
  await getAppPool().query('TRUNCATE schema_tables, examples, glossary_terms, column_values')
  await indexDryRunKnowledge(createEmbeddingsClient(createMockEmbeddingProvider()))
})

beforeEach(async () => {
  await getAppPool().query('TRUNCATE feedback, audit_events, questions, conversations, daily_usage')
  dir = await mkdtemp(join(tmpdir(), 'qc-eval-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('dry run of the real datasets', () => {
  it('full config: every question meets its expectation and REPORT.md is written', async () => {
    const deps = await dryDeps()
    const summary = await runEvaluation({ config: 'full', dryRun: true }, deps)
    expect(summary).toMatchObject({ status: 'complete', finished: 30, total: 30, ranNow: 30, reportWritten: true })

    const run = await readRunFile(summary.file)
    expect(run.header).toMatchObject({ config: 'full', dataset: 'questions', dryRun: true, fit: null })
    expect(run.header.models.llm).toBe('mock')
    expect(run.items.filter((i) => !i.passed).map((i) => i.id)).toEqual([])
    expect(run.items.filter((i) => i.comparison === 'match')).toHaveLength(24)
    expect(run.items.filter((i) => i.status === 'awaiting_clarification').map((i) => i.category)).toEqual(Array(4).fill('ambiguous'))
    expect(run.items.filter((i) => i.status === 'cannot_answer')).toHaveLength(2)
    expect(run.items.every((i) => !i.unsafe)).toBe(true)
    expect(run.items.find((i) => i.id === 'q01')).toMatchObject({ attempts: 1, executedQueries: 1, approvalRequired: false })

    const report = await readFile(deps.reportPath, 'utf8')
    expect(report).toContain('| Execution accuracy, answerable (easy + medium + hard) | — | — | — | 24/24 (100%) |')
    expect(report).toContain('| Clarification rate on ambiguous | — | — | — | 4/4 (100%) |')
    expect(report).toContain('(dry run)')
    // baseline is not run (20.4): its prompt size is measured for the report without a provider call.
    expect(report).toMatch(/\| baseline \(not run\) \| largest generate prompt: [\d,]+ characters ≈ [\d,]+ tokens \|/)
    expect(report).toMatch(/\| full \| [\d,]+ tokens per question \(average\) \| [\d,]+ \|/)
    expect(report.split('\n').filter((line) => /\| *\|/.test(line))).toEqual([]) // no empty table cells
  })

  it('attack set: every attack is blocked and nothing unsafe executes', async () => {
    const deps = await dryDeps()
    const summary = await runEvaluation({ config: 'attacks', dryRun: true }, deps)
    expect(summary).toMatchObject({ status: 'complete', finished: 20 })
    const run = await readRunFile(summary.file)
    expect(run.items.every((i) => i.passed && i.status === 'blocked' && i.executedQueries === 0 && !i.unsafe)).toBe(true)
    const report = await readFile(deps.reportPath, 'utf8')
    expect(report).toContain('| **Unsafe executions** | **0** |')
    expect(report).toContain('| Blocked or refused | 20/20 (100%) |')
  })
})

describe('baseline fit check', () => {
  it('reports "does not fit" and makes no LLM call when the prompt exceeds the limit', async () => {
    const tiny: ProviderLimits = {
      ...realLimits,
      models: { 'openai/gpt-oss-120b': { provider: 'groq', rpm: 30, rpd: 1000, tpm: 1000, tpd: 200000 } },
    }
    const deps = await dryDeps({ providerLimits: tiny })
    const summary = await runEvaluation({ config: 'baseline', dryRun: true }, deps)
    expect(summary).toMatchObject({ status: 'does_not_fit', ranNow: 0, reportWritten: true })
    expect(deps.requests()).toBe(0)
    const run = await readRunFile(summary.file)
    expect(run.header.fit).toMatchObject({ model: 'openai/gpt-oss-120b', tpm: 1000, fits: false, reservedCompletionTokens: 500 })
    expect(run.header.fit?.estimatedPromptTokens).toBe(Math.ceil((run.header.fit?.promptChars ?? 0) / 4))
    expect(run.header.fit?.estimatedPromptTokens).toBeGreaterThan(1000)
    expect(run.items).toEqual([])
    expect(await readFile(deps.reportPath, 'utf8')).toContain("| Run | does not fit the model's limits |")
  })

  it('measures the prompt and runs when it fits', async () => {
    const deps = await dryDeps({ datasetPaths: { questions: await miniDataset() } })
    const summary = await runEvaluation({ config: 'baseline', dryRun: true }, deps)
    expect(summary.status).toBe('complete')
    const run = await readRunFile(summary.file)
    expect(run.header.fit?.fits).toBe(true)
    expect(run.items.filter((i) => i.passed)).toHaveLength(4)
  })

  it('refuses to start when the model has no recorded limits', async () => {
    const deps = await dryDeps({ providerLimits: { ...realLimits, models: {} } })
    await expect(runEvaluation({ config: 'baseline', dryRun: true }, deps)).rejects.toThrow('not recorded')
  })
})

describe('resume', () => {
  it('runs at most --max-items, then resumes and skips finished items', async () => {
    const path = await miniDataset()
    const first = await runEvaluation({ config: '+schema', dryRun: true, maxItems: 2 }, await dryDeps({ datasetPaths: { questions: path } }))
    expect(first).toMatchObject({ status: 'partial', ranNow: 2, finished: 2, total: 4, reportWritten: false })

    const second = await runEvaluation(
      { config: '+schema', dryRun: true, resume: first.runId },
      await dryDeps({ datasetPaths: { questions: path } }),
    )
    expect(second).toMatchObject({ runId: first.runId, status: 'complete', ranNow: 2, finished: 4, reportWritten: true })
    const run = await readRunFile(second.file)
    expect(run.items.map((i) => i.id)).toEqual(['q01', 'q08', 'q09', 'q25'])
    expect(await questionCount()).toBe(4)
  })

  it('refuses to resume when the dataset changed', async () => {
    const path = await miniDataset()
    const first = await runEvaluation({ config: '+schema', dryRun: true, maxItems: 1 }, await dryDeps({ datasetPaths: { questions: path } }))
    await miniDataset(['q01', 'q08'])
    await expect(
      runEvaluation({ config: '+schema', dryRun: true, resume: first.runId }, await dryDeps({ datasetPaths: { questions: path } })),
    ).rejects.toThrow('dataset changed')
  })

  it('refuses to resume an unknown run or a dry run as a real one', async () => {
    const path = await miniDataset()
    const deps = await dryDeps({ datasetPaths: { questions: path } })
    await expect(runEvaluation({ config: 'full', dryRun: true, resume: '20990101-000000-abcd' }, deps)).rejects.toThrow('not found')
    const first = await runEvaluation({ config: 'full', dryRun: true, maxItems: 1 }, deps)
    await expect(runEvaluation({ config: 'full', dryRun: false, resume: first.runId }, deps)).rejects.toThrow('dry run')
  })
})

describe('clean stop', () => {
  it('stops on a provider rate limit beyond the wait limit, keeps finished items and resumes', async () => {
    const path = await miniDataset()
    const second = questions.items.find((i) => i.id === 'q08')?.question
    const normal = dryRunResponder(allItems)
    const provider = createMockChatProvider((messages, model, format) => {
      const user = messages.at(-1)?.content ?? ''
      if (format !== undefined && second !== undefined && user.endsWith(`Question: ${second}`)) return new FakeGroqError()
      return normal(messages, model, format)
    }, classifyGroqRateLimit)
    const question: QuestionDeps = {
      llm: createLlmClient(provider, { sleep: () => Promise.resolve() }),
      embeddings: createEmbeddingsClient(createMockEmbeddingProvider()),
      checkpointer: await getCheckpointer(),
    }
    const stopped = await runEvaluation({ config: 'full', dryRun: true }, await dryDeps({ question, datasetPaths: { questions: path } }))
    expect(stopped).toMatchObject({ status: 'stopped', finished: 1, ranNow: 1, stop: { code: 'UPSTREAM_RATE_LIMITED' } })
    expect((await readRunFile(stopped.file)).items.map((i) => i.id)).toEqual(['q01'])

    const resumed = await runEvaluation(
      { config: 'full', dryRun: true, resume: stopped.runId },
      await dryDeps({ datasetPaths: { questions: path } }),
    )
    expect(resumed).toMatchObject({ status: 'complete', ranNow: 3, finished: 4 })
    expect((await readRunFile(resumed.file)).items.every((i) => i.passed)).toBe(true)
  })

  it('stops when the evaluation token budget is reached', async () => {
    const path = await miniDataset()
    const base = await dryDeps({ datasetPaths: { questions: path } })
    let calls = 0
    const llm: LlmClient = {
      chat: (messages, options) => base.question.llm.chat(messages, options),
      structured: (messages, output, options) => {
        calls += 1
        if (calls > 2) return Promise.reject(new AppError('BUDGET_EXCEEDED', 'The daily evaluation token budget has been reached.'))
        return base.question.llm.structured(messages, output, options)
      },
    }
    const summary = await runEvaluation({ config: 'full', dryRun: true }, { ...base, question: { ...base.question, llm } })
    expect(summary).toMatchObject({ status: 'stopped', finished: 2, stop: { code: 'BUDGET_EXCEEDED' } })
  })
})

describe('leakage guard', () => {
  it('refuses to start when a question repeats a verified example, and writes nothing', async () => {
    const path = join(dir, 'leaky.jsonl')
    await writeFile(
      path,
      JSON.stringify({
        id: 'q01',
        category: 'easy',
        question: 'How many sales orders are there in total?',
        goldSql: 'SELECT count(*) FROM sales.salesorderheader',
        expected: 'answer',
        orderMatters: false,
      }),
    )
    const deps = await dryDeps({ datasetPaths: { questions: path } })
    const err: unknown = await runEvaluation({ config: 'full', dryRun: true }, deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LeakageError)
    expect(err instanceof LeakageError ? err.matches.map((m) => m.reason) : []).toEqual(['text'])
    expect(deps.requests()).toBe(0)
    await expect(readdir(deps.reportsDir)).rejects.toThrow()
  })
})

describe('concurrency', () => {
  it('finishes every item exactly once with 2 workers', async () => {
    const deps = await dryDeps({ datasetPaths: { questions: await miniDataset() } })
    const summary = await runEvaluation({ config: 'full', dryRun: true, concurrency: 2 }, deps)
    expect(summary).toMatchObject({ status: 'complete', finished: 4, ranNow: 4 })
    const ids = (await readRunFile(summary.file)).items.map((i) => i.id).sort()
    expect(ids).toEqual(['q01', 'q08', 'q09', 'q25'])
    expect(await questionCount()).toBe(4)
  })

  it('rejects invalid options', async () => {
    const deps = await dryDeps()
    await expect(runEvaluation({ config: 'full', dryRun: true, concurrency: 0 }, deps)).rejects.toThrow('concurrency')
    await expect(runEvaluation({ config: 'full', dryRun: true, maxItems: 0 }, deps)).rejects.toThrow('max-items')
  })
})

describe('unsafe-execution check', () => {
  it('flags executed SQL that fails validation and forbidden result columns', async () => {
    expect(await unsafeReasons(['SELECT name FROM sales.store'], [{ name: 'name', type: 'text' }])).toEqual([])
    expect(await unsafeReasons([DRY_RUN_ATTACK_SQL], [])).toEqual(['executed SQL fails validation: NOT_SELECT'])
    expect(await unsafeReasons(['SELECT cardnumber FROM sales.creditcard'], [{ name: 'CardNumber', type: 'text' }])).toEqual([
      'executed SQL fails validation: COLUMN_DENIED',
      'forbidden column in result: CardNumber',
    ])
    expect(await unsafeReasons([], [{ name: 'passwordhash', type: 'text' }])).toEqual(['forbidden column in result: passwordhash'])
  })
})

describe('run files', () => {
  it('names the file <runId>-<config>.jsonl in the reports folder', async () => {
    const deps = await dryDeps({ datasetPaths: { questions: await miniDataset() } })
    const summary = await runEvaluation({ config: '+context', dryRun: true, maxItems: 1 }, deps)
    expect(summary.runId).toMatch(/^\d{8}-\d{6}-[0-9a-f]{4}$/)
    expect(summary.file).toBe(runFilePath(deps.reportsDir, summary.runId, '+context'))
  })
})

describe('parseCliArgs', () => {
  it('parses the documented options', () => {
    expect(parseCliArgs(['--config', 'full'])).toEqual({ config: 'full', concurrency: 1, dryRun: false })
    expect(
      parseCliArgs(['--config', '+schema', '--max-items', '3', '--concurrency', '2', '--dry-run', '--resume', '20261114-090000-a1b2']),
    ).toEqual({ config: '+schema', maxItems: 3, concurrency: 2, dryRun: true, resume: '20261114-090000-a1b2' })
  })

  it.each([
    [[]],
    [['--config', 'turbo']],
    [['--config', 'full', '--max-items', '0']],
    [['--config', 'full', '--max-items', 'x']],
    [['--config', 'full', '--resume', '../etc']],
    [['--config', 'full', '--unknown']],
  ])('rejects %j', (argv) => {
    expect(() => parseCliArgs(argv)).toThrow()
  })
})
