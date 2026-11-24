import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeYears,
  rangeInWords,
  rangeOptions,
  dataRangeSql,
  findDateFilterColumns,
  lookUpDataRange,
  type ContextTable,
} from '../../src/agent/date-range.js'
import { DATA_RANGE_RULE, buildAnswerMessages, chosenPeriodRule } from '../../src/agent/prompts/answer.js'
import { ZERO_ROW_REVIEW, periodChoiceLine, zeroRowReviewWithRange } from '../../src/agent/prompts/generate.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { validateSql } from '../../src/safety/validate.js'
import { createTestQuestion } from '../helpers/questions.js'

// Date-range check after a zero-row result (IMPLEMENTATION.md 12.3): which column is
// looked up, the fixed range query and its path through the safety pipeline.

// The server defaults (server/.env.example), set before the env is first read.
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '50000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '500000')
vi.stubEnv('QUERY_ROW_LIMIT', '20')

const TABLES: ContextTable[] = [
  {
    schema: 'sales',
    table: 'salesorderheader',
    columns: [
      { name: 'salesorderid', type: 'int' },
      { name: 'orderdate', type: 'timestamp' },
      { name: 'shipdate', type: 'timestamp' },
      { name: 'totaldue', type: 'numeric' },
    ],
  },
  {
    schema: 'sales',
    table: 'salesorderdetail',
    columns: [
      { name: 'salesorderid', type: 'int' },
      { name: 'productid', type: 'int' },
      { name: 'linetotal', type: 'numeric' },
    ],
  },
  { schema: 'humanresources', table: 'employee', columns: [{ name: 'birthdate', type: 'date' }] },
]

const ORDERDATE = { schema: 'sales', table: 'salesorderheader', column: 'orderdate' }
const find = (sql: string): ReturnType<typeof findDateFilterColumns> => findDateFilterColumns(sql, TABLES)

describe('findDateFilterColumns', () => {
  it('finds a date column through its alias inside a function in WHERE', async () => {
    const sql = `SELECT d.productid, sum(d.linetotal) FROM sales.salesorderdetail d
      JOIN sales.salesorderheader soh ON soh.salesorderid = d.salesorderid
      WHERE EXTRACT(YEAR FROM soh.orderdate) = 2014 GROUP BY d.productid`
    expect(await find(sql)).toEqual([ORDERDATE])
  })

  it('finds a date filter in a join condition', async () => {
    const sql = `SELECT count(*) FROM sales.salesorderdetail d
      JOIN sales.salesorderheader soh ON soh.salesorderid = d.salesorderid AND soh.orderdate >= '2014-01-01'`
    expect(await find(sql)).toEqual([ORDERDATE])
  })

  it('resolves unqualified and fully qualified column names', async () => {
    expect(await find("SELECT count(*) FROM sales.salesorderheader WHERE orderdate BETWEEN '2014-01-01' AND '2014-12-31'")).toEqual([ORDERDATE])
    expect(await find("SELECT count(*) FROM sales.salesorderheader WHERE sales.salesorderheader.orderdate < '2015-01-01'")).toEqual([ORDERDATE])
  })

  it('accepts date as well as timestamp columns', async () => {
    expect(await find("SELECT count(*) FROM humanresources.employee e WHERE e.birthdate < '1950-01-01'")).toEqual([
      { schema: 'humanresources', table: 'employee', column: 'birthdate' },
    ])
  })

  it('finds a filter inside a CTE and inside a subquery condition', async () => {
    expect(await find("WITH o AS (SELECT * FROM sales.salesorderheader WHERE orderdate >= '2014-01-01') SELECT count(*) FROM o")).toEqual([ORDERDATE])
    const sub = `SELECT sum(linetotal) FROM sales.salesorderdetail
      WHERE salesorderid IN (SELECT salesorderid FROM sales.salesorderheader WHERE orderdate >= '2014-01-01')`
    expect(await find(sub)).toEqual([ORDERDATE])
  })

  it('lists each column once, in filter order', async () => {
    const sql = "SELECT count(*) FROM sales.salesorderheader WHERE shipdate > '2014-01-05' AND orderdate > '2014-01-01' AND orderdate < '2015-01-01'"
    expect(await find(sql)).toEqual([{ ...ORDERDATE, column: 'shipdate' }, ORDERDATE])
  })

  it('ignores date columns outside filters and null tests', async () => {
    expect(await find('SELECT orderdate FROM sales.salesorderheader ORDER BY orderdate')).toEqual([])
    expect(await find('SELECT count(*) FROM sales.salesorderheader WHERE shipdate IS NOT NULL')).toEqual([])
    // A subquery's select list is not a filter.
    expect(await find('SELECT count(*) FROM sales.salesorderheader WHERE totaldue > (SELECT max(orderdate) FROM sales.salesorderheader)')).toEqual([])
  })

  it('ignores non-date columns', async () => {
    expect(await find('SELECT count(*) FROM sales.salesorderheader WHERE totaldue > 100')).toEqual([])
  })

  // The model controls the SQL, so only columns the retrieved context listed are used.
  it('never uses a column or table that is not in the retrieved context', async () => {
    expect(await find("SELECT count(*) FROM sales.salesorderheader WHERE modifieddate > '2014-01-01'")).toEqual([])
    expect(await find(`SELECT count(*) FROM sales.salesorderheader WHERE "orderdate""; DROP TABLE x; --" > '2014-01-01'`)).toEqual([])
    expect(await find("SELECT count(*) FROM sales.salesorderheader WHERE nope.orderdate > '2014-01-01'")).toEqual([])
    expect(await find("SELECT count(*) FROM purchasing.purchaseorderheader WHERE orderdate > '2014-01-01'")).toEqual([])
  })

  it('returns nothing for unparseable SQL or several statements', async () => {
    expect(await find('SELECT FROM WHERE')).toEqual([])
    expect(await find("SELECT 1; SELECT count(*) FROM sales.salesorderheader WHERE orderdate > '2014-01-01'")).toEqual([])
  })
})

