import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ABLATION_CONFIGS, CONFIG_NAMES, type ConfigName } from './configs.js'
import { ATTACK_CATEGORIES } from './dataset.js'
import { isComplete, readRunFile, type FitCheck, type ItemResult, type RunFile } from './run-file.js'

// REPORT.md generator (IMPLEMENTATION.md 20.3, 20.5). Built only from run files:
// for each config the newest complete run is reported. Nothing is estimated or
// typed in by hand; a config without a complete run says so. The one exception is
// the baseline prompt size: `baseline` is not run (IMPLEMENTATION.md 20.4), so its
// fit-check measurement is passed in and shown next to the measured prompt tokens
// of the retrieval configs.

export interface Selection {
  /** Newest complete run per config. */
  complete: Partial<Record<ConfigName, RunFile>>
  /** Newest incomplete run per config without a complete one (shown as in progress). */
  inProgress: Partial<Record<ConfigName, RunFile>>
}

export async function readRuns(dir: string): Promise<RunFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const runs: RunFile[] = []
  for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
    runs.push(await readRunFile(join(dir, name)))
  }
  return runs
}

export function selectRuns(runs: readonly RunFile[]): Selection {
  const newestFirst = [...runs].sort((a, b) => b.header.startedAt.localeCompare(a.header.startedAt))
  const selection: Selection = { complete: {}, inProgress: {} }
  for (const config of CONFIG_NAMES) {
    const ofConfig = newestFirst.filter((r) => r.header.config === config)
    const complete = ofConfig.find(isComplete)
    if (complete !== undefined) selection.complete[config] = complete
    else if (ofConfig[0] !== undefined) selection.inProgress[config] = ofConfig[0]
  }
  return selection
}

// --- metrics ------------------------------------------------------------------

export interface Ratio {
  passed: number
  total: number
}

export interface QuestionMetrics {
  categories: Record<'easy' | 'medium' | 'hard' | 'ambiguous' | 'unanswerable', Ratio>
  /** Execution accuracy over the answerable items (easy + medium + hard). */
  answerable: Ratio
  /** Every item met its expectation (answer, clarification or refusal). */
  overall: Ratio
  /** Answerable items whose run ended `blocked`. */
  falseBlocks: Ratio
  /** Items outside the ambiguous category that asked for clarification. */
  unnecessaryClarifications: number
  /** Mean SQL attempts over items that produced SQL. */
  averageAttempts: number | null
  approvalsRequired: number
  latencyP50: number | null
  latencyP95: number | null
  /** Mean prompt + completion tokens per item. */
  averageTokens: number | null
  unsafeExecutions: number
  failures: Record<string, number>
}

export interface AttackMetrics {
  blockedOrRefused: Ratio
  blocked: number
  refused: number
  unsafeExecutions: number
  categories: Record<string, Ratio>
  otherOutcomes: Record<string, number>
}

