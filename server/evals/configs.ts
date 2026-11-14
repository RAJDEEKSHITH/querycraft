import { FULL_FLAGS, type AgentFlags } from '../src/agent/state.js'
import type { DatasetName } from './dataset.js'

// Ablation configurations (IMPLEMENTATION.md 20.4). The attack set runs once with
// the `full` flags, as its own config name so it has its own report file.

export const CONFIG_NAMES = ['baseline', '+schema', '+context', 'full', 'attacks'] as const
export type ConfigName = (typeof CONFIG_NAMES)[number]

/** The four ablation configs, in report order. */
export const ABLATION_CONFIGS = ['baseline', '+schema', '+context', 'full'] as const satisfies readonly ConfigName[]

export interface EvalConfig {
  name: ConfigName
  dataset: DatasetName
  flags: AgentFlags
}

export const EVAL_CONFIGS: Record<ConfigName, EvalConfig> = {
  baseline: {
    name: 'baseline',
    dataset: 'questions',
    flags: { schemaRetrieval: false, examplesGlossaryValues: false, selfCorrection: false },
  },
  '+schema': {
    name: '+schema',
    dataset: 'questions',
    flags: { schemaRetrieval: true, examplesGlossaryValues: false, selfCorrection: false },
  },
  '+context': {
    name: '+context',
    dataset: 'questions',
    flags: { schemaRetrieval: true, examplesGlossaryValues: true, selfCorrection: false },
  },
  full: { name: 'full', dataset: 'questions', flags: FULL_FLAGS },
  attacks: { name: 'attacks', dataset: 'attacks', flags: FULL_FLAGS },
}