describe('dataRangeSql', () => {
  it('builds one quoted min/max query that passes the safety policy', async () => {
    const sql = dataRangeSql(ORDERDATE)
    expect(sql).toBe('SELECT min("orderdate")::date AS min_value, max("orderdate")::date AS max_value FROM "sales"."salesorderheader"')
    expect((await validateSql(sql)).ok).toBe(true)
  })

  it('escapes double quotes in identifiers', () => {
    expect(dataRangeSql({ schema: 's"x', table: 't', column: 'c"; DROP TABLE t; --' })).toBe(
      'SELECT min("c""; DROP TABLE t; --")::date AS min_value, max("c""; DROP TABLE t; --")::date AS max_value FROM "s""x"."t"',
    )
  })
})

describe('rangeInWords and rangeOptions', () => {
  it('names months and offers the latest three complete years and all data', () => {
    expect(rangeInWords({ min: '2022-05-30', max: '2025-06-29' })).toBe('May 2022 to June 2025')
    expect(rangeOptions({ min: '2022-05-30', max: '2025-06-29' })).toEqual(['2023', '2024', 'All available data (May 2022 to June 2025)'])
    expect(rangeOptions({ min: '2015-01-01', max: '2024-12-31' })).toEqual(['2022', '2023', '2024', 'All available data (January 2015 to December 2024)'])
    expect(rangeOptions({ min: '2024-03-01', max: '2024-11-30' })).toEqual(['All available data (March 2024 to November 2024)'])
  })
})

describe('completeYears', () => {
  it('returns the calendar years fully inside the range', () => {
    expect(completeYears({ min: '2022-05-30', max: '2025-06-29' })).toEqual({ first: 2023, last: 2024 })
    expect(completeYears({ min: '2023-01-01', max: '2023-12-31' })).toEqual({ first: 2023, last: 2023 })
    expect(completeYears({ min: '2024-03-01', max: '2024-11-30' })).toBeNull()
  })
})

