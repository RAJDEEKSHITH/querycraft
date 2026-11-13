import { createHash } from 'node:crypto'
import type { RateLimitSignal } from '../lib/provider-retry.js'
import type { EmbeddingProvider } from './embeddings.js'

// Deterministic mock embeddings for tests and `eval:run --dry-run` (no provider calls).
// Each word is hashed to one signed dimension, so texts that share words have a
// higher cosine similarity, and identical texts get identical vectors.

export const MOCK_EMBEDDING_MODEL = 'mock-embedding'

/** Lower-cased alphanumeric words. */
export function mockWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

export function mockVector(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0)
  const words = mockWords(text)
  for (const word of words) {
    const digest = createHash('sha256').update(word).digest()
    const index = digest.readUInt32BE(0) % dimensions
    const sign = (digest[4] ?? 0) % 2 === 0 ? 1 : -1
    vector[index] = (vector[index] ?? 0) + sign
  }
  if (words.length === 0) {
    vector[0] = 1 // never a zero vector: cosine distance to it is undefined
  }
  const norm = Math.hypot(...vector)
  return vector.map((v) => v / norm)
}

export interface MockEmbeddingProvider extends EmbeddingProvider {
  /** Provider requests made (one per batch). */
  readonly requests: number
  /** Texts embedded across all requests. */
  readonly texts: number
}

/**
 * Mock provider. Tokens are counted as words. `failures` makes the next requests
 * throw the given errors first (for rate-limit tests), recognised by `classify`.
 */
export function createMockEmbeddingProvider(
  options: {
    dimensions?: number
    failures?: Error[]
    classify?: (err: unknown) => RateLimitSignal | undefined
  } = {},
): MockEmbeddingProvider {
  const dimensions = options.dimensions ?? 768
  const failures = [...(options.failures ?? [])]
  let requests = 0
  let texts = 0
  return {
    model: MOCK_EMBEDDING_MODEL,
    dimensions,
    get requests() {
      return requests
    },
    get texts() {
      return texts
    },
    classifyRateLimit: (err) => options.classify?.(err),
    embedBatch(batch) {
      requests += 1
      const failure = failures.shift()
      if (failure !== undefined) {
        return Promise.reject(failure)
      }
      texts += batch.length
      return Promise.resolve({
        vectors: batch.map((t) => mockVector(t, dimensions)),
        tokens: batch.reduce((sum, t) => sum + mockWords(t).length, 0),
      })
    },
  }
}
