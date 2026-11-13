import { ApiError, GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { getEnv } from '../config/env.js'
import { embeddingCostMicroUsd } from '../lib/cost.js'
import { AppError } from '../lib/errors.js'
import type { Logger } from '../lib/logger.js'
import { withRateLimitRetry, type RateLimitSignal, type Sleep } from '../lib/provider-retry.js'
import type { RequestSource } from '../services/audit.service.js'
import { assertWithinBudget, recordUsage } from '../services/usage.service.js'

// The only module that calls an embedding provider (IMPLEMENTATION.md 9.3 rule 3).
// Every request: budget check → provider call (429 handling) → vector validation →
// usage recorded in daily_usage. Provider SDK types never leave this file.

/** Gemini task type: questions are embedded as queries, stored knowledge as documents. */
export type EmbeddingTask = 'query' | 'document'

export interface EmbedOptions {
  task: EmbeddingTask
  source: RequestSource
}

export interface EmbeddingsClient {
  /** Part of every content_hash, so a model change re-embeds everything. */
  readonly model: string
  readonly dimensions: number
  /** One vector per text, in order. Texts are sent in batches. */
  embed(texts: readonly string[], options: EmbedOptions): Promise<number[][]>
}

/** One provider request for a batch of texts. Real (Gemini) and mock implementations. */
export interface EmbeddingProvider {
  readonly model: string
  readonly dimensions: number
  embedBatch(texts: readonly string[], task: EmbeddingTask): Promise<{ vectors: unknown; tokens: number }>
  /** Recognises the provider's 429; undefined for every other error. */
  classifyRateLimit(err: unknown): RateLimitSignal | undefined
}

/**
 * Texts per batchEmbedContents request. 100 is the commonly cited Gemini limit; the
 * API reference page checked in M2 does not state one, so the first real kb:index
 * run confirms it (recorded in PROGRESS.md).
 */
export const MAX_EMBEDDING_BATCH = 100

export interface EmbeddingsClientOptions {
  logger?: Logger | undefined
  sleep?: Sleep | undefined
}

export function createEmbeddingsClient(
  provider: EmbeddingProvider,
  options: EmbeddingsClientOptions = {},
): EmbeddingsClient {
  const env = getEnv()
  const vectorsSchema = z.array(z.array(z.number().finite()).length(provider.dimensions))

  async function embedBatch(batch: readonly string[], embedOptions: EmbedOptions): Promise<number[][]> {
    await assertWithinBudget(embedOptions.source)
    let response: { vectors: unknown; tokens: number }
    try {
      response = await withRateLimitRetry(() => provider.embedBatch(batch, embedOptions.task), {
        provider: 'gemini',
        classify: (err) => provider.classifyRateLimit(err),
        settings: { maxRetries: env.PROVIDER_MAX_RETRIES, maxWaitMs: env.PROVIDER_MAX_WAIT_MS },
        sleep: options.sleep,
        logger: options.logger,
      })
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('INTERNAL_ERROR', 'Embedding request failed', { cause: err })
    }

    const parsed = vectorsSchema.safeParse(response.vectors)
    if (!parsed.success || parsed.data.length !== batch.length) {
      throw new AppError('INTERNAL_ERROR', 'Embedding response was invalid', {
        cause: new Error(`expected ${batch.length} vectors of ${provider.dimensions} dimensions`),
      })
    }
    await recordUsage({
      source: embedOptions.source,
      embeddingTokens: response.tokens,
      embeddingRequests: 1,
      costMicroUsd: embeddingCostMicroUsd(response.tokens, env.EMBEDDING_PRICE_PER_1M_USD),
    })
    return parsed.data
  }

  return {
    model: provider.model,
    dimensions: provider.dimensions,
    async embed(texts, embedOptions) {
      if (texts.some((t) => t.trim() === '')) {
        throw new AppError('INTERNAL_ERROR', 'Cannot embed empty text')
      }
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += MAX_EMBEDDING_BATCH) {
        vectors.push(...(await embedBatch(texts.slice(start, start + MAX_EMBEDDING_BATCH), embedOptions)))
      }
      return vectors
    },
  }
}

// --- Gemini -----------------------------------------------------------------

// The SDK's ApiError carries only `status` and `message`, where `message` is the
// provider's JSON error body as a string. The retry delay is a google.rpc.RetryInfo
// detail ("17s" / "0.5s"). Anything unreadable means "no delay" → fail at once
// (user decision, M2).
const geminiErrorBody = z.object({
  error: z.object({
    details: z.array(z.looseObject({ '@type': z.string().optional(), retryDelay: z.string().optional() })).optional(),
  }),
})

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Retry delay in ms from a Gemini error message, or undefined. */
export function geminiRetryDelayMs(message: string): number | undefined {
  const body = geminiErrorBody.safeParse(parseJson(message))
  if (!body.success) return undefined
  const retryInfo = body.data.error.details?.find((d) => d['@type']?.endsWith('google.rpc.RetryInfo') === true)
  const match = /^(\d+(?:\.\d+)?)s$/.exec(retryInfo?.retryDelay ?? '')
  return match?.[1] === undefined ? undefined : Math.ceil(Number(match[1]) * 1000)
}

export function classifyGeminiRateLimit(err: unknown): RateLimitSignal | undefined {
  if (!(err instanceof ApiError) || err.status !== 429) return undefined
  return { retryAfterMs: geminiRetryDelayMs(err.message) }
}

const geminiResponse = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number()) })),
  usageMetadata: z.object({ promptTokenCount: z.number().int().nonnegative() }).optional(),
})

export interface GeminiSettings {
  apiKey: string
  model: string
  dimensions: number
}

export function geminiEmbeddingProvider(settings: GeminiSettings, logger?: Logger): EmbeddingProvider {
  // No httpOptions.retryOptions: SDK retries stay off, withRateLimitRetry handles 429s.
  const ai = new GoogleGenAI({ apiKey: settings.apiKey })
  return {
    model: settings.model,
    dimensions: settings.dimensions,
    classifyRateLimit: classifyGeminiRateLimit,
    async embedBatch(texts, task) {
      const raw = await ai.models.embedContent({
        model: settings.model,
        contents: [...texts],
        config: {
          taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
          outputDimensionality: settings.dimensions,
        },
      })
      const parsed = geminiResponse.safeParse(raw)
      if (!parsed.success) {
        return { vectors: undefined, tokens: 0 }
      }
      const usage = parsed.data.usageMetadata
      if (usage === undefined) {
        logger?.warn({ provider: 'gemini' }, 'embedding response has no usage metadata; tokens recorded as 0')
      }
      return { vectors: parsed.data.embeddings.map((e) => e.values), tokens: usage?.promptTokenCount ?? 0 }
    },
  }
}

/** The real embeddings client, configured from the environment. */
export function createGeminiEmbeddingsClient(options: EmbeddingsClientOptions = {}): EmbeddingsClient {
  const env = getEnv()
  const provider = geminiEmbeddingProvider(
    { apiKey: env.GEMINI_API_KEY, model: env.EMBEDDING_MODEL, dimensions: env.EMBEDDING_DIMENSIONS },
    options.logger,
  )
  return createEmbeddingsClient(provider, options)
}
