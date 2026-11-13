import { z } from 'zod'
import { classifyDatabaseError, extendedQuery, runReadOnly, type DbFailure } from './executor.js'

// Safety layer 3: cost check (IMPLEMENTATION.md 13.2). Plain EXPLAIN in a read-only
// transaction; EXPLAIN ANALYZE would execute the query and is never issued (D9).

export type CostResult = { ok: true; totalCost: number } | DbFailure

export type CostLevel = 'ok' | 'over_soft' | 'over_hard'

export interface CostLimits {
  soft: number
  hard: number
}

const planSchema = z
  .array(z.object({ Plan: z.object({ 'Total Cost': z.number().nonnegative() }) }))
  .length(1)

const explainRowSchema = z.object({ 'QUERY PLAN': planSchema })

/** Estimated total plan cost of an already validated and limited SELECT. */
export async function explainCost(sql: string, timeoutMs: number): Promise<CostResult> {
  try {
    return await runReadOnly(timeoutMs, async (client): Promise<CostResult> => {
      const result = await client.query(extendedQuery(`EXPLAIN (FORMAT JSON) ${sql}`))
      const [row] = z.array(explainRowSchema).length(1).parse(result.rows)
      return { ok: true, totalCost: row?.['QUERY PLAN'][0]?.Plan['Total Cost'] ?? Number.POSITIVE_INFINITY }
    })
  } catch (err) {
    return classifyDatabaseError(err)
  }
}

/** Above the hard limit blocks; above the soft limit needs approval (or blocks, per caller). */
export function classifyCost(totalCost: number, limits: CostLimits): CostLevel {
  if (totalCost > limits.hard) return 'over_hard'
  if (totalCost > limits.soft) return 'over_soft'
  return 'ok'
}
