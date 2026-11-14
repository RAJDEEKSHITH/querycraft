import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { envSchema, formatInvalidEnvMessage, parseEnv } from '../../src/config/env.js'

// Obviously fake values only.
const validEnv: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '4000',
  LOG_LEVEL: 'info',
  CLIENT_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY: '0',
  APP_DATABASE_URL: 'postgres://fake_user:fake_pw@localhost:5432/fake_app',
  READER_DATABASE_URL: 'postgres://fake_user:fake_pw@localhost:5432/fake_reader',
  TEST_APP_DATABASE_URL: 'postgres://fake_user:fake_pw@localhost:5432/fake_test',
  GROQ_API_KEY: 'fake-groq-key',
  LLM_MODEL: 'fake-chat-model',
  LLM_ANSWER_MODEL: 'fake-answer-model',
  GEMINI_API_KEY: 'fake-gemini-key',
  EMBEDDING_MODEL: 'fake-embedding-model',
  EMBEDDING_DIMENSIONS: '768',
  LLM_INPUT_PRICE_PER_1M_USD: '0',
  LLM_OUTPUT_PRICE_PER_1M_USD: '0',
  EMBEDDING_PRICE_PER_1M_USD: '0',
  PROVIDER_MAX_RETRIES: '3',
  PROVIDER_MAX_WAIT_MS: '30000',
  DAILY_TOKEN_BUDGET: '100000',
  EVAL_DAILY_TOKEN_BUDGET: '100000',
  RATE_LIMIT_PER_MINUTE: '10',
  QUESTION_MAX_LENGTH: '500',
  QUERY_TIMEOUT_MS: '5000',
  QUERY_ROW_LIMIT: '500',
  QUERY_COST_SOFT_LIMIT: '50000',
  QUERY_COST_HARD_LIMIT: '500000',
  MAX_SQL_ATTEMPTS: '3',
  MAX_CLARIFICATIONS: '2',
  ADMIN_TOKEN: 'fake-admin-token-0000000000000000000000',
}

function invalidNames(overrides: Record<string, string | undefined>): string[] {
  const result = parseEnv({ ...validEnv, ...overrides })
  return result.ok ? [] : result.invalidNames
}

describe('env schema', () => {
  it('lists exactly the variables in server/.env.example', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    const exampleNames = example
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined)
      .sort()
    expect(Object.keys(envSchema.shape).sort()).toEqual(exampleNames)
  })

  it('accepts a complete valid environment and coerces numbers', () => {
    const result = parseEnv(validEnv)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.env.PORT).toBe(4000)
      expect(result.env.EMBEDDING_DIMENSIONS).toBe(768)
      expect(result.env.LLM_INPUT_PRICE_PER_1M_USD).toBe(0)
    }
  })

  it('treats an empty optional LLM_ANSWER_MODEL as unset', () => {
    const result = parseEnv({ ...validEnv, LLM_ANSWER_MODEL: '' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.env.LLM_ANSWER_MODEL).toBeUndefined()
    }
  })

  it('treats empty required values as missing', () => {
    expect(invalidNames({ GROQ_API_KEY: '', GEMINI_API_KEY: '  ', PORT: '' })).toEqual([
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'PORT',
    ])
  })

  it('reports missing variables by name', () => {
    expect(invalidNames({ APP_DATABASE_URL: undefined, ADMIN_TOKEN: undefined })).toEqual([
      'ADMIN_TOKEN',
      'APP_DATABASE_URL',
    ])
  })

  it.each([
    ['PORT', 'not-a-number'],
    ['PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['CLIENT_ORIGIN', 'not a url'],
    ['TRUST_PROXY', '2'],
    ['APP_DATABASE_URL', 'mysql://fake_user:fake_pw@localhost/fake'],
    ['READER_DATABASE_URL', 'not a url'],
    ['EMBEDDING_DIMENSIONS', '512'],
    ['LLM_INPUT_PRICE_PER_1M_USD', '-1'],
    ['PROVIDER_MAX_RETRIES', '1.5'],
    ['DAILY_TOKEN_BUDGET', '0'],
    ['EVAL_DAILY_TOKEN_BUDGET', '0'],
    ['MAX_SQL_ATTEMPTS', '0'],
    ['ADMIN_TOKEN', 'too-short'],
  ])('rejects %s=%s', (name, value) => {
    expect(invalidNames({ [name]: value })).toEqual([name])
  })

  it('requires the hard cost limit to exceed the soft limit', () => {
    expect(invalidNames({ QUERY_COST_HARD_LIMIT: '50000' })).toEqual(['QUERY_COST_HARD_LIMIT'])
  })

  it('requires TEST_APP_DATABASE_URL only when NODE_ENV=test', () => {
    expect(invalidNames({ NODE_ENV: 'development', TEST_APP_DATABASE_URL: undefined })).toEqual([])
    expect(invalidNames({ NODE_ENV: 'test', TEST_APP_DATABASE_URL: undefined })).toEqual([
      'TEST_APP_DATABASE_URL',
    ])
  })

  it('never includes values in the failure result or message', () => {
    const secret = 'fake-secret-value-that-must-not-leak'
    const result = parseEnv({
      ...validEnv,
      ADMIN_TOKEN: 'short-' + secret.slice(0, 4),
      APP_DATABASE_URL: secret,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const output = JSON.stringify(result) + formatInvalidEnvMessage(result.invalidNames)
      expect(output).not.toContain(secret)
      expect(output).not.toContain('short-')
      expect(formatInvalidEnvMessage(result.invalidNames)).toBe(
        'Invalid or missing environment variables: ADMIN_TOKEN, APP_DATABASE_URL. See server/.env.example.',
      )
    }
  })

  it('ignores variables that are not in the schema', () => {
    expect(parseEnv({ ...validEnv, UNRELATED_VARIABLE: 'x' }).ok).toBe(true)
  })
})
