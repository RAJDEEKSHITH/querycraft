import { describe, expect, it } from 'vitest'
import { validateSql } from '../../src/safety/validate.js'

// Behaviour that the corpora do not show case by case: rule ordering, retryability,
// CTE scoping and the struct-field allowlist.

async function ruleOf(sql: string): Promise<string> {
  const result = await validateSql(sql)
  return result.ok ? 'OK' : result.rule
}

describe('validateSql', () => {
  it('returns the parsed statement for an allowed query', async () => {
    const result = await validateSql('SELECT name FROM sales.store')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.statement.stmt).toHaveProperty('SelectStmt')
  })

  it('reports the rule that comes first in the 13.1 table when several fail', async () => {
    // FUNCTION_NOT_ALLOWED, PII_IN_EXPRESSION, TABLE_DENIED and UNQUALIFIED_TABLE all apply.
    const sql =
      'SELECT pg_sleep(1), upper(e.emailaddress) FROM person.emailaddress e, person.password p, customer c'
    expect(await ruleOf(sql)).toBe('UNQUALIFIED_TABLE')
    expect(await ruleOf('SELECT pg_sleep(1), upper(emailaddress) FROM person.emailaddress')).toBe('PII_IN_EXPRESSION')
    expect(await ruleOf('SELECT * INTO t FROM sales.store FOR UPDATE')).toBe('SELECT_INTO')
  })

  it('marks only parse errors as retryable', async () => {
    expect(await validateSql('SELEC 1')).toMatchObject({ ok: false, rule: 'PARSE_ERROR', retryable: true })
    expect(await validateSql('SELECT * FROM person.password')).toMatchObject({ retryable: false })
  })

  it('lets a CTE name be used unqualified only where it is visible', async () => {
    expect(await ruleOf('WITH a AS (SELECT 1 AS x), b AS (SELECT x FROM a) SELECT x FROM b')).toBe('OK')
    // Without RECURSIVE, an earlier CTE cannot see a later one.
    expect(await ruleOf('WITH a AS (SELECT x FROM b), b AS (SELECT 1 AS x) SELECT x FROM a')).toBe('UNQUALIFIED_TABLE')
    // With RECURSIVE, every CTE of the WITH is visible.
    expect(await ruleOf('WITH RECURSIVE a AS (SELECT x FROM b), b AS (SELECT 1 AS x) SELECT x FROM a')).toBe('OK')
    // A CTE defined in one subquery is not visible in a sibling subquery.
    expect(await ruleOf('SELECT (WITH c AS (SELECT 1 AS x) SELECT x FROM c), (SELECT x FROM c)')).toBe(
      'UNQUALIFIED_TABLE',
    )
    // A CTE is visible inside subqueries of the statement that defines it.
    expect(await ruleOf('WITH c AS (SELECT 1 AS x) SELECT (SELECT x FROM c)')).toBe('OK')
  })

  it('rejects struct fields outside the allowlist (regression: CTE SEARCH/CYCLE clauses)', async () => {
    const base = 'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3)'
    expect(await ruleOf(`${base} SEARCH DEPTH FIRST BY n SET ord SELECT n FROM t`)).toBe('NOT_SELECT')
    expect(await ruleOf(`${base} CYCLE n SET is_cycle USING path SELECT n FROM t`)).toBe('NOT_SELECT')
    expect(await ruleOf(`${base} SELECT n FROM t`)).toBe('OK')
  })

  it('checks nodes nested deep inside allowed constructs', async () => {
    const sql =
      'SELECT CASE WHEN EXISTS (SELECT 1 FROM sales.store s WHERE s.name IN (SELECT pg_catalog.version())) THEN 1 END'
    expect(await ruleOf(sql)).toBe('FUNCTION_NOT_ALLOWED')
  })

  it('treats a sensitive table name as a column only when it is one', async () => {
    // person.emailaddress has a column named emailaddress: a bare PII column, allowed.
    expect(await ruleOf('SELECT emailaddress FROM person.emailaddress')).toBe('OK')
    // person.personphone has no such column: a whole-row reference, blocked.
    expect(await ruleOf('SELECT personphone FROM person.personphone')).toBe('PII_IN_EXPRESSION')
  })

  it('applies the denied-column and PII rules to t.* by its qualifier', async () => {
    const join = 'FROM sales.salesperson s JOIN humanresources.employee e USING (businessentityid)'
    expect(await ruleOf(`SELECT s.* ${join}`)).toBe('OK')
    expect(await ruleOf(`SELECT e.* ${join}`)).toBe('COLUMN_DENIED')
    expect(await ruleOf(`SELECT * ${join}`)).toBe('COLUMN_DENIED')
    // person.person has a denied column (additionalcontactinfo) since the M1 policy change.
    expect(await ruleOf('SELECT p.* FROM person.person p')).toBe('COLUMN_DENIED')
  })
})
