import { buildGenerateMessages } from '../src/agent/prompts/generate.js'
import type { AgentFlags } from '../src/agent/state.js'
import type { EmbeddingsClient } from '../src/retrieval/embeddings.js'
import { retrieveContext } from '../src/services/retrieval.service.js'
import type { ProviderLimits } from './limits.js'
import type { FitCheck } from './run-file.js'

// Baseline fit check (IMPLEMENTATION.md 20.4, M4 decision Q2). Without schema
// retrieval every table is sent, and that prompt may exceed the chat model's
// per-minute token limit (on Groq's free tier a single request larger than TPM is
// refused). Before any provider call, the largest generate prompt of the dataset
// is built exactly as the agent builds it and measured; if it does not fit, the
// config is reported as "does not fit the model's limits" and nothing is called.
// Retrieval without schema retrieval and extras makes no embedding call.

/** Rough characters per token for English and schema text (no tokenizer dependency). */
export const CHARS_PER_TOKEN = 4

/**
 * Completion tokens kept free within the per-minute limit. The largest structured
 * reply in the M3 real checks used 442 completion tokens.
 */
export const RESERVED_COMPLETION_TOKENS = 500

/** Configs that send the full schema need the check. */
export function needsFitCheck(flags: AgentFlags): boolean {
  return !flags.schemaRetrieval
}

export async function checkFit(
  questions: readonly string[],
  model: string,
  limits: ProviderLimits,
  embeddings: EmbeddingsClient,
): Promise<FitCheck> {
  const modelLimits = limits.models[model]
  if (modelLimits === undefined) {
    throw new Error(`Provider limits for model ${model} are not recorded in evals/provider-limits.json`)
  }
  let promptChars = 0
  for (const question of questions) {
    // Extras off: they would need an embedding call, and the only config checked
    // here (baseline) has them off anyway.
    const context = await retrieveContext(question, embeddings, 'eval', { schemaRetrieval: false, extras: false })
    const messages = buildGenerateMessages({
      question,
      context,
      conversation: [],
      clarifications: [],
      previous: null,
      feedback: null,
      clarifyAllowed: true,
    })
    promptChars = Math.max(promptChars, messages.reduce((sum, m) => sum + m.content.length, 0))
  }
  const estimatedPromptTokens = Math.ceil(promptChars / CHARS_PER_TOKEN)
  return {
    model,
    promptChars,
    estimatedPromptTokens,
    reservedCompletionTokens: RESERVED_COMPLETION_TOKENS,
    tpm: modelLimits.tpm,
    fits: estimatedPromptTokens + RESERVED_COMPLETION_TOKENS <= modelLimits.tpm,
  }
}