function ratio(items: readonly ItemResult[]): Ratio {
  return { passed: items.filter((i) => i.passed).length, total: items.length }
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

/** Nearest-rank percentile. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1] ?? null
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1
  return counts
}

export function questionMetrics(items: readonly ItemResult[]): QuestionMetrics {
  const of = (category: string): ItemResult[] => items.filter((i) => i.category === category)
  const answerable = items.filter((i) => i.expected === 'answer')
  const latencies = items.flatMap((i) => (i.latencyMs === null ? [] : [i.latencyMs]))
  const failed = items.filter((i) => i.status === 'failed')
  return {
    categories: {
      easy: ratio(of('easy')),
      medium: ratio(of('medium')),
      hard: ratio(of('hard')),
      ambiguous: ratio(of('ambiguous')),
      unanswerable: ratio(of('unanswerable')),
    },
    answerable: ratio(answerable),
    overall: ratio(items),
    falseBlocks: { passed: answerable.filter((i) => i.status === 'blocked').length, total: answerable.length },
    unnecessaryClarifications: items.filter((i) => i.category !== 'ambiguous' && i.status === 'awaiting_clarification')
      .length,
    averageAttempts: mean(items.filter((i) => i.attempts > 0).map((i) => i.attempts)),
    approvalsRequired: items.filter((i) => i.approvalRequired).length,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    averageTokens: mean(items.map((i) => i.promptTokens + i.completionTokens)),
    unsafeExecutions: items.filter((i) => i.unsafe).length,
    failures: tally(failed.map((i) => i.errorCode ?? 'unknown')),
  }
}

export function attackMetrics(items: readonly ItemResult[]): AttackMetrics {
  const categories: Record<string, Ratio> = {}
  for (const category of ATTACK_CATEGORIES) categories[category] = ratio(items.filter((i) => i.category === category))
  return {
    blockedOrRefused: ratio(items),
    blocked: items.filter((i) => i.status === 'blocked').length,
    refused: items.filter((i) => i.status === 'cannot_answer').length,
    unsafeExecutions: items.filter((i) => i.unsafe).length,
    categories,
    otherOutcomes: tally(items.filter((i) => !i.passed).map((i) => (i.errorCode === null ? i.status : `${i.status} (${i.errorCode})`))),
  }
}

// --- formatting ---------------------------------------------------------------

function pct(r: Ratio): string {
  return r.total === 0 ? '—' : `${r.passed}/${r.total} (${Math.round((100 * r.passed) / r.total)}%)`
}

function num(value: number | null, digits = 0, unit = ''): string {
  if (value === null) return '—'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

function lastItemDay(run: RunFile): string {
  const last = run.items.map((i) => i.finishedAt).sort().at(-1)
  return last === undefined ? '—' : day(last)
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ]
}

function runLabel(selection: Selection, config: ConfigName): string {
  const run = selection.complete[config]
  if (run !== undefined) {
    if (run.header.fit?.fits === false) return 'does not fit the model\'s limits'
    return `${run.header.runId}${run.header.dryRun ? ' (dry run)' : ''}`
  }
  const partial = selection.inProgress[config]
  return partial === undefined ? 'not run' : `in progress (${partial.items.length}/${partial.header.itemIds.length})`
}

function itemOutcome(item: ItemResult | undefined): string {
  if (item === undefined) return '—'
  const mark = item.passed ? '✓' : '✗'
  const why = item.comparison !== null && item.comparison !== 'match' ? ` (${item.comparison})` : item.errorCode === null ? '' : ` (${item.errorCode})`
  return `${mark} ${item.status}${why}`
}

function ablationSection(selection: Selection): string[] {
  const configs = ABLATION_CONFIGS
  const metrics = new Map<ConfigName, QuestionMetrics>()
  for (const config of configs) {
    const run = selection.complete[config]
    if (run !== undefined && run.header.fit?.fits !== false) metrics.set(config, questionMetrics(run.items))
  }
  const row = (label: string, value: (m: QuestionMetrics) => string): string[] => [
    label,
    ...configs.map((c) => {
      const m = metrics.get(c)
      return m === undefined ? '—' : value(m)
    }),
  ]
  const lines = [
    '## Ablation — `questions.jsonl`',
    '',
    ...table(
      ['Metric', ...configs],
      [
        ['Run', ...configs.map((c) => runLabel(selection, c))],
        row('Execution accuracy, answerable (easy + medium + hard)', (m) => pct(m.answerable)),
        row('— easy', (m) => pct(m.categories.easy)),
        row('— medium', (m) => pct(m.categories.medium)),
        row('— hard', (m) => pct(m.categories.hard)),
        row('Clarification rate on ambiguous', (m) => pct(m.categories.ambiguous)),
        row('Correct refusal on unanswerable', (m) => pct(m.categories.unanswerable)),
        row('All items as expected', (m) => pct(m.overall)),
        row('False-block rate (answerable items blocked)', (m) => pct(m.falseBlocks)),
        row('Unnecessary clarifications', (m) => String(m.unnecessaryClarifications)),
        row('Average SQL attempts (items with SQL)', (m) => num(m.averageAttempts, 2)),
        row('Approvals required (above the soft cost limit)', (m) => String(m.approvalsRequired)),
        row('Latency p50', (m) => num(m.latencyP50, 0, ' ms')),
        row('Latency p95', (m) => num(m.latencyP95, 0, ' ms')),
        row('Average LLM tokens per question', (m) => num(m.averageTokens, 0)),
        row('Unsafe executions', (m) => String(m.unsafeExecutions)),
        row('Failed runs (by code)', (m) =>
          Object.keys(m.failures).length === 0
            ? '0'
            : Object.entries(m.failures)
                .map(([code, n]) => `${code} ${n}`)
                .join(', '),
        ),
      ],
    ),
    '',
    'Latency is the processing time per question and includes waiting for provider rate limits (free-tier tokens per minute), so it reflects the free-tier setup, not the pipeline alone.',
    '',
  ]
  for (const config of configs) {
    const fit = selection.complete[config]?.header.fit ?? selection.inProgress[config]?.header.fit
    if (fit === undefined || fit === null) continue
    lines.push(
      `Fit check (${config}): the largest generate prompt has ${fit.promptChars.toLocaleString('en-US')} characters ≈ ${fit.estimatedPromptTokens.toLocaleString('en-US')} tokens (4 characters per token) + ${fit.reservedCompletionTokens} reserved for the reply, against ${fit.tpm.toLocaleString('en-US')} tokens per minute for \`${fit.model}\`: ${fit.fits ? 'fits' : '**does not fit the model\'s limits**, so no requests were made'}.`,
      '',
    )
  }
  return lines
}

function promptSizeSection(selection: Selection, baselineFit: FitCheck | null): string[] {
  const baselineRun = selection.complete.baseline ?? selection.inProgress.baseline
  const rows: string[][] = []
  if (baselineRun === undefined && baselineFit !== null) {
    rows.push([
      'baseline (not run)',
      `largest generate prompt: ${baselineFit.promptChars.toLocaleString('en-US')} characters ≈ ${baselineFit.estimatedPromptTokens.toLocaleString('en-US')} tokens`,
      '—',
      'fit check: every allowed table and column, built exactly as the agent builds it, 4 characters per token; no provider call',
    ])
  }
  for (const config of ABLATION_CONFIGS) {
    if (config === 'baseline') continue
    const run = selection.complete[config]
    if (run === undefined) continue
    const prompts = run.items.map((i) => i.promptTokens)
    rows.push([
      config,
      `${num(mean(prompts), 0)} tokens per question (average)`,
      num(prompts.length === 0 ? null : Math.max(...prompts), 0),
      'counted by the provider; all LLM calls of a question (SQL generation and answer, every attempt)',
    ])
  }
  if (rows.length === 0) return []
  return [
    '## Prompt size',
    '',
    ...(baselineRun === undefined && baselineFit !== null
      ? [
          '`baseline` (no schema retrieval) is not run: it would cost about 240k tokens of the free-tier daily quota (IMPLEMENTATION.md 20.4). Its prompt size is measured instead and compared with the prompt tokens measured in the runs that use retrieval.',
          '',
        ]
      : []),
    ...table(['Config', 'Prompt size', 'Largest per question (tokens)', 'How measured'], rows),
    '',
    'The baseline figure is one SQL-generation request; the retrieval figures add the answer request and any retries, so they overstate the retrieval prompt per request.',
    '',
  ]
}

function attackSection(selection: Selection): string[] {
  const run = selection.complete.attacks
  const lines = ['## Attack set — `attacks.jsonl` (`full` config)', '']
  if (run === undefined) {
    lines.push(`Run: ${runLabel(selection, 'attacks')}.`, '')
    return lines
  }
  const m = attackMetrics(run.items)
  lines.push(
    ...table(
      ['Metric', 'Value'],
      [
        ['Run', runLabel(selection, 'attacks')],
        ['**Unsafe executions**', `**${m.unsafeExecutions}**`],
        ['Blocked or refused', pct(m.blockedOrRefused)],
        ['— blocked by the safety pipeline', String(m.blocked)],
        ['— refused by the model (`cannot_answer`)', String(m.refused)],
        ...Object.entries(m.categories).map(([c, r]) => [`— ${c}`, pct(r)]),
        [
          'Other outcomes',
          Object.keys(m.otherOutcomes).length === 0
            ? 'none'
            : Object.entries(m.otherOutcomes)
                .map(([o, n]) => `${o} ${n}`)
                .join(', '),
        ],
      ],
    ),
    '',
    ...table(
      ['Item', 'Category', 'Outcome', 'Executed queries', 'Unsafe'],
      run.items
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((i) => [i.id, i.category, itemOutcome(i), String(i.executedQueries), i.unsafe ? `yes: ${i.unsafeReasons.join('; ')}` : 'no']),
    ),
    '',
  )
  return lines
}

function itemSection(selection: Selection): string[] {
  const runs = ABLATION_CONFIGS.map((c) => selection.complete[c])
  const reference = runs.find((r) => r !== undefined && r.header.fit?.fits !== false)
  if (reference === undefined) return []
  const byId = runs.map((r) => new Map(r?.items.map((i) => [i.id, i])))
  return [
    '## Item outcomes — `questions.jsonl`',
    '',
    '✓ = met the expectation. For answerable items a ✗ shows the comparison result (`rows`, `row_count`, `column_count`, `not_answered`).',
    '',
    ...table(
      ['Item', 'Category', ...ABLATION_CONFIGS],
      reference.header.itemIds.map((id) => {
        const category = reference.items.find((i) => i.id === id)?.category ?? ''
        return [id, category, ...byId.map((m) => itemOutcome(m.get(id)))]
      }),
    ),
    '',
  ]
}

function runsSection(selection: Selection): string[] {
  const rows = CONFIG_NAMES.flatMap((config) => {
    const run = selection.complete[config] ?? selection.inProgress[config]
    if (run === undefined) return []
    const h = run.header
    return [
      [
        config,
        h.runId,
        isComplete(run) ? 'complete' : 'in progress',
        day(h.startedAt),
        lastItemDay(run),
        `${h.models.llm} / ${h.models.answer} / ${h.models.embedding}`,
        `${h.settings.maxSqlAttempts} attempts, cost limits ${h.settings.queryCostSoftLimit.toLocaleString('en-US')} / ${h.settings.queryCostHardLimit.toLocaleString('en-US')}`,
        h.datasetHash.slice(0, 12),
      ],
    ]
  })
  if (rows.length === 0) return []
  return [
    '## Runs',
    '',
    ...table(['Config', 'Run id', 'State', 'Started', 'Last item', 'Models (SQL / answer / embedding)', 'Settings', 'Dataset hash'], rows),
    '',
  ]
}

function limitsSection(selection: Selection): string[] {
  const runs = CONFIG_NAMES.flatMap((c) => {
    const run = selection.complete[c] ?? selection.inProgress[c]
    return run === undefined ? [] : [run]
  })
  const latest = runs.sort((a, b) => b.header.startedAt.localeCompare(a.header.startedAt))[0]
  if (latest === undefined) return []
  const limits = latest.header.providerLimits
  return [
    '## Provider limits at run time',
    '',
    `Recorded ${limits.recordedAt}, copied into each run header (newest run shown). ${limits.source}`,
    '',
    ...table(
      ['Model', 'Provider', 'RPM', 'RPD', 'TPM', 'TPD'],
      Object.entries(limits.models).map(([model, l]) => [
        model,
        l.provider,
        String(l.rpm),
        String(l.rpd),
        l.tpm.toLocaleString('en-US'),
        l.tpd === null ? 'not given' : l.tpd.toLocaleString('en-US'),
      ]),
    ),
    '',
  ]
}

/** `baselineFit`: the baseline fit check, shown while `baseline` has no run (20.4). */
export function renderReport(selection: Selection, generatedAt: Date, baselineFit: FitCheck | null = null): string {
  return [
    '# QueryCraft evaluation report',
    '',
    `Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by \`pnpm eval:run\` from its run files (\`server/evals/reports/<runId>-<config>.jsonl\` for real runs). Results are reported as measured; there is no accuracy target (IMPLEMENTATION.md section 20).`,
    '',
    'Execution accuracy: the gold SQL and the generated SQL are both executed through the safety pipeline, and their rows are compared as multisets (in order only when an item says order matters), with numbers rounded to 2 decimals, column names ignored and the column count required to match. Each configuration shows its newest complete run.',
    '',
    ...ablationSection(selection),
    ...promptSizeSection(selection, baselineFit),
    ...itemSection(selection),
    ...attackSection(selection),
    ...runsSection(selection),
    ...limitsSection(selection),
  ].join('\n')
}

export async function writeReport(
  reportsDir: string,
  reportPath: string,
  now = new Date(),
  baselineFit: FitCheck | null = null,
): Promise<void> {
  const selection = selectRuns(await readRuns(reportsDir))
  await writeFile(reportPath, renderReport(selection, now, baselineFit))
}
