import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/lib/errors.js'
import { withRateLimitRetry, type RateLimitSignal, type RetryContext } from '../../src/lib/provider-retry.js'

class FakeProviderError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`status ${status}`)
  }
}

function classify(err: unknown): RateLimitSignal | undefined {
  return err instanceof FakeProviderError && err.status === 429 ? { retryAfterMs: err.retryAfterMs } : undefined
}

/** A call that fails with the given errors in order, then succeeds. */
function scripted(errors: FakeProviderError[]): { call: () => Promise<string>; calls: () => number } {
  let n = 0
  return {
    call: () => {
      const err = errors[n]
      n += 1
      return err === undefined ? Promise.resolve('ok') : Promise.reject(err)
    },
    calls: () => n,
  }
}

function context(sleeps: number[], maxRetries = 3, maxWaitMs = 30_000): RetryContext {
  return {
    provider: 'gemini',
    classify,
    settings: { maxRetries, maxWaitMs },
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
  }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  )
}

describe('withRateLimitRetry', () => {
  it('returns at once when the call succeeds', async () => {
    const sleeps: number[] = []
    const s = scripted([])
    await expect(withRateLimitRetry(s.call, context(sleeps))).resolves.toBe('ok')
    expect(s.calls()).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('waits the provider delay after a 429 and then succeeds', async () => {
    const sleeps: number[] = []
    const s = scripted([new FakeProviderError(429, 2_000), new FakeProviderError(429, 5_000)])
    await expect(withRateLimitRetry(s.call, context(sleeps))).resolves.toBe('ok')
    expect(s.calls()).toBe(3)
    expect(sleeps).toEqual([2_000, 5_000])
  })

  it('fails at once on a 429 without a readable delay', async () => {
    const sleeps: number[] = []
    const s = scripted([new FakeProviderError(429)])
    const err = await caught(withRateLimitRetry(s.call, context(sleeps)))
    expect(err).toBeInstanceOf(AppError)
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(err instanceof AppError && err.details).toEqual({})
    expect(s.calls()).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('fails when the delay is beyond the wait limit, reporting the delay', async () => {
    const sleeps: number[] = []
    const s = scripted([new FakeProviderError(429, 45_500)])
    const err = await caught(withRateLimitRetry(s.call, context(sleeps, 3, 30_000)))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(err instanceof AppError && err.details).toEqual({ retryAfterSeconds: 46 })
    expect(sleeps).toEqual([])
  })

  it('counts the total wait across retries against the wait limit', async () => {
    const sleeps: number[] = []
    const s = scripted([new FakeProviderError(429, 20_000), new FakeProviderError(429, 20_000)])
    const err = await caught(withRateLimitRetry(s.call, context(sleeps, 3, 30_000)))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(sleeps).toEqual([20_000])
    expect(s.calls()).toBe(2)
  })

  it('never retries more than maxRetries times', async () => {
    const sleeps: number[] = []
    const s = scripted(Array.from({ length: 10 }, () => new FakeProviderError(429, 10)))
    const err = await caught(withRateLimitRetry(s.call, context(sleeps, 2)))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(s.calls()).toBe(3)
    expect(sleeps).toEqual([10, 10])
  })

  it('does not retry with maxRetries = 0', async () => {
    const sleeps: number[] = []
    const s = scripted([new FakeProviderError(429, 10)])
    const err = await caught(withRateLimitRetry(s.call, context(sleeps, 0)))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(s.calls()).toBe(1)
  })

  it.each([400, 401, 403, 404, 500, 503])('rethrows status %i unchanged without retrying', async (status) => {
    const sleeps: number[] = []
    const original = new FakeProviderError(status, 1_000)
    const s = scripted([original])
    expect(await caught(withRateLimitRetry(s.call, context(sleeps)))).toBe(original)
    expect(s.calls()).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('keeps the provider error as the internal cause only', async () => {
    const original = new FakeProviderError(429)
    const err = await caught(withRateLimitRetry(scripted([original]).call, context([])))
    expect(err instanceof AppError && err.cause).toBe(original)
    expect(err instanceof AppError && err.message).not.toContain('429')
  })
})
