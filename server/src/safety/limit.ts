import type { Node, RawStmt, SelectStmt } from '@pgsql/types'
import { parseSql } from './parser.js'
import { integerConstant } from './validate.js'

// Row limit (IMPLEMENTATION.md 13.1, decision D10). The top-level LIMIT becomes at
// most rowLimit + 1 so the executor can detect truncation. The limit is written into
// the original SQL text at the parser's token positions (never by wrapping the query
// in a subquery, never with a deparser), and the result is parsed again: it must be
// exactly the intended tree, otherwise the query is rejected (fail closed).

export type RowLimitResult = { ok: true; sql: string } | { ok: false; message: string }

type Edit =
  | { kind: 'none' }
  | { kind: 'append' }
  /** Replace the literal token (integer, ALL or NULL) that starts at this byte offset. */
  | { kind: 'replace'; location: number }
  | { kind: 'reject'; message: string }

const REJECT_EXPRESSION: Edit = {
  kind: 'reject',
  message: 'The LIMIT must be an integer literal',
}

function planEdit(select: SelectStmt, cap: number): Edit {
  const count = select.limitCount
  if (count === undefined) return { kind: 'append' }
  if (!('A_Const' in count)) return REJECT_EXPRESSION
  const location = count.A_Const.location ?? -1
  if (count.A_Const.isnull === true) {
    // LIMIT ALL / LIMIT NULL: no limit at all.
    return location >= 0 ? { kind: 'replace', location } : REJECT_EXPRESSION
  }
  const value = integerConstant(count)
  if (value === undefined) return REJECT_EXPRESSION
  if (value <= cap) return { kind: 'none' }
  return location >= 0 ? { kind: 'replace', location } : REJECT_EXPRESSION
}

function integerNode(value: number): Node {
  return { A_Const: { ival: { ival: value } } }
}

/** The tree the rewritten SQL must parse to. */
function expectedSelect(select: SelectStmt, edit: Edit, cap: number): SelectStmt {
  if (edit.kind === 'none' || edit.kind === 'reject') return select
  const option = select.limitOption === undefined || select.limitOption === 'LIMIT_OPTION_DEFAULT'
  return {
    ...select,
    limitCount: integerNode(cap),
    limitOption: option ? 'LIMIT_OPTION_COUNT' : (select.limitOption ?? 'LIMIT_OPTION_COUNT'),
  }
}

const POSITION_KEYS = new Set(['location', 'stmt_location', 'stmt_len'])

/** Deep equality of two parse trees, ignoring source positions and key order. */
function sameTree(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameTree(x, b[i]))
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return a === b
  }
  const keysA = Object.keys(a).filter((k) => !POSITION_KEYS.has(k))
  const keysB = Object.keys(b).filter((k) => !POSITION_KEYS.has(k))
  const recordA: Record<string, unknown> = { ...a }
  const recordB: Record<string, unknown> = { ...b }
  return keysA.length === keysB.length && keysA.every((k) => k in recordB && sameTree(recordA[k], recordB[k]))
}

/** Applies the edit to the statement's text. Parser positions are UTF-8 byte offsets. */
function editText(sql: string, statement: RawStmt, edit: Edit, cap: number): string | undefined {
  const bytes = Buffer.from(sql, 'utf8')
  const start = statement.stmt_location ?? 0
  const end = statement.stmt_len !== undefined && statement.stmt_len > 0 ? start + statement.stmt_len : bytes.length
  const text = (from: number, to: number): string => bytes.subarray(from, to).toString('utf8')
  switch (edit.kind) {
    case 'none':
      return text(start, end)
    case 'append':
      // On a new line, so a trailing line comment cannot swallow it.
      return `${text(start, end)}\nLIMIT ${cap}`
    case 'replace': {
      if (edit.location < start || edit.location >= end) return undefined
      const token = /^[0-9A-Za-z_]+/.exec(text(edit.location, end))?.[0]
      if (token === undefined) return undefined
      return `${text(start, edit.location)}${cap}${text(edit.location + token.length, end)}`
    }
    case 'reject':
      return undefined
  }
}

/**
 * Returns the SQL of a validated SELECT (its statement text, without a trailing
 * semicolon) with the top-level row limit applied.
 */
export async function applyRowLimit(sql: string, statement: RawStmt, rowLimit: number): Promise<RowLimitResult> {
  const stmt = statement.stmt
  if (stmt === undefined || !('SelectStmt' in stmt)) {
    throw new Error('applyRowLimit expects a validated SELECT statement')
  }
  const cap = rowLimit + 1
  const edit = planEdit(stmt.SelectStmt, cap)
  if (edit.kind === 'reject') {
    return { ok: false, message: edit.message }
  }
  const limitedSql = editText(sql, statement, edit, cap)
  const reparsed = limitedSql === undefined ? undefined : await parseSql(limitedSql)
  const [only, ...rest] = reparsed?.ok === true ? reparsed.statements : []
  const expected: Node = { SelectStmt: expectedSelect(stmt.SelectStmt, edit, cap) }
  if (limitedSql === undefined || only === undefined || rest.length > 0 || !sameTree(only.stmt, expected)) {
    return { ok: false, message: 'The row limit could not be applied safely' }
  }
  return { ok: true, sql: limitedSql }
}
