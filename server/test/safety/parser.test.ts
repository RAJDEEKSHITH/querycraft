import { describe, expect, it } from 'vitest'
import { parseSql } from '../../src/safety/parser.js'

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
