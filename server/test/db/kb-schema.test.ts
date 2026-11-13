import { afterAll, describe, expect, it } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'

// M2 tables in querycraft_test (IMPLEMENTATION.md 10.3): columns, keys and the
// HNSW / trigram indexes, read from the catalog after `pnpm db:migrate`.

afterAll(async () => {
  await closeAppPool()
})

async function columns(table: string): Promise<Record<string, { type: string; nullable: boolean }>> {
  const result = await getAppPool().query<{ name: string; type: string; nullable: boolean }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  )
  return Object.fromEntries(result.rows.map((r) => [r.name, { type: r.type, nullable: r.nullable }]))
}

async function indexDefinitions(table: string): Promise<string[]> {
  const result = await getAppPool().query<{ def: string }>(
    'SELECT indexdef AS def FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
    ['public', table],
  )
  return result.rows.map((r) => r.def)
}

describe('M2 knowledge-base schema', () => {
  it.each(['schema_tables', 'examples', 'glossary_terms'])('%s has a nullable 768-dim embedding with an HNSW cosine index', async (table) => {
    const cols = await columns(table)
    expect(cols['embedding']).toEqual({ type: 'vector(768)', nullable: true })
    expect(cols['content_hash']).toEqual({ type: 'text', nullable: true })
    expect(cols['id']?.type).toBe('uuid')
    const defs = await indexDefinitions(table)
    expect(defs.some((d) => d.includes('USING hnsw (embedding vector_cosine_ops)'))).toBe(true)
  })

  it('schema_tables is unique per schema and table, with jsonb columns', async () => {
    const cols = await columns('schema_tables')
    expect(cols['columns']).toEqual({ type: 'jsonb', nullable: false })
    const defs = await indexDefinitions('schema_tables')
    expect(defs.some((d) => d.includes('UNIQUE INDEX') && d.includes('(schema_name, table_name)'))).toBe(true)
  })

  it('examples has status/source enums and a status index', async () => {
    const cols = await columns('examples')
    expect(cols['status']).toEqual({ type: 'example_status', nullable: false })
    expect(cols['source']).toEqual({ type: 'example_source', nullable: false })
    expect(cols['verified_at']).toEqual({ type: 'timestamp with time zone', nullable: true })
    const defs = await indexDefinitions('examples')
    expect(defs.some((d) => d.includes('USING btree (status)'))).toBe(true)
    const labels = await getAppPool().query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'example_status' ORDER BY e.enumsortorder`,
    )
    expect(labels.rows.map((r) => r.label)).toEqual(['pending', 'verified', 'rejected'])
  })

  it('glossary_terms.term is unique', async () => {
    const defs = await indexDefinitions('glossary_terms')
    expect(defs.some((d) => d.includes('UNIQUE INDEX') && d.includes('(term)'))).toBe(true)
  })

  it('column_values has a unique key and a GIN trigram index on value', async () => {
    const defs = await indexDefinitions('column_values')
    expect(defs.some((d) => d.includes('USING gin (value gin_trgm_ops)'))).toBe(true)
    expect(
      defs.some((d) => d.includes('UNIQUE INDEX') && d.includes('(schema_name, table_name, column_name, value)')),
    ).toBe(true)
  })

  it('daily_usage is keyed by (day, source) with integer tokens and numeric cost', async () => {
    const cols = await columns('daily_usage')
    expect(cols['day']).toEqual({ type: 'date', nullable: false })
    expect(cols['source']).toEqual({ type: 'request_source', nullable: false })
    for (const name of ['llm_tokens', 'embedding_tokens', 'llm_requests', 'embedding_requests']) {
      expect(cols[name]).toEqual({ type: 'integer', nullable: false })
    }
    expect(cols['cost_usd']).toEqual({ type: 'numeric(12,6)', nullable: false })
    const defs = await indexDefinitions('daily_usage')
    expect(defs.some((d) => d.includes('UNIQUE INDEX daily_usage_pkey') && d.includes('(day, source)'))).toBe(true)
  })
})
