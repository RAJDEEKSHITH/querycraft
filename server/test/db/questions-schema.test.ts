import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { createTestQuestion } from '../helpers/questions.js'

// M3 tables in querycraft_test (IMPLEMENTATION.md 10.3), read from the catalog
// after `pnpm db:migrate`.

afterAll(async () => {
  await closeAppPool()
})

async function columnTypes(table: string): Promise<Record<string, string>> {
  const result = await getAppPool().query<{ name: string; type: string }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  )
  return Object.fromEntries(result.rows.map((r) => [r.name, r.type]))
}

describe('M3 conversation schema', () => {
  it('questions has the 10.3 columns with numeric money and integer tokens', async () => {
    const cols = await columnTypes('questions')
    expect(Object.keys(cols).sort()).toEqual(
      [
        'id', 'conversation_id', 'question', 'status', 'final_sql', 'answer', 'explanation', 'tables_used',
        'assumptions', 'result_columns', 'row_count', 'truncated', 'attempts', 'trace', 'error_code',
        'prompt_tokens', 'completion_tokens', 'embedding_tokens', 'cost_usd', 'latency_ms', 'created_at',
        'completed_at',
      ].sort(),
    )
    expect(cols['cost_usd']).toBe('numeric(12,6)')
    expect(cols['prompt_tokens']).toBe('integer')
    expect(cols['created_at']).toBe('timestamp with time zone')
  })

  it('has the question status enum from 10.3', async () => {
    const result = await getAppPool().query<{ v: string }>(
      "SELECT unnest(enum_range(NULL::question_status))::text AS v",
    )
    expect(result.rows.map((r) => r.v)).toEqual([
      'running', 'awaiting_clarification', 'awaiting_approval', 'answered', 'blocked', 'cannot_answer', 'failed', 'cancelled',
    ])
  })

  it('indexes questions by conversation and creation time', async () => {
    const result = await getAppPool().query<{ def: string }>("SELECT indexdef AS def FROM pg_indexes WHERE tablename = 'questions'")
    expect(result.rows.some((r) => r.def.includes('(conversation_id, created_at)'))).toBe(true)
  })

  it('rejects a question without a conversation and an audit row for an unknown question', async () => {
    await expect(
      getAppPool().query('INSERT INTO questions (conversation_id, question) VALUES ($1, $2)', [randomUUID(), 'q']),
    ).rejects.toThrow(/foreign key/)
    await expect(
      getAppPool().query(
        "INSERT INTO audit_events (question_id, source, stage, decision, rule, message) VALUES ($1, 'app', 'input', 'allowed', 'R', 'm')",
        [randomUUID()],
      ),
    ).rejects.toThrow(/foreign key/)
  })

  it('creates a running question with zero usage and an empty trace', async () => {
    const id = await createTestQuestion('How many orders?')
    const row = await getAppPool().query('SELECT status, attempts, trace, prompt_tokens, cost_usd FROM questions WHERE id = $1', [id])
    expect(row.rows[0]).toEqual({ status: 'running', attempts: 0, trace: [], prompt_tokens: 0, cost_usd: '0.000000' })
  })
})
