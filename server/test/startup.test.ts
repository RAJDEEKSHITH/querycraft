import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const serverRoot = fileURLToPath(new URL('..', import.meta.url))

// A complete, obviously fake environment. Passing every variable explicitly means
// server/.env cannot change the outcome (dotenv never overrides existing values).
const fakeEnv: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '4000',
  LOG_LEVEL: 'silent',
  CLIENT_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY: '0',
  APP_DATABASE_URL: 'postgres://fake_user:fake_pw@localhost:1/fake_app',
  READER_DATABASE_URL: 'postgres://fake_user:fake_pw@localhost:1/fake_reader',
  TEST_APP_DATABASE_URL: 'postgres://fake_user:fake_pw@localhost:1/fake_test',
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

describe('server startup', () => {
  it('exits with code 1 and lists invalid variable names only', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverRoot,
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        ...fakeEnv,
        PORT: 'fake-invalid-port',
        GROQ_API_KEY: '',
      },
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Invalid or missing environment variables: GROQ_API_KEY, PORT. See server/.env.example.',
    )
    expect(result.stderr + result.stdout).not.toContain('fake-invalid-port')
    expect(result.stderr + result.stdout).not.toContain('fake_pw')
  }, 40_000)
})
