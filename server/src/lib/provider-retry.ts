import { AppError } from './errors.js'
import type { Logger } from './logger.js'

// Provider rate-limit handling shared by agent/llm.ts and retrieval/embeddings.ts
// (IMPLEMENTATION.md 17):
// - only HTTP 429 is retried, and only after the delay the provider asked for;
// - a 429 without a readable delay fails at once (no blind retries);
// - at most `maxRetries` retries, and the total wait never exceeds `maxWaitMs`;
// - when it gives up: UPSTREAM_RATE_LIMITED, with the provider's delay if known.

/** What a provider error means for retrying: undefined = not a rate limit. */
export interface RateLimitSignal {
  retryAfterMs: number | undefined
}

export interface RetrySettings {
  maxRetries: number
  maxWaitMs: number
}

export type Sleep = (ms: number) => Promise<void>

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export interface RetryContext {
  provider: 'groq' | 'gemini'
  classify: (err: unknown) => RateLimitSignal | undefined
  settings: RetrySettings
  sleep?: Sleep | undefined
  logger?: Logger | undefined
}

export const UPSTREAM_RATE_LIMITED_MESSAGE = 'The AI provider is rate limiting requests. Please try again shortly.'

function rateLimited(retryAfterMs: number | undefined, cause: unknown): AppError {
  const details = retryAfterMs === undefined ? {} : { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  return new AppError('UPSTREAM_RATE_LIMITED', UPSTREAM_RATE_LIMITED_MESSAGE, { details, cause })
}

/** Runs `call`, retrying provider 429s as described above. Other errors are rethrown unchanged. */
export async function withRateLimitRetry<T>(call: () => Promise<T>, context: RetryContext): Promise<T> {
  const sleep = context.sleep ?? defaultSleep
  const { maxRetries, maxWaitMs } = context.settings
  let waitedMs = 0
  for (let retries = 0; ; retries += 1) {
    try {
      return await call()
    } catch (err) {
      const signal = context.classify(err)
      if (signal === undefined) {
        throw err
      }
      const delay = signal.retryAfterMs
      if (delay === undefined || retries >= maxRetries || waitedMs + delay > maxWaitMs) {
        context.logger?.warn({ provider: context.provider, retries, retryAfterMs: delay }, 'provider rate limit: giving up')
        throw rateLimited(delay, err)
      }
      context.logger?.warn({ provider: context.provider, retries, retryAfterMs: delay }, 'provider rate limit: waiting')
      waitedMs += delay
      await sleep(delay)
    }
  }
}
