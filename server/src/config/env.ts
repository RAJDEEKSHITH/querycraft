import { z } from 'zod'

// Server environment schema. Must list exactly the variables in server/.env.example.

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ })
const positiveInt = z.coerce.number().int().positive()
const nonNegativeInt = z.coerce.number().int().nonnegative()
const nonNegativeNumber = z.coerce.number().nonnegative()

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    CLIENT_ORIGIN: z.url({ protocol: /^https?$/ }),
    TRUST_PROXY: z.coerce.number().int().min(0).max(1),

    APP_DATABASE_URL: postgresUrl,
    READER_DATABASE_URL: postgresUrl,
    TEST_APP_DATABASE_URL: postgresUrl.optional(),

    GROQ_API_KEY: z.string().min(1),
    LLM_MODEL: z.string().min(1),
    LLM_ANSWER_MODEL: z.string().min(1).optional(),

    GEMINI_API_KEY: z.string().min(1),
    EMBEDDING_MODEL: z.string().min(1),
    EMBEDDING_DIMENSIONS: z.coerce.number().pipe(z.literal(768)),

    LLM_INPUT_PRICE_PER_1M_USD: nonNegativeNumber,
    LLM_OUTPUT_PRICE_PER_1M_USD: nonNegativeNumber,
    EMBEDDING_PRICE_PER_1M_USD: nonNegativeNumber,

    PROVIDER_MAX_RETRIES: nonNegativeInt,
    PROVIDER_MAX_WAIT_MS: positiveInt,

    DAILY_TOKEN_BUDGET: positiveInt,
    EVAL_DAILY_TOKEN_BUDGET: positiveInt,
    RATE_LIMIT_PER_MINUTE: positiveInt,
    QUESTION_MAX_LENGTH: positiveInt,

    QUERY_TIMEOUT_MS: positiveInt,
    QUERY_ROW_LIMIT: positiveInt,
    QUERY_COST_SOFT_LIMIT: z.coerce.number().positive(),
    QUERY_COST_HARD_LIMIT: z.coerce.number().positive(),

    MAX_SQL_ATTEMPTS: positiveInt,
    MAX_CLARIFICATIONS: nonNegativeInt,

    ADMIN_TOKEN: z.string().min(32),
  })
  .superRefine((env, ctx) => {
    if (env.QUERY_COST_HARD_LIMIT <= env.QUERY_COST_SOFT_LIMIT) {
      ctx.addIssue({
        code: 'custom',
        path: ['QUERY_COST_HARD_LIMIT'],
        message: 'must be greater than QUERY_COST_SOFT_LIMIT',
      })
    }
    if (env.NODE_ENV === 'test' && env.TEST_APP_DATABASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TEST_APP_DATABASE_URL'],
        message: 'required when NODE_ENV=test',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

export type EnvParseResult = { ok: true; env: Env } | { ok: false; invalidNames: string[] }

const envNames = Object.keys(envSchema.shape)

/**
 * Validates environment variables. Only schema variables are read; empty values
 * count as missing. On failure returns variable names only, never values.
 */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvParseResult {
  const input: Record<string, string> = {}
  for (const name of envNames) {
    const value = source[name]?.trim()
    if (value !== undefined && value !== '') {
      input[name] = value
    }
  }

  const result = envSchema.safeParse(input)
  if (result.success) {
    return { ok: true, env: result.data }
  }

  const invalidNames = new Set<string>()
  for (const issue of result.error.issues) {
    const name = issue.path[0]
    if (typeof name === 'string') {
      invalidNames.add(name)
    }
  }
  return { ok: false, invalidNames: [...invalidNames].sort() }
}

export function formatInvalidEnvMessage(invalidNames: readonly string[]): string {
  return `Invalid or missing environment variables: ${invalidNames.join(', ')}. See server/.env.example.`
}

let cachedEnv: Env | undefined

/** Parsed process environment, validated once. Throws with variable names only. */
export function getEnv(): Env {
  if (cachedEnv === undefined) {
    const result = parseEnv(process.env)
    if (!result.ok) {
      throw new Error(formatInvalidEnvMessage(result.invalidNames))
    }
    cachedEnv = result.env
  }
  return cachedEnv
}
