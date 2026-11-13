import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { closeReaderPool, getReaderPool } from '../../src/db/reader.js'
import { readSeedFile, schemaFileSchema, seedPath, valueColumnsFileSchema } from '../../src/kb/seed-files.js'
import { checkValueColumns, loadColumnValues } from '../../src/kb/values.js'

// Column-value loading from adventureworks (qc_reader) into querycraft_test.

const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
const config = await readSeedFile(seedPath.valueColumns, valueColumnsFileSchema)

async function valuesOf(schemaName: string, table: string, column: string): Promise<string[]> {
  const result = await getAppPool().query<{ value: string }>(
    'SELECT value FROM column_values WHERE schema_name = $1 AND table_name = $2 AND column_name = $3 ORDER BY value',
    [schemaName, table, column],
  )
  return result.rows.map((r) => r.value)
}

async function total(): Promise<number> {
  const result = await getAppPool().query<{ n: number }>('SELECT count(*)::int AS n FROM column_values')
  return result.rows[0]?.n ?? -1
}

beforeEach(async () => {
  await getAppPool().query('TRUNCATE column_values')
})

afterAll(async () => {
  await closeReaderPool()
  await closeAppPool()
})

describe('seed/value-columns.json', () => {
  it('passes the column checks', () => {
    expect(() => checkValueColumns(config, schema)).not.toThrow()
  })
})

describe('checkValueColumns', () => {
  it.each([
    ['a denied column', { schema: 'sales', table: 'creditcard', column: 'cardnumber' }, /is denied/],
    ['a PII column', { schema: 'person', table: 'emailaddress', column: 'emailaddress' }, /is PII/],
    ['a non-text column', { schema: 'production', table: 'product', column: 'listprice' }, /is not a text column/],
    ['an unknown column', { schema: 'sales', table: 'store', column: 'nope' }, /not in seed\/schema.json/],
    ['a table without grants', { schema: 'person', table: 'password', column: 'passwordhash' }, /not in seed\/schema.json/],
  ])('rejects %s', (_name, entry, message) => {
    expect(() => checkValueColumns([entry], schema)).toThrow(message)
  })

  it('rejects duplicates', () => {
    const entry = { schema: 'sales', table: 'store', column: 'name' }
    expect(() => checkValueColumns([entry, entry], schema)).toThrow(/listed twice/)
  })
})

describe('loadColumnValues', () => {
  it('loads the distinct values of every configured column', async () => {
    const stats = await loadColumnValues(getReaderPool(), config, schema)
    expect(stats.columns).toBe(config.length)
    expect(await total()).toBe(stats.values)
    expect(await valuesOf('production', 'productcategory', 'name')).toEqual(['Accessories', 'Bikes', 'Clothing', 'Components'])
    expect(await valuesOf('sales', 'salesterritory', 'group')).toEqual(['Europe', 'North America', 'Pacific'])
    expect((await valuesOf('person', 'address', 'city')).length).toBe(575)
  })

  it('is idempotent and removes columns that left the config', async () => {
    const first = await loadColumnValues(getReaderPool(), config, schema)
    const second = await loadColumnValues(getReaderPool(), config, schema)
    expect(second.values).toBe(first.values)
    expect(await total()).toBe(first.values)

    await loadColumnValues(getReaderPool(), [{ schema: 'production', table: 'productcategory', column: 'name' }], schema)
    expect(await total()).toBe(4)
  })

  it('removes values that no longer exist in the source', async () => {
    const categories = [{ schema: 'production', table: 'productcategory', column: 'name' }]
    await getAppPool().query(
      "INSERT INTO column_values (schema_name, table_name, column_name, value) VALUES ('production', 'productcategory', 'name', 'Scooters')",
    )
    await loadColumnValues(getReaderPool(), categories, schema)
    expect(await valuesOf('production', 'productcategory', 'name')).not.toContain('Scooters')
  })

  it('writes nothing when a configured column is not allowed', async () => {
    await expect(
      loadColumnValues(getReaderPool(), [{ schema: 'sales', table: 'creditcard', column: 'cardnumber' }], schema),
    ).rejects.toThrow(/is denied/)
    expect(await total()).toBe(0)
  })
})
