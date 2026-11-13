import type { ColumnOrigin, ResultColumn } from './executor.js'
import { PII_COLUMNS, type PiiKind } from './policy.js'

// Safety layer 5: PII masking (IMPLEMENTATION.md 13.5, decision D11). A column is
// PII because of where its values come from (result-field origin: table OID +
// column number, resolved by the executor), never because of its name, so an
// alias cannot evade masking. validate.ts makes sure PII cannot reach the result
// without an origin.

export function piiKindOf(origin: ColumnOrigin | null): PiiKind | undefined {
  if (origin === null) return undefined
  return PII_COLUMNS.find(
    (c) => c.schema === origin.schema && c.table === origin.table && c.column === origin.column,
  )?.kind
}

/** `jane.doe@example.com` → `j***@example.com`. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${value.charAt(0)}***@${value.slice(at + 1)}`
}

/** `819-555-0175` → `***-***-0175` (last four digits kept). */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return '***'
  return `***-***-${digits.slice(-4)}`
}

function maskValue(kind: PiiKind, value: unknown): unknown {
  if (value === null || value === undefined) return value
  // PII columns are text; anything else is masked completely (fail closed).
  if (typeof value !== 'string') return '***'
  return kind === 'email' ? maskEmail(value) : maskPhone(value)
}

/** Returns new rows with every PII column masked. */
export function maskRows(columns: readonly ResultColumn[], rows: readonly unknown[][]): unknown[][] {
  const kinds = columns.map((c) => piiKindOf(c.origin))
  if (kinds.every((k) => k === undefined)) return rows.map((row) => [...row])
  return rows.map((row) => row.map((value, i) => {
    const kind = kinds[i]
    return kind === undefined ? value : maskValue(kind, value)
  }))
}
