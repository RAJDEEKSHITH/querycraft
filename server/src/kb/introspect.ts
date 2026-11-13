import type { Pool } from 'pg'
import { ALLOWED_SCHEMAS, DENIED_COLUMNS, PII_COLUMNS } from '../safety/policy.js'
import type { IntrospectedTable, SchemaFile } from './seed-files.js'

// kb:introspect (IMPLEMENTATION.md 11.2): fixed, code-defined catalog queries run
// as qc_reader. Only tables the reader can select from are listed; a column is
// denied when policy.ts denies it or the reader has no SELECT on it (both agree,
// test/safety/policy-grants.test.ts). Domains are resolved to their base types.

interface ColumnRow {
  schema: string
  table: string
  comment: string | null
  column: string
  type: string
  nullable: boolean
  can_select: boolean
  fk_schema: string | null
  fk_table: string | null
  fk_column: string | null
}

const INTROSPECTION_SQL = `
WITH tables AS (
  SELECT c.oid, n.nspname AS schema, c.relname AS "table", obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r'
     AND n.nspname = ANY($1::text[])
     AND (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT'))
),
fks AS (
  SELECT k.conrelid, src.attnum, tn.nspname AS fk_schema, tc.relname AS fk_table, ta.attname AS fk_column
    FROM pg_constraint k
    CROSS JOIN LATERAL unnest(k.conkey, k.confkey) AS src(attnum, target_attnum)
    JOIN pg_class tc ON tc.oid = k.confrelid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_attribute ta ON ta.attrelid = k.confrelid AND ta.attnum = src.target_attnum
   WHERE k.contype = 'f'
)
SELECT t.schema, t."table", t.comment, a.attname AS "column",
       format_type(coalesce(nullif(ty.typbasetype, 0), a.atttypid),
                   CASE WHEN ty.typbasetype <> 0 THEN ty.typtypmod ELSE a.atttypmod END) AS type,
       NOT a.attnotnull AS nullable,
       has_column_privilege(t.oid, a.attnum, 'SELECT') AS can_select,
       f.fk_schema, f.fk_table, f.fk_column
  FROM tables t
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  JOIN pg_type ty ON ty.oid = a.atttypid
  LEFT JOIN LATERAL (SELECT * FROM fks WHERE fks.conrelid = t.oid AND fks.attnum = a.attnum
                     ORDER BY fks.fk_schema, fks.fk_table, fks.fk_column LIMIT 1) f ON true
 ORDER BY t.schema, t."table", a.attnum`

const TYPE_ABBREVIATIONS: readonly [RegExp, string][] = [
  [/^character varying/, 'varchar'],
  [/^character\b/, 'char'],
  [/^timestamp without time zone$/, 'timestamp'],
  [/^timestamp with time zone$/, 'timestamptz'],
  [/^time without time zone$/, 'time'],
  [/^integer$/, 'int'],
  [/^boolean$/, 'bool'],
  [/^double precision$/, 'float8'],
]

/** Short type names for compact schema text (IMPLEMENTATION.md 17, token economy). */
export function abbreviateType(type: string): string {
  for (const [pattern, short] of TYPE_ABBREVIATIONS) {
    if (pattern.test(type)) return type.replace(pattern, short)
  }
  return type
}

function key(schema: string, table: string, column: string): string {
  return `${schema}.${table}.${column}`
}

const deniedByPolicy = new Set(DENIED_COLUMNS.map((c) => key(c.schema, c.table, c.column)))
const piiByPolicy = new Map(PII_COLUMNS.map((c) => [key(c.schema, c.table, c.column), c.kind]))

/** Reads the granted tables of the five allowed schemas, sorted by schema, table and column position. */
export async function introspectSchema(reader: Pool): Promise<SchemaFile> {
  const result = await reader.query<ColumnRow>(INTROSPECTION_SQL, [[...ALLOWED_SCHEMAS]])
  const tables = new Map<string, IntrospectedTable>()
  for (const row of result.rows) {
    const tableKey = `${row.schema}.${row.table}`
    let table = tables.get(tableKey)
    if (table === undefined) {
      table = { schema: row.schema, table: row.table, comment: row.comment, columns: [] }
      tables.set(tableKey, table)
    }
    const columnKey = key(row.schema, row.table, row.column)
    table.columns.push({
      name: row.column,
      type: abbreviateType(row.type),
      nullable: row.nullable,
      fk:
        row.fk_schema !== null && row.fk_table !== null && row.fk_column !== null
          ? { schema: row.fk_schema, table: row.fk_table, column: row.fk_column }
          : null,
      pii: piiByPolicy.get(columnKey) ?? null,
      denied: deniedByPolicy.has(columnKey) || !row.can_select,
    })
  }
  return { tables: [...tables.values()] }
}
