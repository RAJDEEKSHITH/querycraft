import { afterAll, describe, expect, it } from 'vitest'
import { closeReaderConnections, executeQuery, type ResultColumn } from '../../src/safety/executor.js'
import { maskEmail, maskPhone, maskRows } from '../../src/safety/mask.js'
import { validateSql } from '../../src/safety/validate.js'

const options = { rowLimit: 500, timeoutMs: 5_000 }

afterAll(async () => {
  await closeReaderConnections()
})

describe('mask functions', () => {
  it('masks emails to first character + ***@ + domain', () => {
    expect(maskEmail('ken0@adventure-works.com')).toBe('k***@adventure-works.com')
    expect(maskEmail('a@b')).toBe('a***@b')
    expect(maskEmail('not-an-email')).toBe('***')
    expect(maskEmail('@nouser.com')).toBe('***')
  })

  it('masks phones to ***-***- + last four digits', () => {
    expect(maskPhone('697-555-0142')).toBe('***-***-0142')
    expect(maskPhone('1 (11) 500 555-0110')).toBe('***-***-0110')
    expect(maskPhone('12')).toBe('***')
  })
})

describe('maskRows', () => {
  const email = { schema: 'person', table: 'emailaddress', column: 'emailaddress' }

  it('masks by origin, not by column name', () => {
    const columns: ResultColumn[] = [
      { name: 'contact', type: 'character varying', origin: email },
      { name: 'emailaddress', type: 'text', origin: null },
    ]
    const rows = maskRows(columns, [['jo@x.com', 'jo@x.com']])
    expect(rows).toEqual([['j***@x.com', 'jo@x.com']])
  })

  it('keeps nulls and masks non-text PII values completely', () => {
    const columns: ResultColumn[] = [{ name: 'e', type: 'unknown', origin: email }]
    expect(maskRows(columns, [[null], [42]])).toEqual([[null], ['***']])
  })

  it('does not modify the input rows', () => {
    const columns: ResultColumn[] = [{ name: 'e', type: 'text', origin: email }]
    const input = [['jo@x.com']]
    maskRows(columns, input)
    expect(input).toEqual([['jo@x.com']])
  })
})

describe('masking with real result-field metadata', () => {
  /** Validates (so only allowed forms are tested), executes and masks. */
  async function run(sql: string): Promise<{ columns: ResultColumn[]; rows: unknown[][]; raw: unknown[][] }> {
    expect(await validateSql(sql)).toMatchObject({ ok: true })
    const result = await executeQuery(sql, options)
    if (!result.ok) throw new Error(result.dbMessage)
    return { columns: result.columns, rows: maskRows(result.columns, result.rows), raw: result.rows }
  }

  it('masks an aliased email column', async () => {
    const { rows, raw } = await run(
      'SELECT e.emailaddress AS contact FROM person.emailaddress e ORDER BY e.businessentityid LIMIT 3',
    )
    expect(raw.flat().every((v) => typeof v === 'string' && /^[^*]+@/.test(v))).toBe(true)
    for (const [value] of rows) expect(value).toMatch(/^.\*\*\*@adventure-works\.com$/)
  })

  it('masks PII selected with *', async () => {
    const { columns, rows } = await run('SELECT * FROM person.personphone ORDER BY businessentityid LIMIT 3')
    const index = columns.findIndex((c) => c.name === 'phonenumber')
    expect(index).toBeGreaterThanOrEqual(0)
    for (const row of rows) expect(row[index]).toMatch(/^\*\*\*-\*\*\*-\d{4}$/)
  })

  it('keeps the origin through DISTINCT and grouping by the primary key', async () => {
    const distinct = await run('SELECT DISTINCT emailaddress FROM person.emailaddress LIMIT 3')
    for (const [value] of distinct.rows) expect(value).toMatch(/^.\*\*\*@/)
    // emailaddress is functionally dependent on the primary key, so it may be selected.
    const grouped = await run(
      'SELECT emailaddress, count(*) FROM person.emailaddress GROUP BY businessentityid, emailaddressid LIMIT 3',
    )
    for (const [value] of grouped.rows) expect(value).toMatch(/^.\*\*\*@/)
  })

  it('leaves non-PII columns of PII tables unmasked', async () => {
    const { rows } = await run('SELECT businessentityid, emailaddress FROM person.emailaddress ORDER BY 1 LIMIT 1')
    expect(rows[0]?.[0]).toBe(1)
  })
})
