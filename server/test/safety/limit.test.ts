import { describe, expect, it } from 'vitest'
import { applyRowLimit } from '../../src/safety/limit.js'
import { parseSql } from '../../src/safety/parser.js'
import { integerConstant, validateSql } from '../../src/safety/validate.js'

// M1 acceptance: limit rewrite for absent, larger, smaller and set operations.
// The limit is written into the original text (D10); results are checked both as
// text (the rest of the query is untouched) and as a parse tree.

const ROW_LIMIT = 500

async function limit(sql: string): Promise<{ ok: boolean; sql?: string; message?: string }> {
  const validation = await validateSql(sql)
  if (!validation.ok) throw new Error(`fixture is not valid: ${validation.rule}`)
  return applyRowLimit(sql, validation.statement, ROW_LIMIT)
}

/** Top-level SELECT of a SQL string. */
async function topSelect(sql: string): Promise<Record<string, unknown>> {
  const parsed = await parseSql(sql)
  const stmt = parsed.ok ? parsed.statements[0]?.stmt : undefined
  if (stmt === undefined || !('SelectStmt' in stmt)) throw new Error('not a SELECT')
  return { ...stmt.SelectStmt }
}

describe('applyRowLimit', () => {
  it('appends LIMIT rowLimit + 1 when there is none, leaving the query text as written', async () => {
    const sql = 'SELECT name  FROM sales.store /* keep */ ORDER BY name'
    expect(await limit(sql)).toEqual({ ok: true, sql: `${sql}\nLIMIT 501` })
  })

  it('appends after OFFSET and after a trailing line comment', async () => {
    const offset = await limit('SELECT name FROM sales.store ORDER BY name OFFSET 3')
    const select = await topSelect(offset.sql ?? '')
    expect(integerConstant(select.limitCount)).toBe(501)
    expect(integerConstant(select.limitOffset)).toBe(3)

    const comment = await limit('SELECT name FROM sales.store -- trailing comment')
    expect(comment.sql).toBe('SELECT name FROM sales.store -- trailing comment\nLIMIT 501')
    expect(integerConstant((await topSelect(comment.sql ?? '')).limitCount)).toBe(501)
  })

  it('lowers a larger integer limit in place', async () => {
    expect(await limit('SELECT name FROM sales.store ORDER BY name LIMIT 5000 OFFSET 3')).toEqual({
      ok: true,
      sql: 'SELECT name FROM sales.store ORDER BY name LIMIT 501 OFFSET 3',
    })
    expect((await limit('SELECT name FROM sales.store ORDER BY name FETCH FIRST 9000 ROWS ONLY')).sql).toBe(
      'SELECT name FROM sales.store ORDER BY name FETCH FIRST 501 ROWS ONLY',
    )
  })

  it('keeps WITH TIES when lowering (the executor still caps rows)', async () => {
    const result = await limit('SELECT name FROM sales.store ORDER BY name FETCH FIRST 9000 ROWS WITH TIES')
    expect(result.sql).toBe('SELECT name FROM sales.store ORDER BY name FETCH FIRST 501 ROWS WITH TIES')
    expect((await topSelect(result.sql ?? '')).limitOption).toBe('LIMIT_OPTION_WITH_TIES')
  })

  it('replaces LIMIT ALL and LIMIT NULL', async () => {
    expect((await limit('SELECT name FROM sales.store LIMIT ALL')).sql).toBe('SELECT name FROM sales.store LIMIT 501')
    expect((await limit('SELECT name FROM sales.store LIMIT NULL')).sql).toBe('SELECT name FROM sales.store LIMIT 501')
  })

  it('leaves a smaller or equal limit unchanged', async () => {
    for (const sql of [
      'SELECT name FROM sales.store LIMIT 10',
      'SELECT name FROM sales.store LIMIT 501',
      'SELECT name FROM sales.store LIMIT 0',
      'SELECT name FROM sales.store ORDER BY name FETCH FIRST 3 ROWS WITH TIES',
    ]) {
      expect(await limit(sql)).toEqual({ ok: true, sql })
    }
  })

  it('returns the statement without a trailing semicolon', async () => {
    expect((await limit('SELECT name FROM sales.store LIMIT 10;')).sql).toBe('SELECT name FROM sales.store LIMIT 10')
    expect((await limit('SELECT name FROM sales.store; ')).sql).toBe('SELECT name FROM sales.store\nLIMIT 501')
  })

  it('uses byte positions, so multibyte text before the limit is handled', async () => {
    expect((await limit("SELECT name FROM sales.store WHERE name <> 'São Paulo ☕' LIMIT 5000")).sql).toBe(
      "SELECT name FROM sales.store WHERE name <> 'São Paulo ☕' LIMIT 501",
    )
  })

  it('applies the limit to the whole set operation, keeping branch limits', async () => {
    const union = await limit('SELECT name FROM sales.store UNION SELECT name FROM production.product ORDER BY 1')
    const select = await topSelect(union.sql ?? '')
    expect(select.op).toBe('SETOP_UNION')
    expect(integerConstant(select.limitCount)).toBe(501)

    const branches = await limit(
      '(SELECT name FROM sales.store LIMIT 3) UNION ALL (SELECT name FROM production.product LIMIT 2000)',
    )
    const top = await topSelect(branches.sql ?? '')
    expect(integerConstant(top.limitCount)).toBe(501)
    expect(branches.sql).toContain('LIMIT 2000')
  })

  it('does not touch limits inside CTEs or subqueries', async () => {
    const result = await limit(
      'WITH t AS (SELECT name FROM sales.store LIMIT 5000) SELECT name FROM t WHERE name IN (SELECT name FROM sales.store LIMIT 9000) LIMIT 7000',
    )
    expect(result.sql).toBe(
      'WITH t AS (SELECT name FROM sales.store LIMIT 5000) SELECT name FROM t WHERE name IN (SELECT name FROM sales.store LIMIT 9000) LIMIT 501',
    )
  })

  it('never wraps the query in a subquery', async () => {
    const result = await limit('SELECT name FROM sales.store ORDER BY name')
    const select = await topSelect(result.sql ?? '')
    expect(JSON.stringify(select.fromClause)).not.toContain('RangeSubselect')
    expect(select.sortClause).toBeDefined()
  })

  it('keeps constructs that a deparser got wrong (regression: window frames, WITH TIES)', async () => {
    const frame =
      'SELECT last_value(name) OVER (ORDER BY name ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM sales.store'
    expect(await limit(frame)).toEqual({ ok: true, sql: `${frame}\nLIMIT 501` })
  })

  it('rejects a limit that is not an integer literal (fail closed)', async () => {
    for (const sql of [
      'SELECT name FROM sales.store LIMIT (SELECT 7)',
      'SELECT name FROM sales.store LIMIT 10 + 1',
      'SELECT name FROM sales.store LIMIT 10.5',
      "SELECT name FROM sales.store LIMIT '10'",
      'SELECT name FROM sales.store LIMIT 10::int',
      'SELECT name FROM sales.store ORDER BY name FETCH FIRST (SELECT 3) ROWS WITH TIES',
    ]) {
      expect(await limit(sql), sql).toEqual({ ok: false, message: 'The LIMIT must be an integer literal' })
    }
  })
})
