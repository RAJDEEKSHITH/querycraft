import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { createTestQuestion } from '../helpers/questions.js'

// M5 `feedback` table in querycraft_test (IMPLEMENTATION.md 10.3), read from the
// catalog after `pnpm db:migrate`.

afterAll(async () => {
  await closeAppPool()
})

describe('M5 feedback schema', () => {
  it('has the 10.3 columns', async () => {
    const result = await getAppPool().query<{ name: string; type: string; nullable: boolean }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
         FROM pg_attribute a WHERE a.attrelid = 'feedback'::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    )
    const cols = Object.fromEntries(result.rows.map((r) => [r.name, r]))
    expect(Object.keys(cols).sort()).toEqual(['comment', 'created_at', 'id', 'question_id', 'rating'])
    expect(cols['id']?.type).toBe('uuid')
    expect(cols['rating']?.type).toBe('feedback_rating')
    expect(cols['comment']?.nullable).toBe(true)
    expect(cols['question_id']?.nullable).toBe(false)
    expect(cols['created_at']?.type).toBe('timestamp with time zone')
  })

  it('has the rating enum up / down', async () => {
    const result = await getAppPool().query<{ v: string }>('SELECT unnest(enum_range(NULL::feedback_rating))::text AS v')
    expect(result.rows.map((r) => r.v)).toEqual(['up', 'down'])
  })

  it('allows one rating per existing question', async () => {
    const questionId = await createTestQuestion()
    await getAppPool().query("INSERT INTO feedback (question_id, rating) VALUES ($1, 'up')", [questionId])
    await expect(getAppPool().query("INSERT INTO feedback (question_id, rating) VALUES ($1, 'down')", [questionId])).rejects.toThrow(
      /unique|duplicate/,
    )
    await expect(getAppPool().query("INSERT INTO feedback (question_id, rating) VALUES ($1, 'up')", [randomUUID()])).rejects.toThrow(
      /foreign key/,
    )
  })
})
