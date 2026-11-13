import { describe, expect, it } from 'vitest'
import { embeddingCostMicroUsd, llmCostMicroUsd, microUsdToNumeric } from '../../src/lib/cost.js'

describe('cost accounting', () => {
  it('is zero on free tiers', () => {
    expect(llmCostMicroUsd(12_000, 800, { inputPer1MUsd: 0, outputPer1MUsd: 0 })).toBe(0)
    expect(embeddingCostMicroUsd(5_000, 0)).toBe(0)
  })

  it('computes paid-tier costs in micro-dollars', () => {
    // 1M input tokens at $0.15 = 150 000 micro-dollars; 1 000 output tokens at $0.60/1M = 600.
    expect(llmCostMicroUsd(1_000_000, 1_000, { inputPer1MUsd: 0.15, outputPer1MUsd: 0.6 })).toBe(150_600)
    expect(embeddingCostMicroUsd(2_000, 0.15)).toBe(300)
    expect(embeddingCostMicroUsd(3, 0.15)).toBe(0) // 0.45 rounds down
  })

  it('rejects invalid token counts', () => {
    expect(() => llmCostMicroUsd(-1, 0, { inputPer1MUsd: 0, outputPer1MUsd: 0 })).toThrow(RangeError)
    expect(() => embeddingCostMicroUsd(1.5, 0)).toThrow(RangeError)
  })

  it('formats micro-dollars as exact numeric text', () => {
    expect(microUsdToNumeric(0)).toBe('0.000000')
    expect(microUsdToNumeric(7)).toBe('0.000007')
    expect(microUsdToNumeric(150_600)).toBe('0.150600')
    expect(microUsdToNumeric(123_456_789)).toBe('123.456789')
    expect(() => microUsdToNumeric(-1)).toThrow(RangeError)
    expect(() => microUsdToNumeric(0.5)).toThrow(RangeError)
  })
})
