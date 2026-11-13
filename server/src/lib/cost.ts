// Cost accounting (IMPLEMENTATION.md 17). Money is integer micro-dollars in
// TypeScript and numeric(12,6) in the database. Prices are USD per 1M tokens,
// so the price is exactly the cost of one token in micro-dollars.

export interface LlmPrices {
  inputPer1MUsd: number
  outputPer1MUsd: number
}

function assertTokenCount(tokens: number): void {
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new RangeError('Token counts must be non-negative integers')
  }
}

/** Cost of one chat call in micro-dollars, rounded to the nearest micro-dollar. */
export function llmCostMicroUsd(inputTokens: number, outputTokens: number, prices: LlmPrices): number {
  assertTokenCount(inputTokens)
  assertTokenCount(outputTokens)
  return Math.round(inputTokens * prices.inputPer1MUsd + outputTokens * prices.outputPer1MUsd)
}

/** Cost of one embedding call in micro-dollars, rounded to the nearest micro-dollar. */
export function embeddingCostMicroUsd(tokens: number, pricePer1MUsd: number): number {
  assertTokenCount(tokens)
  return Math.round(tokens * pricePer1MUsd)
}

/** Exact decimal text for a numeric(12,6) column, without floating-point division. */
export function microUsdToNumeric(microUsd: number): string {
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) {
    throw new RangeError('Micro-dollar amounts must be non-negative integers')
  }
  const digits = String(microUsd).padStart(7, '0')
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`
}
