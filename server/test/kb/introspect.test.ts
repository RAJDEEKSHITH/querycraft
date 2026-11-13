import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeReaderPool, getReaderPool } from '../../src/db/reader.js'
import { abbreviateType, introspectSchema } from '../../src/kb/introspect.js'
import { readSeedFile, schemaFileSchema, seedPath, type SchemaFile } from '../../src/kb/seed-files.js'
import { ALLOWED_SCHEMAS, DENIED_COLUMNS, PII_COLUMNS } from '../../src/safety/policy.js'

// kb:introspect against the real adventureworks database as qc_reader.

let schema: SchemaFile

beforeAll(async () => {
  schema = await introspectSchema(getReaderPool())
})

afterAll(async () => {
  await closeReaderPool()
})

function column(schemaName: string, table: string, name: string): SchemaFile['tables'][number]['columns'][number] {
  const found = schema.tables.find((t) => t.schema === schemaName && t.table === table)?.columns.find((c) => c.name === name)
  if (found === undefined) throw new Error(`missing ${schemaName}.${table}.${name}`)
  return found
}

describe('introspectSchema', () => {
  it('lists the 67 granted base tables of the five schemas, never person.password', () => {
    expect(schema.tables).toHaveLength(67)
    expect(schema.tables.every((t) => ALLOWED_SCHEMAS.has(t.schema))).toBe(true)
    expect(schema.tables.some((t) => t.schema === 'person' && t.table === 'password')).toBe(false)
    expect(schemaFileSchema.safeParse(schema).success).toBe(true)
  })

  it('flags exactly the policy-denied columns as denied', () => {
    const denied = schema.tables.flatMap((t) =>
      t.columns.filter((c) => c.denied).map((c) => `${t.schema}.${t.table}.${c.name}`),
    )
    expect(denied.sort()).toEqual(DENIED_COLUMNS.map((c) => `${c.schema}.${c.table}.${c.column}`).sort())
  })

  it('flags exactly the policy PII columns with their kind', () => {
    const pii = schema.tables.flatMap((t) =>
      t.columns.filter((c) => c.pii !== null).map((c) => `${t.schema}.${t.table}.${c.name}:${c.pii ?? ''}`),
    )
    expect(pii.sort()).toEqual(PII_COLUMNS.map((c) => `${c.schema}.${c.table}.${c.column}:${c.kind}`).sort())
  })

  it('resolves domains to abbreviated base types', () => {
    expect(column('person', 'person', 'firstname').type).toBe('varchar(50)') // domain "Name"
    expect(column('person', 'person', 'namestyle').type).toBe('bool') // domain "NameStyle"
    expect(column('sales', 'salesorderheader', 'orderdate').type).toBe('timestamp')
    expect(column('sales', 'salesorderheader', 'customerid').type).toBe('int')
  })

  it('records nullability and foreign keys', () => {
    expect(column('sales', 'salesorderheader', 'customerid')).toMatchObject({
      nullable: false,
      fk: { schema: 'sales', table: 'customer', column: 'customerid' },
    })
    expect(column('sales', 'customer', 'storeid')).toMatchObject({
      nullable: true,
      fk: { schema: 'sales', table: 'store', column: 'businessentityid' },
    })
    // Columns of the one multi-column foreign key map pairwise.
    expect(column('sales', 'salesorderdetail', 'specialofferid').fk).toEqual({
      schema: 'sales',
      table: 'specialofferproduct',
      column: 'specialofferid',
    })
  })

  it('keeps table comments for kb:describe', () => {
    expect(schema.tables.every((t) => t.comment !== null && t.comment.length > 0)).toBe(true)
  })

  it('matches the committed seed/schema.json (re-run pnpm kb:introspect after schema changes)', async () => {
    expect(await readSeedFile(seedPath.schema, schemaFileSchema)).toEqual(schema)
  })
})

describe('abbreviateType', () => {
  it.each([
    ['character varying(50)', 'varchar(50)'],
    ['character varying', 'varchar'],
    ['character(3)', 'char(3)'],
    ['timestamp without time zone', 'timestamp'],
    ['timestamp with time zone', 'timestamptz'],
    ['time without time zone', 'time'],
    ['integer', 'int'],
    ['boolean', 'bool'],
    ['numeric(8,2)', 'numeric(8,2)'],
    ['smallint', 'smallint'],
  ])('%s → %s', (input, output) => {
    expect(abbreviateType(input)).toBe(output)
  })
})
