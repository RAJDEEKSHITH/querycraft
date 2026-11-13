import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyGroqRateLimit, createGroqLlmClient, createLlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider } from '../../src/agent/mock-llm.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { AppError } from '../../src/lib/errors.js'

// Fixed settings for this file (env is cached per test file). The API key is fake:
// the Groq tests replace global fetch, so nothing leaves the process.
vi.stubEnv('GROQ_API_KEY', 'test-fake-groq-key')
vi.stubEnv('LLM_MODEL', 'main-model')
vi.stubEnv('LLM_ANSWER_MODEL', 'answer-model')
vi.stubEnv('PROVIDER_MAX_RETRIES', '3')
vi.stubEnv('PROVIDER_MAX_WAIT_MS', '30000')
vi.stubEnv('DAILY_TOKEN_BUDGET', '1000')
vi.stubEnv('LLM_INPUT_PRICE_PER_1M_USD', '0.15')
vi.stubEnv('LLM_OUTPUT_PRICE_PER_1M_USD', '0.6')

class FakeGroqError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(`${status} status code`)
  }
}

function rateLimit(retryAfter?: string): FakeGroqError {
  const headers = new Headers()
  if (retryAfter !== undefined) headers.set('retry-after', retryAfter)
  return new FakeGroqError(429, headers)
}

interface UsageRow {
  source: string
  llm_tokens: number
  llm_requests: number
  embedding_tokens: number
  cost_usd: string
}

async function usage(): Promise<UsageRow[]> {
  const result = await getAppPool().query<UsageRow>(
    'SELECT source, llm_tokens, llm_requests, embedding_tokens, cost_usd FROM daily_usage ORDER BY source',
  )
  return result.rows
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  )
}

const noSleep = (): Promise<void> => Promise.resolve()
const system = { role: 'system', content: 'Be brief.' } as const
const user = { role: 'user', content: 'Say hello' } as const

beforeEach(async () => {
  await getAppPool().query('TRUNCATE daily_usage')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await closeAppPool()
})

describe('Groq rate-limit classification', () => {
  it.each([
    ['7', 7_000],
    ['0.25', 250],
  ])('reads retry-after %s', (header, ms) => {
    expect(classifyGroqRateLimit(rateLimit(header))).toEqual({ retryAfterMs: ms })
  })

  it('has no delay without a usable retry-after header', () => {
    expect(classifyGroqRateLimit(rateLimit())).toEqual({ retryAfterMs: undefined })
    expect(classifyGroqRateLimit(rateLimit('Wed, 21 Oct 2026 07:28:00 GMT'))).toEqual({ retryAfterMs: undefined })
  })

  it('ignores other errors', () => {
    expect(classifyGroqRateLimit(new FakeGroqError(400, new Headers({ 'retry-after': '1' })))).toBeUndefined()
    expect(classifyGroqRateLimit(new Error('429'))).toBeUndefined()
  })
})

