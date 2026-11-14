import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Provider free-tier limits (IMPLEMENTATION.md 17, 20.5): kept by the user in
// evals/provider-limits.json, never hardcoded. Copied into every run header and
// used by the baseline fit check.

const modelLimits = z.strictObject({
  provider: z.enum(['groq', 'gemini']),
  rpm: z.number().int().positive(),
  rpd: z.number().int().positive(),
  tpm: z.number().int().positive(),
  tpd: z.number().int().positive().nullable(),
})

export const providerLimitsSchema = z.strictObject({
  recordedAt: z.iso.date(),
  source: z.string().min(1),
  models: z.record(z.string().min(1), modelLimits),
})

export type ProviderLimits = z.infer<typeof providerLimitsSchema>
export type ModelLimits = z.infer<typeof modelLimits>

export const PROVIDER_LIMITS_PATH = fileURLToPath(new URL('./provider-limits.json', import.meta.url))

export async function loadProviderLimits(path = PROVIDER_LIMITS_PATH): Promise<ProviderLimits> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`${path} is missing or not valid JSON`)
  }
  const parsed = providerLimitsSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`${path}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`)
  }
  return parsed.data
}
