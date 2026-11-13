import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '../../src/config/env.js'
import { ALLOWED_SCHEMAS, DENIED_COLUMNS, DENIED_TABLES, PII_COLUMNS, SENSITIVE_TABLES } from '../../src/safety/policy.js'

// policy.ts must match the qc_reader grants and the catalog (CLAUDE.md section 10):
// a change to one without the other fails here.

describe('policy.ts matches the database', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: getEnv().READER_DATABASE_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  async function canSelectColumn(schema: string, table: string, column: string): Promise<boolean> {
    const result = await client.query<{ allowed: boolean }>(
      "SELECT has_column_privilege(format('%I.%I', $1::text, $2::text)::regclass, $3, 'SELECT') AS allowed",
      [schema, table, column],
    )
    return result.rows[0]?.allowed === true
  }

  async function columnsOf(schema: string, table: string): Promise<string[]> {
    const result = await client.query<{ attname: string }>(
      `SELECT a.attname FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [schema, table],
    )
    return result.rows.map((r) => r.attname)
  }

  it('allowed schemas are exactly the schemas the reader can use', async () => {
    const result = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_catalog.pg_namespace
        WHERE has_schema_privilege(oid, 'USAGE') AND nspname NOT IN ('pg_catalog', 'information_schema')
          AND nspname NOT LIKE 'pg\\_%'`,
    )
    expect(result.rows.map((r) => r.nspname).sort()).toEqual([...ALLOWED_SCHEMAS].sort())
  })

  it('denied tables have no privileges at all', async () => {
    for (const { schema, table } of DENIED_TABLES) {
      for (const column of await columnsOf(schema, table)) {
        expect(await canSelectColumn(schema, table, column), `${schema}.${table}.${column}`).toBe(false)
      }
    }
  })

  it('sensitive-table column lists match the catalog', async () => {
    for (const table of SENSITIVE_TABLES) {
      expect((await columnsOf(table.schema, table.table)).sort()).toEqual([...table.columns].sort())
    }
  })

  it('denied columns are exactly the ungranted columns of tables with denied columns', async () => {
    for (const table of SENSITIVE_TABLES.filter((t) => t.kind === 'denied')) {
      const denied = DENIED_COLUMNS.filter((c) => c.schema === table.schema && c.table === table.table).map(
        (c) => c.column,
      )
      expect(denied.length).toBeGreaterThan(0)
      for (const column of table.columns) {
        expect(await canSelectColumn(table.schema, table.table, column), column).toBe(!denied.includes(column))
      }
    }
  })

  it('PII columns exist and are readable (masking, not grants, protects them)', async () => {
    for (const { schema, table, column } of PII_COLUMNS) {
      expect(await canSelectColumn(schema, table, column)).toBe(true)
    }
  })
})
