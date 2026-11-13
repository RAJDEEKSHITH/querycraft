import { ApiError } from '@google/genai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { AppError } from '../../src/lib/errors.js'
import {
  classifyGeminiRateLimit,
  createEmbeddingsClient,
  createGeminiEmbeddingsClient,
  geminiRetryDelayMs,
} from '../../src/retrieval/embeddings.js'
import { createMockEmbeddingProvider, mockVector } from '../../src/retrieval/mock-embeddings.js'

// Fixed settings for this file (env is cached per test file). The API key is fake:
// the real-provider tests below replace global fetch, so nothing leaves the process.
vi.stubEnv('GEMINI_API_KEY', 'test-fake-gemini-key')
vi.stubEnv('EMBEDDING_MODEL', 'gemini-embedding-001')
vi.stubEnv('PROVIDER_MAX_RETRIES', '3')
vi.stubEnv('PROVIDER_MAX_WAIT_MS', '30000')
vi.stubEnv('DAILY_TOKEN_BUDGET', '1000')
vi.stubEnv('EMBEDDING_PRICE_PER_1M_USD', '0')

/** A Gemini 429 body as the API returns it (RetryInfo detail with the delay). */
function quotaBody(retryDelay?: string): Record<string, unknown> {
  const details: Record<string, unknown>[] = [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'embed_requests' }] },
  ]
  if (retryDelay !== undefined) {
    details.push({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay })
  }
  return { error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED', details } }
}

function geminiError(status: number, body: unknown): ApiError {
  return new ApiError({ status, message: JSON.stringify(body) })
}

interface UsageRow {
  source: string
  embedding_tokens: number
  embedding_requests: number
  llm_tokens: number
}

