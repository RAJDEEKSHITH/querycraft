import '../src/config/load-dotenv.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { getEnv } from '../src/config/env.js'
import { closeAppPool } from '../src/db/app.js'
import { AppError } from '../src/lib/errors.js'
import { createLogger } from '../src/lib/logger.js'
import { closeReaderConnections } from '../src/safety/executor.js'
import { createQuestionDeps } from '../src/services/question.service.js'
import { CONFIG_NAMES } from './configs.js'
import { loadAttacks, loadQuestions } from './dataset.js'
import { createDryRunDeps, indexDryRunKnowledge } from './dry-run.js'
import { loadProviderLimits } from './limits.js'
import { RUN_ID_PATTERN } from './run-file.js'
import { LeakageError, runEvaluation, type RunnerDeps, type RunSummary } from './runner.js'

// `pnpm eval:run --config <name> [--max-items N] [--concurrency 1] [--dry-run] [--resume <runId>]`
// (IMPLEMENTATION.md 20.5). Real runs call Groq and Gemini and need the user's
// approval (CLAUDE.md 11). A dry run uses mock clients and querycraft_test, and
// writes its run files and report to a temporary folder, never to REPORT.md.

export const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url))
export const REPORT_PATH = fileURLToPath(new URL('./REPORT.md', import.meta.url))
export const DRY_RUN_DIR = join(tmpdir(), 'querycraft-eval-dry-run')

const cliArgsSchema = z.strictObject({
  config: z.enum(CONFIG_NAMES),
  maxItems: z.coerce.number().int().positive().optional(),
  concurrency: z.coerce.number().int().positive().default(1),
  dryRun: z.boolean().default(false),
  resume: z.string().regex(RUN_ID_PATTERN).optional(),
})

export type CliArgs = z.infer<typeof cliArgsSchema>

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      'max-items': { type: 'string' },
      concurrency: { type: 'string' },
      'dry-run': { type: 'boolean' },
      resume: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  })
  const parsed = cliArgsSchema.safeParse({
    config: values.config,
    maxItems: values['max-items'],
    concurrency: values.concurrency,
    dryRun: values['dry-run'],
    resume: values.resume,
  })
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ')
    throw new Error(`Invalid arguments: ${names}. Configs: ${CONFIG_NAMES.join(', ')}`)
  }
  return parsed.data
}

function printSummary(summary: RunSummary, reportPath: string, dryRun: boolean): void {
  console.log(`eval:run ${summary.config}: ${summary.status}`)
  console.log(`  run id:   ${summary.runId}`)
  console.log(`  file:     ${summary.file}`)
  console.log(`  items:    ${summary.finished}/${summary.total} finished (${summary.ranNow} in this invocation)`)
  if (summary.stop !== undefined) {
    console.log(`  stopped:  ${summary.stop.code}: ${summary.stop.message}`)
  }
  if (summary.status !== 'complete' && summary.status !== 'does_not_fit') {
    console.log(`  continue: pnpm eval:run --config ${summary.config}${dryRun ? ' --dry-run' : ''} --resume ${summary.runId}`)
  }
  if (summary.reportWritten) console.log(`  report:   ${reportPath}`)
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  // A dry run only touches querycraft_test; set before the environment is first read.
  if (args.dryRun) process.env['NODE_ENV'] = 'test'
  const env = getEnv()
  const logger = createLogger(env.LOG_LEVEL)
  const providerLimits = await loadProviderLimits()

  let deps: RunnerDeps
  if (args.dryRun) {
    const items = [...(await loadQuestions()).items, ...(await loadAttacks()).items]
    const dry = await createDryRunDeps(items)
    await indexDryRunKnowledge(dry.question.embeddings)
    deps = { question: dry.question, providerLimits, reportsDir: DRY_RUN_DIR, reportPath: join(DRY_RUN_DIR, 'REPORT.md'), logger }
  } else {
    deps = { question: await createQuestionDeps(logger), providerLimits, reportsDir: REPORTS_DIR, reportPath: REPORT_PATH, logger }
  }

  const summary = await runEvaluation(
    { config: args.config, maxItems: args.maxItems, concurrency: args.concurrency, resume: args.resume, dryRun: args.dryRun },
    deps,
  )
  printSummary(summary, deps.reportPath, args.dryRun)
  if (summary.status === 'stopped') process.exitCode = 2
}

const isEntryPoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntryPoint) {
  main()
    .catch((err: unknown) => {
      if (err instanceof LeakageError) {
        console.error(`eval:run refused to start: ${err.message}`)
        for (const m of err.matches) {
          console.error(`  "${m.question}" ~ example "${m.exampleQuestion}" (${m.reason}, ${m.similarity.toFixed(3)})`)
        }
      } else {
        const message = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : ''
        console.error(`eval:run failed. ${message}`)
      }
      process.exitCode = 1
    })
    .finally(async () => {
      await closeReaderConnections()
      await closeAppPool()
    })
}