describe('lookUpDataRange (adventureworks)', () => {
  beforeEach(async () => {
    await getAppPool().query('TRUNCATE audit_events')
  })

  afterAll(async () => {
    await closeReaderConnections()
    await closeAppPool()
  })

  it('looks up the real order date range through the audited safety pipeline', async () => {
    const questionId = await createTestQuestion()
    const range = await lookUpDataRange(
      "SELECT count(*) FROM sales.salesorderheader soh WHERE EXTRACT(YEAR FROM soh.orderdate) = 2014",
      TABLES,
      { source: 'app', questionId },
    )
    expect(range).toEqual({ ...ORDERDATE, min: '2022-05-30', max: '2025-06-29' })
    const audit = await getAppPool().query<{ rule: string; sql: string; question_id: string }>(
      'SELECT rule, sql, question_id FROM audit_events ORDER BY created_at',
    )
    expect(audit.rows.map((r) => r.rule)).toEqual(['POLICY_OK', 'COST_OK', 'EXECUTED'])
    for (const r of audit.rows) expect(r.question_id).toBe(questionId)
    expect(audit.rows[0]?.sql).toBe(dataRangeSql(ORDERDATE))
  })

  it('runs no query when the SQL has no date filter', async () => {
    const questionId = await createTestQuestion()
    expect(await lookUpDataRange('SELECT count(*) FROM sales.salesorderheader WHERE totaldue > 1e9', TABLES, { source: 'app', questionId })).toBeNull()
    expect((await getAppPool().query('SELECT 1 FROM audit_events')).rowCount).toBe(0)
  })
})

describe('prompts with a data range', () => {
  const range = { ...ORDERDATE, min: '2022-05-30', max: '2025-06-29' }

  it('the review keeps the base instruction, adds the range and asks the user instead of substituting', () => {
    const text = zeroRowReviewWithRange(range, true)
    expect(text.startsWith(ZERO_ROW_REVIEW)).toBe(true)
    expect(text).toContain('sales.salesorderheader.orderdate has values from 2022-05-30 to 2025-06-29 (May 2022 to June 2025); complete calendar years: 2023 to 2024.')
    expect(text).toContain('do not change the period yourself and do not return the same SQL: reply with clarify')
    expect(text).toContain('The clarify question is "There is no data for <period>; the data covers May 2022 to June 2025. Which period should I use?", with <period> replaced by the period the question names')
    expect(text).toContain('the options are: "2023", "2024", "All available data (May 2022 to June 2025)".')
    expect(text).not.toContain('nearest')
  })

  it("the period the user chose replaces the question's period in the generate prompt", () => {
    expect(periodChoiceLine({ range, answer: '2023' })).toBe(
      `Period chosen by the user: the question's period has no data (sales.salesorderheader.orderdate covers May 2022 to June 2025), so the user chose "2023" instead. Write the SQL for that period, not the question's period, and do not reply cannot_answer because of the question's period.`,
    )
  })

  it('with no clarification left, the review keeps the SQL so the answer states the range', () => {
    const text = zeroRowReviewWithRange(range, false)
    expect(text).toContain('do not change the period: return the same SQL; the answer will state the data range.')
    expect(text).not.toContain('clarify')
  })

  it('the answer prompt gets the range, the assumptions and the rule only when a range was looked up', () => {
    const base = { question: 'Top 5 products by revenue in 2014.', sql: 'SELECT 1', columns: ['a'], rows: [[1]], rowCount: 1, truncated: false }
    const withRange = buildAnswerMessages({ ...base, dataRange: range, assumptions: ['No data for 2014; using 2023'] })[1]?.content
    expect(withRange).toContain('Data range: sales.salesorderheader.orderdate has values from 2022-05-30 to 2025-06-29 (May 2022 to June 2025)')
    expect(withRange).toContain('Assumptions: No data for 2014; using 2023')
    expect(withRange).toContain(DATA_RANGE_RULE)
    expect(withRange).not.toContain('Period chosen')
    const chosen = buildAnswerMessages({ ...base, dataRange: range, periodChoice: '2023' })[1]?.content
    expect(chosen).toContain('Period chosen by the user instead: 2023')
    // Rows for the chosen period: a direct instruction instead of the conditional rule.
    expect(chosen).toContain(chosenPeriodRule(range, '2023'))
    expect(chosen).toContain('Start with one sentence: "There is no data for <the period in the question>; the data covers May 2022 to June 2025."')
    expect(chosen).toContain('Then answer the question for "2023" from the rows, naming "2023".')
    expect(chosen).not.toContain(DATA_RANGE_RULE)
    // A choice that still gave no rows falls back to the no-data rule.
    const empty = buildAnswerMessages({ ...base, rows: [], rowCount: 0, dataRange: range, periodChoice: '2023' })[1]?.content
    expect(empty).toContain(DATA_RANGE_RULE)
    const plain = buildAnswerMessages({ ...base, assumptions: ['x'] })[1]?.content
    expect(plain).not.toContain('Data range')
    expect(plain).not.toContain('Assumptions')
  })
})