async function usage(): Promise<UsageRow[]> {
  const result = await getAppPool().query<UsageRow>(
    'SELECT source, embedding_tokens, embedding_requests, llm_tokens FROM daily_usage ORDER BY source',
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

beforeEach(async () => {
  await getAppPool().query('TRUNCATE daily_usage')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await closeAppPool()
})

describe('Gemini retry delay', () => {
  it.each([
    ['17s', 17_000],
    ['0.5s', 500],
    ['1.0001s', 1_001],
  ])('reads RetryInfo %s', (delay, ms) => {
    expect(geminiRetryDelayMs(JSON.stringify(quotaBody(delay)))).toBe(ms)
  })

  it.each([
    ['no RetryInfo', JSON.stringify(quotaBody())],
    ['not JSON', 'Too Many Requests'],
    ['odd format', JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17' }] } })],
    ['no details', JSON.stringify({ error: { code: 429 } })],
  ])('returns undefined for %s', (_name, message) => {
    expect(geminiRetryDelayMs(message)).toBeUndefined()
  })

  it('classifies only ApiError 429 as a rate limit', () => {
    expect(classifyGeminiRateLimit(geminiError(429, quotaBody('3s')))).toEqual({ retryAfterMs: 3_000 })
    expect(classifyGeminiRateLimit(geminiError(429, quotaBody()))).toEqual({ retryAfterMs: undefined })
    expect(classifyGeminiRateLimit(geminiError(400, quotaBody('3s')))).toBeUndefined()
    expect(classifyGeminiRateLimit(new Error('429'))).toBeUndefined()
  })
})

describe('embeddings client (mock provider)', () => {
  it('returns one vector per text, in order, and records usage', async () => {
    const provider = createMockEmbeddingProvider()
    const client = createEmbeddingsClient(provider)
    const vectors = await client.embed(['red bike', 'blue helmet please'], { task: 'document', source: 'app' })
    expect(vectors).toEqual([mockVector('red bike', 768), mockVector('blue helmet please', 768)])
    expect(await usage()).toEqual([{ source: 'app', embedding_tokens: 5, embedding_requests: 1, llm_tokens: 0 }])
  })

  it('sends at most 100 texts per request', async () => {
    const provider = createMockEmbeddingProvider()
    const client = createEmbeddingsClient(provider)
    const texts = Array.from({ length: 250 }, (_, i) => `text ${i}`)
    const vectors = await client.embed(texts, { task: 'document', source: 'eval' })
    expect(vectors).toHaveLength(250)
    expect(provider.requests).toBe(3)
    expect(await usage()).toEqual([{ source: 'eval', embedding_tokens: 500, embedding_requests: 3, llm_tokens: 0 }])
  })

  it('refuses before calling the provider when the LLM budget is used up', async () => {
    await getAppPool().query(
      `INSERT INTO daily_usage (day, source, llm_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'app', 1000)`,
    )
    const provider = createMockEmbeddingProvider()
    const err = await caught(createEmbeddingsClient(provider).embed(['q'], { task: 'query', source: 'mcp' }))
    expect(err instanceof AppError && err.code).toBe('BUDGET_EXCEEDED')
    expect(provider.requests).toBe(0)
  })

  it('is not capped for evaluation runs', async () => {
    await getAppPool().query(
      `INSERT INTO daily_usage (day, source, llm_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'app', 1000)`,
    )
    const provider = createMockEmbeddingProvider()
    await expect(createEmbeddingsClient(provider).embed(['q'], { task: 'query', source: 'eval' })).resolves.toHaveLength(1)
  })

  it('waits on a 429 with a delay, then succeeds and records one request', async () => {
    const sleeps: number[] = []
    const provider = createMockEmbeddingProvider({
      failures: [geminiError(429, quotaBody('2s'))],
      classify: classifyGeminiRateLimit,
    })
    const client = createEmbeddingsClient(provider, {
      sleep: (ms) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
    })
    await expect(client.embed(['q'], { task: 'query', source: 'app' })).resolves.toHaveLength(1)
    expect(sleeps).toEqual([2_000])
    expect(provider.requests).toBe(2)
    expect((await usage())[0]?.embedding_requests).toBe(1)
  })

  it('fails with UPSTREAM_RATE_LIMITED when the delay exceeds the wait limit', async () => {
    const provider = createMockEmbeddingProvider({
      failures: [geminiError(429, quotaBody('3600s'))],
      classify: classifyGeminiRateLimit,
    })
    const err = await caught(createEmbeddingsClient(provider, { sleep: noSleep }).embed(['q'], { task: 'query', source: 'app' }))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(err instanceof AppError && err.details).toEqual({ retryAfterSeconds: 3600 })
    expect(provider.requests).toBe(1)
    expect(await usage()).toEqual([])
  })

  it('fails at once on a 429 without a delay', async () => {
    const provider = createMockEmbeddingProvider({
      failures: [geminiError(429, quotaBody())],
      classify: classifyGeminiRateLimit,
    })
    const err = await caught(createEmbeddingsClient(provider, { sleep: noSleep }).embed(['q'], { task: 'query', source: 'app' }))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(provider.requests).toBe(1)
  })

  it('does not retry other provider errors and hides their text', async () => {
    const provider = createMockEmbeddingProvider({
      failures: [geminiError(400, { error: { code: 400, message: 'API key not valid. secret-detail' } })],
      classify: classifyGeminiRateLimit,
    })
    const err = await caught(createEmbeddingsClient(provider, { sleep: noSleep }).embed(['q'], { task: 'query', source: 'app' }))
    expect(err instanceof AppError && err.code).toBe('INTERNAL_ERROR')
    expect(err instanceof AppError && err.message).toBe('Embedding request failed')
    expect(provider.requests).toBe(1)
  })

  it('rejects vectors of the wrong size', async () => {
    const provider = { ...createMockEmbeddingProvider(), dimensions: 768 }
    const wrong = createMockEmbeddingProvider({ dimensions: 4 })
    const client = createEmbeddingsClient({ ...provider, embedBatch: (t, task) => wrong.embedBatch(t, task) })
    const err = await caught(client.embed(['q'], { task: 'query', source: 'app' }))
    expect(err instanceof AppError && err.code).toBe('INTERNAL_ERROR')
    expect(await usage()).toEqual([])
  })

  it('rejects empty text', async () => {
    const provider = createMockEmbeddingProvider()
    const err = await caught(createEmbeddingsClient(provider).embed(['ok', '  '], { task: 'document', source: 'app' }))
    expect(err instanceof AppError && err.code).toBe('INTERNAL_ERROR')
    expect(provider.requests).toBe(0)
  })
})

describe('mock vectors', () => {
  function cosine(a: number[], b: number[]): number {
    return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
  }

  it('are deterministic unit vectors', () => {
    const v = mockVector('Total sales by territory', 768)
    expect(mockVector('total SALES by territory!', 768)).toEqual(v)
    expect(Math.hypot(...v)).toBeCloseTo(1, 10)
    expect(Math.hypot(...mockVector('', 768))).toBeCloseTo(1, 10)
  })

  it('are closer for texts that share words', () => {
    const q = mockVector('sales order header totals', 768)
    expect(cosine(q, mockVector('sales order header', 768))).toBeGreaterThan(cosine(q, mockVector('employee department', 768)))
  })
})

describe('Gemini provider over HTTP (fetch replaced, no network)', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  it('sends one batch request with task type and 768 dimensions, and reads usage', async () => {
    const requests: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(typeof init.body === 'string' ? init.body : '') as unknown })
      return Promise.resolve(
        jsonResponse(200, {
          embeddings: [{ values: mockVector('a', 768) }, { values: mockVector('b', 768) }],
          usageMetadata: { promptTokenCount: 7 },
        }),
      )
    })
    const vectors = await createGeminiEmbeddingsClient().embed(['first text', 'second text'], {
      task: 'query',
      source: 'app',
    })
    expect(vectors).toHaveLength(2)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain('gemini-embedding-001:batchEmbedContents')
    expect(JSON.stringify(requests[0]?.body)).toContain('"taskType":"RETRIEVAL_QUERY"')
    expect(JSON.stringify(requests[0]?.body)).toContain('"outputDimensionality":768')
    expect(await usage()).toEqual([{ source: 'app', embedding_tokens: 7, embedding_requests: 1, llm_tokens: 0 }])
  })

  it('reads the retry delay from a real SDK ApiError and retries', async () => {
    const responses = [
      jsonResponse(429, quotaBody('0.001s')),
      jsonResponse(200, { embeddings: [{ values: mockVector('a', 768) }], usageMetadata: { promptTokenCount: 2 } }),
    ]
    let calls = 0
    vi.stubGlobal('fetch', () => {
      const response = responses[calls]
      calls += 1
      return Promise.resolve(response)
    })
    await expect(createGeminiEmbeddingsClient().embed(['q'], { task: 'query', source: 'app' })).resolves.toHaveLength(1)
    expect(calls).toBe(2)
  })

  it('gives up with UPSTREAM_RATE_LIMITED when the SDK error has no delay', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls += 1
      return Promise.resolve(jsonResponse(429, quotaBody()))
    })
    const err = await caught(createGeminiEmbeddingsClient().embed(['q'], { task: 'query', source: 'app' }))
    expect(err instanceof AppError && err.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(calls).toBe(1)
  })
})
