import type { ParseResult, RawStmt } from '@pgsql/types'
import { parse } from 'pgsql-parser'

// Thin wrapper around the real Postgres parser (libpg_query, PG 17 grammar)
// (IMPLEMENTATION.md 13.1). The rest of the safety layer depends only on this
// module, never on the parser package directly. No deparser is used: the row
// limit is written into the original SQL text (limit.ts, decision D10).

export type ParseOutcome =
  | { ok: true; statements: RawStmt[] }
  | { ok: false; message: string }

/** Parser syntax errors are `SqlError`s; anything else is an internal failure. */
function isSqlError(err: unknown): err is Error {
  return err instanceof Error && err.name === 'SqlError'
}

export async function parseSql(sql: string): Promise<ParseOutcome> {
  // libpg_query throws a plain Error for empty input; treat it as a parse error.
  if (sql.trim() === '') {
    return { ok: false, message: 'Query is empty' }
  }
  let result: unknown
  try {
    result = await parse(sql)
  } catch (err) {
    if (isSqlError(err)) {
      return { ok: false, message: err.message }
    }
    throw err
  }
  // The package types parse() as `any`; its output is the libpg_query JSON tree
  // described by @pgsql/types. Check the outer shape before trusting the type.
  if (typeof result !== 'object' || result === null || !('stmts' in result)) {
    throw new Error('Unexpected parser output')
  }
  const { stmts } = result as ParseResult
  return { ok: true, statements: stmts ?? [] }
}

/**
 * Schema-qualified tables (`RangeVar` nodes with a schema) anywhere in a parsed
 * statement, deduplicated, in parse-tree order. CTE references have no schema and
 * are skipped. Used by retrieval to add the tables of retrieved examples.
 */
export function referencedTables(statement: RawStmt): { schema: string; table: string }[] {
  const seen = new Map<string, { schema: string; table: string }>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const entries: [string, unknown][] = Object.entries(node)
    for (const [key, value] of entries) {
      if (key === 'RangeVar' && typeof value === 'object' && value !== null) {
        const schema: unknown = 'schemaname' in value ? value.schemaname : undefined
        const table: unknown = 'relname' in value ? value.relname : undefined
        if (typeof schema === 'string' && typeof table === 'string') {
          seen.set(`${schema}.${table}`, { schema, table })
        }
      }
      visit(value)
    }
  }
  visit(statement)
  return [...seen.values()]
}
