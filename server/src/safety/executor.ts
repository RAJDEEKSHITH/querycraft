import { DatabaseError, types, type CustomTypesConfig, type FieldDef, type PoolClient, type QueryArrayConfig, type QueryConfig } from 'pg'
import { closeReaderPool, getReaderPool } from '../db/reader.js'

// Safety layer 4: executor (IMPLEMENTATION.md 13.3). Every query runs in
// BEGIN READ ONLY with SET LOCAL statement_timeout, in the extended query protocol
// (Postgres then rejects more than one statement), and the row cap is applied here
// independently of the LIMIT rewrite (decision D39).

export interface ColumnOrigin {
  schema: string
  table: string
  column: string
}

export interface ResultColumn {
  name: string
  type: string
  /** Source table column from result-field metadata; null for computed columns. */
  origin: ColumnOrigin | null
}

export type DbFailureKind = 'timeout' | 'permission_denied' | 'error'

/** A SQL-level failure reported by Postgres. Infrastructure failures are thrown instead. */
export interface DbFailure {
  ok: false
  kind: DbFailureKind
  sqlState: string
  dbMessage: string
}

export type ExecutionResult =
  | {
      ok: true
      columns: ResultColumn[]
      rows: unknown[][]
      rowCount: number
      truncated: boolean
      durationMs: number
    }
  | DbFailure

export interface ExecuteOptions {
  rowLimit: number
  timeoutMs: number
}

/** SQLSTATE classes that mean the database or connection failed, not the query. */
const INFRASTRUCTURE_SQLSTATE = /^(08|53|57P|58|XX|3D)/

/** Maps a query error to a DbFailure, or rethrows when it is not the query's fault. */
export function classifyDatabaseError(err: unknown): DbFailure {
  if (!(err instanceof DatabaseError) || err.code === undefined || INFRASTRUCTURE_SQLSTATE.test(err.code)) {
    throw err
  }
  const kind: DbFailureKind =
    err.code === '57014' ? 'timeout' : err.code === '42501' || err.code === '25006' ? 'permission_denied' : 'error'
  return { ok: false, kind, sqlState: err.code, dbMessage: err.message }
}

/** Extended-protocol query config (pg 8.23 supports `queryMode`; @types/pg omits it). */
export function extendedQuery(text: string): QueryConfig & { queryMode: 'extended' } {
  return { text, queryMode: 'extended' }
}

/**
 * Runs `work` inside BEGIN READ ONLY with a local statement timeout, then commits;
 * rolls back on any error. A client whose rollback fails is discarded.
 */
export async function runReadOnly<T>(timeoutMs: number, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive integer')
  }
  const client = await getReaderPool().connect()
  let broken: Error | undefined
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error('Rollback failed')
    }
    throw err
  } finally {
    client.release(broken)
  }
}

// Origins and type names are resolved with fixed catalog queries and cached:
// table OIDs, column numbers and type OIDs do not change while the database lives.
const originCache = new Map<string, ColumnOrigin>()
const typeNameCache = new Map<number, string>()

function originKey(tableId: number, columnId: number): string {
  return `${tableId}:${columnId}`
}

async function resolveOrigins(client: PoolClient, fields: FieldDef[]): Promise<void> {
  const missing = fields.filter((f) => f.tableID !== 0 && !originCache.has(originKey(f.tableID, f.columnID)))
  if (missing.length === 0) return
  const result = await client.query<{ table_id: string; column_id: number; schema: string; table: string; column: string }>({
    text: `SELECT a.attrelid::int8 AS table_id, a.attnum AS column_id,
                  n.nspname AS schema, c.relname AS table, a.attname AS column
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE (a.attrelid, a.attnum) IN (SELECT * FROM unnest($1::oid[], $2::int2[]))`,
    values: [missing.map((f) => f.tableID), missing.map((f) => f.columnID)],
  })
  for (const row of result.rows) {
    originCache.set(originKey(Number(row.table_id), row.column_id), {
      schema: row.schema,
      table: row.table,
      column: row.column,
    })
  }
}

async function resolveTypeNames(client: PoolClient, fields: FieldDef[]): Promise<void> {
  const missing = [...new Set(fields.map((f) => f.dataTypeID))].filter((id) => !typeNameCache.has(id))
  if (missing.length === 0) return
  const result = await client.query<{ type_id: string; name: string }>({
    text: 'SELECT oid::int8 AS type_id, pg_catalog.format_type(oid, NULL) AS name FROM pg_catalog.pg_type WHERE oid = ANY($1::oid[])',
    values: [missing],
  })
  for (const row of result.rows) {
    typeNameCache.set(Number(row.type_id), row.name)
  }
}

function toColumn(field: FieldDef): ResultColumn {
  return {
    name: field.name,
    type: typeNameCache.get(field.dataTypeID) ?? 'unknown',
    origin: field.tableID === 0 ? null : (originCache.get(originKey(field.tableID, field.columnID)) ?? null),
  }
}

// node-postgres turns `date` and `timestamp` (without time zone) into JS Dates in
// the server's local time zone, which shifts them once serialised as UTC
// (2024-01-01 became 2023-12-31T18:30:00Z on a UTC+05:30 machine). These types
// carry no time zone, so result values stay the exact text Postgres sent.
// `timestamptz` keeps the default parser: it is an absolute instant.
const PG_TYPE = { date: 1082, timestamp: 1114, dateArray: 1182, timestampArray: 1115, textArray: 1009 } as const

function resultTypeParser(oid: number, format?: 'text' | 'binary'): (value: string) => unknown {
  if (oid === PG_TYPE.date || oid === PG_TYPE.timestamp) return (value) => value
  // Arrays of these types are parsed like text arrays, so each element stays text.
  if (oid === PG_TYPE.dateArray || oid === PG_TYPE.timestampArray) return defaultTypeParser(PG_TYPE.textArray, format)
  return defaultTypeParser(oid, format)
}

// pg-types types its parsers as returning `any`; seen through this signature they return `unknown`.
const defaultTypeParser: (oid: number, format?: 'text' | 'binary') => (value: string) => unknown = types.getTypeParser

const resultTypes: CustomTypesConfig = { getTypeParser: resultTypeParser }

/** Executes one already validated and limited SELECT. Rows are arrays (duplicate column names stay distinct). */
export async function executeQuery(sql: string, options: ExecuteOptions): Promise<ExecutionResult> {
  const started = performance.now()
  try {
    return await runReadOnly(options.timeoutMs, async (client): Promise<ExecutionResult> => {
      const config: QueryArrayConfig & { queryMode: 'extended' } = {
        ...extendedQuery(sql),
        rowMode: 'array',
        types: resultTypes,
      }
      const result = await client.query<unknown[]>(config)
      await resolveOrigins(client, result.fields)
      await resolveTypeNames(client, result.fields)
      const rows = result.rows.slice(0, options.rowLimit)
      return {
        ok: true,
        columns: result.fields.map(toColumn),
        rows,
        rowCount: rows.length,
        truncated: result.rows.length > options.rowLimit,
        durationMs: Math.round(performance.now() - started),
      }
    })
  } catch (err) {
    return classifyDatabaseError(err)
  }
}

// M0: fixed connectivity check for GET /api/health.
export async function pingReader(): Promise<void> {
  await getReaderPool().query('SELECT 1')
}

export async function closeReaderConnections(): Promise<void> {
  await closeReaderPool()
}
