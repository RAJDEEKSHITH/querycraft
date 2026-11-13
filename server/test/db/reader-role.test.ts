import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '../../src/config/env.js'

// Proves the qc_reader database role (IMPLEMENTATION.md 10.1) independently of app code.
// Runs directly against adventureworks as qc_reader; executes no writes that could succeed.

const INSUFFICIENT_PRIVILEGE = '42501'
const READ_ONLY_TRANSACTION = '25006'

async function connect(database?: string): Promise<Client> {
  const url = new URL(getEnv().READER_DATABASE_URL)
  if (database !== undefined) url.pathname = `/${database}`
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  return client
}

const writeStatements = [
  "INSERT INTO sales.currency (currencycode, name) VALUES ('ZZZ', 'Fake')",
  "UPDATE sales.currency SET name = name WHERE currencycode = 'ZZZ'",
  "DELETE FROM sales.currency WHERE currencycode = 'ZZZ'",
  'TRUNCATE sales.currency',
]

const createStatements = [
  'CREATE TABLE sales.fake_table (id int)',
  'CREATE TABLE public.fake_table (id int)',
  'CREATE TEMP TABLE fake_temp (id int)',
  'CREATE SCHEMA fake_schema',
  'CREATE VIEW sales.fake_view AS SELECT 1 AS one',
  'CREATE FUNCTION public.fake_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
]

describe('qc_reader role', () => {
  let client: Client

  beforeAll(async () => {
    client = await connect()
  })

  afterAll(async () => {
    // Undefined only if beforeAll failed to connect; that failure is already reported.
    if (client !== undefined) await client.end()
  })

  it('has the required role defaults', async () => {
    const show = async (setting: string): Promise<string | undefined> =>
      (await client.query<Record<string, string>>(`SHOW ${setting}`)).rows[0]?.[setting]
    expect(await show('default_transaction_read_only')).toBe('on')
    expect(await show('statement_timeout')).toBe('5s')
    expect(await show('idle_in_transaction_session_timeout')).toBe('10s')
  })

  it('can read a granted base table (the denials below are not connection failures)', async () => {
    const result = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM sales.currency')
    expect(result.rows[0]?.n).toBeGreaterThan(0)
  })

  it.each(writeStatements)('blocks writes by default: %s', async (sql) => {
    await expect(client.query(sql)).rejects.toMatchObject({ code: READ_ONLY_TRANSACTION })
  })

  it.each(createStatements)('blocks CREATE by default: %s', async (sql) => {
    await expect(client.query(sql)).rejects.toMatchObject({ code: READ_ONLY_TRANSACTION })
  })

  it.each([
    ['person.password', 'SELECT * FROM person.password LIMIT 1'],
    ['person.password.passwordhash', 'SELECT passwordhash FROM person.password LIMIT 1'],
    ['sales.creditcard.cardnumber', 'SELECT cardnumber FROM sales.creditcard LIMIT 1'],
    ['sales.creditcard.*', 'SELECT * FROM sales.creditcard LIMIT 1'],
    ['humanresources.employee.nationalidnumber', 'SELECT nationalidnumber FROM humanresources.employee LIMIT 1'],
    ['humanresources.employee.loginid', 'SELECT loginid FROM humanresources.employee LIMIT 1'],
    ['humanresources.employee.*', 'SELECT * FROM humanresources.employee LIMIT 1'],
    ['denied column in a WHERE clause', "SELECT creditcardid FROM sales.creditcard WHERE cardnumber LIKE '1%'"],
  ])('cannot read %s', async (_name, sql) => {
    await expect(client.query(sql)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })

  it('can read the allowed columns of tables with denied columns', async () => {
    await expect(client.query('SELECT creditcardid, cardtype FROM sales.creditcard LIMIT 1')).resolves.toBeDefined()
    await expect(client.query('SELECT businessentityid, jobtitle FROM humanresources.employee LIMIT 1')).resolves.toBeDefined()
  })

  it('cannot read any view in the AdventureWorks schemas', async () => {
    const views = await client.query<{ name: string }>(`
      SELECT format('%I.%I', n.nspname, c.relname) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('v', 'm')
        AND n.nspname IN ('sales','production','person','humanresources','purchasing','sa','pr','pe','hr','pu')`)
    expect(views.rows.length).toBeGreaterThan(0)
    for (const { name } of views.rows) {
      await expect(client.query(`SELECT * FROM ${name} LIMIT 0`), name).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
    }
  })

  it('cannot use the public schema', async () => {
    await expect(client.query('SELECT * FROM public.fake_anything')).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    })
  })

  it('cannot connect to the app databases', async () => {
    await expect(connect('querycraft_app')).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    await expect(connect('querycraft_test')).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })
})

describe('qc_reader role with read-only turned off by the session', () => {
  // The role default is only the first layer: a session can turn it off itself.
  // Privileges must still block every write and CREATE.
  let client: Client

  beforeAll(async () => {
    client = await connect()
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE')
    const result = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
    expect(result.rows[0]?.transaction_read_only).toBe('off')
  })

  afterAll(async () => {
    // Undefined only if beforeAll failed to connect; that failure is already reported.
    if (client !== undefined) await client.end()
  })

  it.each([...writeStatements, ...createStatements])('still blocks: %s', async (sql) => {
    await expect(client.query(sql)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
  })
})
