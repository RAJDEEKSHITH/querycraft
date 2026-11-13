import { DatabaseError } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { classifyDatabaseError, closeReaderConnections, executeQuery } from '../../src/safety/executor.js'

// Layer 4 against the real reader database (adventureworks as qc_reader).

const options = { rowLimit: 500, timeoutMs: 5_000 }

afterAll(async () => {
  await closeReaderConnections()
})

describe('executeQuery', () => {
  it('returns columns with type and origin from result-field metadata', async () => {
    const result = await executeQuery(
      'SELECT p.name AS product, p.listprice * 2 AS doubled FROM production.product p ORDER BY p.productid LIMIT 3',
      options,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.columns.map((c) => [c.name, c.origin])).toEqual([
      ['product', { schema: 'production', table: 'product', column: 'name' }],
      ['doubled', null],
    ])
    // product.name uses the AdventureWorks "Name" domain; the computed column is numeric.
    expect(result.columns[0]?.type).not.toBe('unknown')
    expect(result.columns[1]?.type).toBe('numeric')
    expect(result.rowCount).toBe(3)
    expect(result.truncated).toBe(false)
    expect(result.rows[0]).toHaveLength(2)
  })

  it('keeps duplicate column names apart (rows are arrays)', async () => {
    const result = await executeQuery(
      'SELECT s.name, t.name FROM sales.store s JOIN sales.customer c ON c.storeid = s.businessentityid JOIN sales.salesterritory t ON t.territoryid = c.territoryid LIMIT 2',
      options,
    )
    if (!result.ok) throw new Error(result.dbMessage)
    expect(result.columns.map((c) => `${c.origin?.table}.${c.name}`)).toEqual(['store.name', 'salesterritory.name'])
    expect(result.rows[0]).toHaveLength(2)
  })

  it('caps rows itself and reports truncation', async () => {
    const capped = await executeQuery('SELECT productid FROM production.product LIMIT 10', { ...options, rowLimit: 5 })
    expect(capped).toMatchObject({ ok: true, rowCount: 5, truncated: true })
    const exact = await executeQuery('SELECT productid FROM production.product LIMIT 5', { ...options, rowLimit: 5 })
    expect(exact).toMatchObject({ ok: true, rowCount: 5, truncated: false })
  })

  it('runs in a read-only transaction with the requested statement timeout', async () => {
    const result = await executeQuery(
      "SELECT current_setting('transaction_read_only'), current_setting('statement_timeout')",
      { ...options, timeoutMs: 1234 },
    )
    expect(result).toMatchObject({ ok: true, rows: [['on', '1234ms']] })
  })

  it('cancels a query that runs past the timeout', async () => {
    const result = await executeQuery('SELECT count(*) FROM sales.salesorderdetail a, sales.salesorderdetail b', {
      ...options,
      timeoutMs: 200,
    })
    expect(result).toMatchObject({ ok: false, kind: 'timeout', sqlState: '57014' })
  })

  it('cannot write even if the validator is bypassed', async () => {
    const result = await executeQuery("INSERT INTO sales.currency (currencycode, name) VALUES ('ZZZ', 'Fake')", options)
    expect(result).toMatchObject({ ok: false, kind: 'permission_denied' })
  })

  it('rejects multiple statements at the protocol level even if the validator is bypassed', async () => {
    const result = await executeQuery('SELECT 1; SELECT 2', options)
    expect(result).toMatchObject({ ok: false, kind: 'error', sqlState: '42601' })
  })

  it('reports SQL errors with their SQLSTATE', async () => {
    expect(await executeQuery('SELECT 1 / 0', options)).toMatchObject({ ok: false, kind: 'error', sqlState: '22012' })
  })

  it('leaves the pool usable after errors', async () => {
    await executeQuery('SELECT 1 / 0', options)
    expect(await executeQuery('SELECT 1 AS one', options)).toMatchObject({ ok: true, rows: [[1]] })
  })
})

describe('classifyDatabaseError', () => {
  function dbError(code: string): DatabaseError {
    const err = new DatabaseError('boom', 0, 'error')
    err.code = code
    return err
  }

  it('classifies query failures', () => {
    expect(classifyDatabaseError(dbError('57014')).kind).toBe('timeout')
    expect(classifyDatabaseError(dbError('42501')).kind).toBe('permission_denied')
    expect(classifyDatabaseError(dbError('25006')).kind).toBe('permission_denied')
    expect(classifyDatabaseError(dbError('42703')).kind).toBe('error')
  })

  it('rethrows infrastructure failures instead of blaming the query', () => {
    for (const code of ['08006', '53300', '57P01', '3D000', 'XX000']) {
      expect(() => classifyDatabaseError(dbError(code))).toThrow('boom')
    }
    expect(() => classifyDatabaseError(new Error('connection refused'))).toThrow('connection refused')
  })
})
