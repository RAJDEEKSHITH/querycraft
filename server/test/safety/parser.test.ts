import { describe, expect, it } from 'vitest'
import { parseSql, referencedTables } from '../../src/safety/parser.js'

describe('parseSql', () => {
  it('parses one statement with the PG 17 grammar', async () => {
    const result = await parseSql('SELECT name FROM sales.store')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.statements).toHaveLength(1)
      expect(result.statements[0]?.stmt).toHaveProperty('SelectStmt')
    }
  })

  it('returns every statement of a multi-statement string', async () => {
    const result = await parseSql('SELECT 1; SELECT 2')
    expect(result.ok && result.statements.length).toBe(2)
  })

  it('reports syntax errors instead of throwing', async () => {
    const result = await parseSql('SELEC 1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('syntax error')
  })

  it('treats empty input as a parse error (the library throws a plain Error for it)', async () => {
    expect(await parseSql('')).toEqual({ ok: false, message: 'Query is empty' })
    expect(await parseSql('  \n ')).toEqual({ ok: false, message: 'Query is empty' })
  })
})

describe('referencedTables', () => {
  async function tablesOf(sql: string): Promise<string[]> {
    const parsed = await parseSql(sql)
    if (!parsed.ok || parsed.statements[0] === undefined) throw new Error('parse failed')
    return referencedTables(parsed.statements[0])
      .map((t) => `${t.schema}.${t.table}`)
      .sort()
  }

  it('finds tables in joins, subqueries and CTEs, once each, skipping CTE names', async () => {
    expect(
      await tablesOf(
        `WITH recent AS (SELECT customerid FROM sales.salesorderheader WHERE orderdate > '2025-01-01')
         SELECT c.customerid FROM sales.customer c JOIN recent r ON r.customerid = c.customerid
         WHERE EXISTS (SELECT 1 FROM sales.salesorderheader o WHERE o.customerid = c.customerid)`,
      ),
    ).toEqual(['sales.customer', 'sales.salesorderheader'])
  })

  it('returns nothing for a query without tables', async () => {
    expect(await tablesOf('SELECT 1')).toEqual([])
  })
})
