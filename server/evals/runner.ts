import { mkdir } from 'node:fs/promises'
import { getEnv } from '../src/config/env.js'
import type { Logger } from '../src/lib/logger.js'
import { findLeakage, type LeakageMatch } from '../src/retrieval/leakage.js'
import type { QuestionDeps } from '../src/services/question.service.js'
import { EVAL_CONFIGS, type ConfigName } from './configs.js'
import { datasetPath, loadAttacks, loadQuestions, type Dataset, type DatasetName } from './dataset.js'
import { checkFit, needsFitCheck } from './fit.js'
import { runItem } from './item.js'
import type { ProviderLimits } from './limits.js'
import { writeReport } from './report.js'
import {
  appendItemResult,
  createRunFile,
  finishedIds,
  isComplete,
  newRunId,
  readRunFile,
  runFilePath,
  type ItemResult,
  type RunHeader,
} from './run-file.js'

// Evaluation runner (IMPLEMENTATION.md 20.5, D26). Per run: leakage guard → (new
// run: fit check + header | resume: header must match) → items one by one (or with
// limited concurrency), each result appended as it finishes → when every item is
// done, REPORT.md is regenerated. A provider rate limit beyond the configured wait,
// or the evaluation token cap, stops the run cleanly; `--resume <runId>` continues
// it and skips finished items.

export interface RunnerDeps {
  question: QuestionDeps
  providerLimits: ProviderLimits
  /** Folder of the run files. */
  reportsDir: string
  /** REPORT.md to regenerate when a run completes. */
  reportPath: string
  logger?: Logger | undefined
  /** Dataset files (tests pass their own). */
  datasetPaths?: Partial<Record<DatasetName, string>> | undefined
}

export interface RunnerOptions {
  config: ConfigName
  /** At most this many unfinished items in this invocation. */
  maxItems?: number | undefined
  concurrency?: number | undefined
  resume?: string | undefined
  dryRun: boolean
}

export interface RunSummary {
  runId: string
  config: ConfigName
  file: string
  status: 'complete' | 'partial' | 'stopped' | 'does_not_fit'
  /** Items finished in this invocation. */
  ranNow: number
  finished: number
  total: number
  stop?: { code: string; message: string } | undefined
  reportWritten: boolean
}

/** The runner refuses to start: an evaluation question matches a verified example (20.2). */
export class LeakageError extends Error {
  constructor(readonly matches: LeakageMatch[]) {
    super(`${matches.length} evaluation question(s) match verified examples; the run did not start`)
    this.name = 'LeakageError'
  }
}

async function loadDataset(name: DatasetName, paths: RunnerDeps['datasetPaths']): Promise<Dataset> {
  const path = paths?.[name] ?? datasetPath(name)
  return name === 'questions' ? loadQuestions(path) : loadAttacks(path)
}

async function newHeader(
  runId: string,
  options: RunnerOptions,
  dataset: Dataset,
  deps: RunnerDeps,
): Promise<RunHeader> {
  const env = getEnv()
  const config = EVAL_CONFIGS[options.config]
  const fit = needsFitCheck(config.flags)
    ? await checkFit(
        dataset.items.map((i) => i.question),
        env.LLM_MODEL,
        deps.providerLimits,
        deps.question.embeddings,
      )
    : null
  return {
    type: 'run',
    runId,
    config: config.name,
    dataset: dataset.name,
    datasetHash: dataset.hash,
    itemIds: dataset.items.map((i) => i.id),
    flags: config.flags,
    models: {
      llm: options.dryRun ? 'mock' : env.LLM_MODEL,
      answer: options.dryRun ? 'mock' : (env.LLM_ANSWER_MODEL ?? env.LLM_MODEL),
      embedding: deps.question.embeddings.model,
    },
    settings: {
      maxSqlAttempts: env.MAX_SQL_ATTEMPTS,
      maxClarifications: env.MAX_CLARIFICATIONS,
      queryRowLimit: env.QUERY_ROW_LIMIT,
      queryCostSoftLimit: env.QUERY_COST_SOFT_LIMIT,
      queryCostHardLimit: env.QUERY_COST_HARD_LIMIT,
    },
    startedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    providerLimits: deps.providerLimits,
    fit,
  }
}

/**
 * REPORT.md with the baseline prompt size: `baseline` is not run (IMPLEMENTATION.md
 * 20.4), so its fit check is measured here (no provider call) for the report.
 */