describe('LLM client (mock provider)', () => {
  it('returns the text, uses LLM_MODEL for main, and records usage with cost', async () => {
    const provider = createMockChatProvider(() => 'Hello there')
    const result = await createLlmClient(provider).chat([system, user], { source: 'app', model: 'main' })
    expect(result).toEqual({ text: 'Hello there', model: 'main-model', inputTokens: 5, outputTokens: 2 })
    expect(provider.requests[0]?.model).toBe('main-model')
    // 5 × 0.15 + 2 × 0.6 = 1.95 → 2 micro-dollars.
    expect(await usage()).toEqual([{ source: 'app', llm_tokens: 7, llm_requests: 1, embedding_tokens: 0, cost_usd: '0.000002' }])
  })

  it('uses LLM_ANSWER_MODEL for the answer role', async () => {
    const provider = createMockChatProvider(() => 'ok')
    await createLlmClient(provider).chat([user], { source: 'eval', model: 'answer' })
    expect(provider.requests[0]?.model).toBe('answer-model')
  })

  it('blocks at the daily token budget before calling the provider', async () => {
    await getAppPool().query(
      `INSERT INTO daily_usage (day, source, llm_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'mcp', 1000)`,
    )
    const provider = createMockChatProvider(() => 'ok')
    const err = await caught(createLlmClient(provider).chat([user], { source: 'app', model: 'main' }))
    expect(err instanceof AppError && err.code).toBe('BUDGET_EXCEEDED')
    expect(provider.requests).toHaveLength(0)
  })

  it('stops once recorded usage reaches the cap', async () => {
    const provider = createMockChatProvider(() => Array.from({ length: 600 }, () => 'word').join(' '))
    const client = createLlmClient(provider)
    await client.chat([user], { source: 'app', model: 'main' })
    await client.chat([user], { source: 'app', model: 'main' }) // overshoots by one call (D15)
    const err = await caught(client.chat([user], { source: 'app', model: 'main' }))
    expect(err instanceof AppError && err.code).toBe('BUDGET_EXCEEDED')
    expect(provider.requests).toHaveLength(2)
  })

  it('waits on a 429 with retry-after, then succeeds', async () => {
    const replies = [rateLimit('3'), 'done']
    const sleeps: number[] = []
    const provider = createMockChatProvider(() => replies.shift() ?? 'unexpected', classifyGroqRateLimit)
    const client = createLlmClient(provider, {
      sleep: (ms) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
    })
    await expect(client.chat([user], { source: 'app', model: 'main' })).resolves.toMatchObject({ text: 'done' })
    expect(sleeps).toEqual([3_000])
    expect((await usage())[0]?.llm_requests).toBe(1)
  })

  it('fails with UPSTREAM_RATE_LIMITED when retry-after exceeds the wait limit', async () => {
    const provider = createMockChatProvider(() => rateLimit('120'), classifyGroqRateLimit)
    const err = await caught(createLlmClient(provider, { sleep: noSleep }).chat([user], { source: 'app', model: 'main' }))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(err instanceof AppError && err.details).toEqual({ retryAfterSeconds: 120 })
    expect(provider.requests).toHaveLength(1)
  })

  it('maps other provider errors to INTERNAL_ERROR without retrying', async () => {
    const provider = createMockChatProvider(
      () => new FakeGroqError(401, new Headers()),
      classifyGroqRateLimit,
    )
    const err = await caught(createLlmClient(provider, { sleep: noSleep }).chat([user], { source: 'app', model: 'main' }))
    expect(err instanceof AppError && err.code).toBe('INTERNAL_ERROR')
    expect(err instanceof AppError && err.message).toBe('Language model request failed')
    expect(provider.requests).toHaveLength(1)
  })

  it('records usage even when the reply is empty, then fails', async () => {
    const provider = createMockChatProvider(() => '   ')
    const err = await caught(createLlmClient(provider).chat([user], { source: 'app', model: 'main' }))
    expect(err instanceof AppError && err.code).toBe('INTERNAL_ERROR')
    expect((await usage())[0]?.llm_requests).toBe(1)
  })
})

describe('Groq provider over HTTP (fetch replaced, no network)', () => {
  function completion(text: string): Response {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'main-model',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  function tooManyRequests(retryAfter?: string): Response {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (retryAfter !== undefined) headers['retry-after'] = retryAfter
    return new Response(JSON.stringify({ error: { message: 'Rate limit reached', type: 'tokens' } }), {
      status: 429,
      headers,
    })
  }

  it('sends temperature 0 to the chat model and reads usage', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '{}') as unknown)
      return Promise.resolve(completion('Hi'))
    })
    const result = await createGroqLlmClient().chat([system, user], { source: 'app', model: 'main' })
    expect(result).toEqual({ text: 'Hi', model: 'main-model', inputTokens: 11, outputTokens: 4 })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ model: 'main-model', temperature: 0 })
    expect((await usage())[0]).toMatchObject({ llm_tokens: 15, llm_requests: 1 })
  })

  it('retries a real SDK 429 after retry-after and never retries inside the SDK', async () => {
    const responses = [tooManyRequests('0.001'), completion('After wait')]
    let calls = 0
    vi.stubGlobal('fetch', () => {
      const response = responses[calls]
      calls += 1
      return Promise.resolve(response)
    })
    await expect(createGroqLlmClient().chat([user], { source: 'app', model: 'main' })).resolves.toMatchObject({
      text: 'After wait',
    })
    expect(calls).toBe(2)
  })

  it('gives up at once on a real SDK 429 without retry-after', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls += 1
      return Promise.resolve(tooManyRequests())
    })
    const err = await caught(createGroqLlmClient().chat([user], { source: 'app', model: 'main' }))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(calls).toBe(1)
  })
})