async function refreshReport(deps: RunnerDeps): Promise<void> {
  const questions = await loadDataset('questions', deps.datasetPaths)
  const baselineFit = await checkFit(
    questions.items.map((i) => i.question),
    getEnv().LLM_MODEL,
    deps.providerLimits,
    deps.question.embeddings,
  )
  await writeReport(deps.reportsDir, deps.reportPath, new Date(), baselineFit)
}

/** Opens a new run file or validates the one being resumed; returns its path, header and finished ids. */
async function openRun(
  options: RunnerOptions,
  dataset: Dataset,
  deps: RunnerDeps,
): Promise<{ runId: string; file: string; header: RunHeader; finished: Set<string> }> {
  if (options.resume !== undefined) {
    const file = runFilePath(deps.reportsDir, options.resume, options.config)
    const run = await readRunFile(file)
    if (run.header.datasetHash !== dataset.hash) {
      throw new Error(`The ${dataset.name} dataset changed since run ${options.resume} started; start a new run`)
    }
    if (run.header.dryRun !== options.dryRun) {
      throw new Error(`Run ${options.resume} was ${run.header.dryRun ? '' : 'not '}a dry run; resume it the same way`)
    }
    return { runId: options.resume, file, header: run.header, finished: finishedIds(run) }
  }
  const runId = newRunId(new Date())
  const file = runFilePath(deps.reportsDir, runId, options.config)
  const header = await newHeader(runId, options, dataset, deps)
  await mkdir(deps.reportsDir, { recursive: true })
  await createRunFile(file, header)
  return { runId, file, header, finished: new Set() }
}

export async function runEvaluation(options: RunnerOptions, deps: RunnerDeps): Promise<RunSummary> {
  const concurrency = options.concurrency ?? 1
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer')
  if (options.maxItems !== undefined && (!Number.isInteger(options.maxItems) || options.maxItems < 1)) {
    throw new Error('max-items must be a positive integer')
  }
  const config = EVAL_CONFIGS[options.config]
  const dataset = await loadDataset(config.dataset, deps.datasetPaths)

  // 20.2: refuse to start (or resume) when any question matches a verified example.
  const leaks = await findLeakage(
    dataset.items.map((i) => i.question),
    deps.question.embeddings,
    'eval',
  )
  if (leaks.length > 0) throw new LeakageError(leaks)

  const { runId, file, header, finished } = await openRun(options, dataset, deps)
  const summary = (status: RunSummary['status'], ranNow: number, done: number, reportWritten: boolean): RunSummary => ({
    runId,
    config: options.config,
    file,
    status,
    ranNow,
    finished: done,
    total: header.itemIds.length,
    reportWritten,
  })

  if (header.fit?.fits === false) {
    deps.logger?.warn({ runId, fit: header.fit }, 'eval: config does not fit the model limits; no provider calls')
    await refreshReport(deps)
    return summary('does_not_fit', 0, 0, true)
  }

  const pending = dataset.items.filter((i) => !finished.has(i.id)).slice(0, options.maxItems)
  let next = 0
  let ranNow = 0
  let stop: { code: string; message: string } | undefined
  let writes: Promise<void> = Promise.resolve()
  const record = (result: ItemResult): Promise<void> => {
    writes = writes.then(() => appendItemResult(file, result))
    return writes
  }

  const worker = async (): Promise<void> => {
    while (stop === undefined && next < pending.length) {
      const item = pending[next]
      next += 1
      if (item === undefined) break
      const outcome = await runItem(item, config, deps.question)
      if (outcome.kind === 'stop') {
        stop ??= { code: outcome.code, message: outcome.message }
        deps.logger?.warn({ runId, item: item.id, code: outcome.code }, 'eval: stopping; resume later')
        continue
      }
      await record(outcome.result)
      ranNow += 1
      deps.logger?.info(
        { runId, item: item.id, status: outcome.result.status, passed: outcome.result.passed },
        'eval: item finished',
      )
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, Math.max(pending.length, 1)) }, worker))
  await writes
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failure !== undefined) throw failure.reason

  const run = await readRunFile(file)
  const complete = isComplete(run)
  if (complete) await refreshReport(deps)
  const status = complete ? 'complete' : stop !== undefined ? 'stopped' : 'partial'
  return { ...summary(status, ranNow, finishedIds(run).size, complete), stop }
}
