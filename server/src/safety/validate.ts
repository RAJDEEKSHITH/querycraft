import type { RawStmt } from '@pgsql/types'
import { parseSql } from './parser.js'
import {
  ALLOWED_CAST_TYPES,
  ALLOWED_FUNCTIONS,
  ALLOWED_NODE_TYPES,
  ALLOWED_SCHEMAS,
  ALLOWED_STRUCT_FIELDS,
  ALLOWED_VALUE_KEYWORDS,
  DATA_MODIFYING_NODE_TYPES,
  DENIED_COLUMN_NAMES,
  DENIED_TABLES,
  PII_COLUMN_NAMES,
  POLICY_RULES,
  SENSITIVE_TABLES,
  isFunctionLikeNodeType,
  type PolicyRule,
  type SensitiveTable,
} from './policy.js'

// Safety layer 2: parse and policy (IMPLEMENTATION.md 13.1).
//
// One walker visits every node of the parse tree. Scope changes only at SELECT
// statements (CTE names, FROM relations); everything else is checked wherever it
// appears. The tree is read through runtime-checked getters, so an unexpected
// shape is never silently trusted.

export type ValidationResult =
  | { ok: true; statement: RawStmt }
  | { ok: false; rule: PolicyRule; message: string; retryable: boolean }

type Obj = Record<string, unknown>

interface Violation {
  rule: PolicyRule
  message: string
}

interface Relation {
  /** How columns qualify it: the alias, or the table name when there is none. */
  name: string
  schema: string | undefined
  table: string
  sensitive: SensitiveTable | undefined
}

interface Scope {
  parent: Scope | undefined
  ctes: ReadonlySet<string>
  relations: Relation[]
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A parse-tree node is wrapped as `{ TypeName: { ...fields } }`; field structs are not. */
function asNode(value: unknown): { type: string; body: Obj } | undefined {
  if (!isObj(value)) return undefined
  const keys = Object.keys(value)
  const [type] = keys
  if (keys.length !== 1 || type === undefined || !/^[A-Z]/.test(type)) return undefined
  const body = value[type]
  return isObj(body) ? { type, body } : undefined
}

function nodeOf(value: unknown, type: string): Obj | undefined {
  const node = asNode(value)
  return node?.type === type ? node.body : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** `[{ String: { sval } }, …]` → names; undefined if any item is not a String node. */
function names(value: unknown): string[] | undefined {
  const result: string[] = []
  for (const item of list(value)) {
    const sval = str(nodeOf(item, 'String')?.sval)
    if (sval === undefined) return undefined
    result.push(sval)
  }
  return result
}

/** Integer value of an `A_Const` (`{ ival: {} }` encodes 0), else undefined. */
export function integerConstant(value: unknown): number | undefined {
  const body = nodeOf(value, 'A_Const')
  if (body === undefined || !isObj(body.ival)) return undefined
  const ival = body.ival.ival
  return ival === undefined ? 0 : typeof ival === 'number' ? ival : undefined
}

function findSensitive(schema: string | undefined, table: string): SensitiveTable | undefined {
  return SENSITIVE_TABLES.find((t) => t.schema === schema && t.table === table)
}

function qualified(table: SensitiveTable): string {
  return `${table.schema}.${table.table}`
}

class PolicyWalker {
  readonly violations: Violation[] = []

  private add(rule: PolicyRule, message: string): void {
    this.violations.push({ rule, message })
  }

  private sensitiveViolation(table: SensitiveTable, what: string): void {
    if (table.kind === 'denied') {
      this.add('COLUMN_DENIED', `${what} on ${qualified(table)} would expose denied columns`)
    } else {
      this.add('PII_IN_EXPRESSION', `${what} on ${qualified(table)} would bypass PII masking`)
    }
  }

  walkValue(value: unknown, scope: Scope): void {
    if (Array.isArray(value)) {
      for (const item of value) this.walkValue(item, scope)
      return
    }
    if (!isObj(value)) return
    const node = asNode(value)
    if (node !== undefined) {
      this.walkNode(node.type, node.body, scope)
    } else if (Object.keys(value).length > 0) {
      // Lists hold wrapped nodes; only empty placeholders (plain DISTINCT) are expected.
      this.add('NOT_SELECT', 'Unexpected structure in the parse tree')
    }
  }

  /**
   * Walks the fields of a node (or struct) of type `owner`. A field holding a typed
   * struct is accepted only if listed in ALLOWED_STRUCT_FIELDS.
   */
  private walkFields(body: Obj, scope: Scope, owner: string, skip: readonly string[] = []): void {
    for (const [key, field] of Object.entries(body)) {
      if (skip.includes(key)) continue
      if (isObj(field) && asNode(field) === undefined) {
        const structType = ALLOWED_STRUCT_FIELDS.get(`${owner}.${key}`)
        if (structType === undefined) {
          this.add('NOT_SELECT', `Construct ${owner}.${key} is not allowed in a read-only SELECT`)
        } else {
          this.walkFields(field, scope, structType)
        }
      } else {
        this.walkValue(field, scope)
      }
    }
  }

  /** Inside a rejected node: keep walking (nested violations still count) without struct checks. */
  private walkLoose(value: unknown, scope: Scope): void {
    if (Array.isArray(value)) {
      for (const item of value) this.walkLoose(item, scope)
      return
    }
    if (!isObj(value)) return
    const node = asNode(value)
    if (node !== undefined) {
      this.walkNode(node.type, node.body, scope)
    } else {
      for (const field of Object.values(value)) this.walkLoose(field, scope)
    }
  }

  private walkNode(type: string, body: Obj, scope: Scope): void {
    if (type === 'SelectStmt') {
      this.walkSelect(body, scope, false)
      return
    }
    if (DATA_MODIFYING_NODE_TYPES.has(type)) {
      // The root is already known to be a SELECT, so this is inside a CTE.
      this.add('DATA_MODIFYING_CTE', 'WITH queries must not modify data')
      return
    }
    if (!ALLOWED_NODE_TYPES.has(type)) {
      if (isFunctionLikeNodeType(type)) {
        this.add('FUNCTION_NOT_ALLOWED', `Construct ${type} is not allowed`)
      } else {
        this.add('NOT_SELECT', `Construct ${type} is not allowed in a read-only SELECT`)
      }
      this.walkLoose(body, scope)
      return
    }
    switch (type) {
      case 'RangeVar':
        this.checkRangeVar(body, scope)
        break
      case 'ColumnRef':
        this.checkColumnRef(body, scope, false)
        break
      case 'JoinExpr':
        this.checkJoin(body)
        break
      case 'FuncCall':
        this.checkFunction(body)
        break
      case 'TypeCast':
        this.checkCastType(body.typeName)
        break
      case 'SQLValueFunction':
        this.checkValueKeyword(body)
        break
      case 'A_Expr':
        this.checkOperator(body.name)
        break
      case 'SubLink':
        this.checkOperator(body.operName)
        break
      case 'CommonTableExpr':
        // CTEs are walked by walkSelect with their own scope; reaching one here
        // means an unexpected position, which is not a plain SELECT.
        this.add('NOT_SELECT', 'Unexpected WITH query position')
        break
    }
    this.walkFields(body, scope, type)
  }

  walkSelect(select: Obj, parent: Scope | undefined, isTop: boolean): void {
    const handled = ['withClause', 'intoClause', 'lockingClause', 'larg', 'rarg', 'fromClause', 'targetList']
    const cteNames = this.walkWithClause(select.withClause, parent)
    const scope: Scope = { parent, ctes: cteNames, relations: [] }

    if (select.intoClause !== undefined) {
      this.add('SELECT_INTO', 'SELECT … INTO is not allowed')
    }
    if (list(select.lockingClause).length > 0) {
      this.add('LOCKING_CLAUSE', 'Locking clauses (FOR UPDATE / FOR SHARE) are not allowed')
    }

    const isSetOperation = (str(select.op) ?? 'SETOP_NONE') !== 'SETOP_NONE'
    for (const branch of [select.larg, select.rarg]) {
      if (isObj(branch)) this.walkSelect(branch, scope, false)
    }

    scope.relations = this.collectRelations(list(select.fromClause), scope)
    this.walkValue(select.fromClause, scope)

    // PII may appear bare only in the top-level select list of a non-set-operation query.
    const bareAllowed = isTop && !isSetOperation
    for (const item of list(select.targetList)) {
      const target = nodeOf(item, 'ResTarget')
      const columnRef = target === undefined ? undefined : nodeOf(target.val, 'ColumnRef')
      if (bareAllowed && target !== undefined && columnRef !== undefined) {
        this.checkColumnRef(columnRef, scope, true)
        this.walkValue(columnRef.fields, scope)
        this.walkFields(target, scope, 'ResTarget', ['val'])
      } else {
        this.walkValue(item, scope)
      }
    }

    this.walkFields(select, scope, 'SelectStmt', handled)
    if (bareAllowed) this.checkOutputReferences(select, scope)
  }

  /** Walks each CTE with the names visible to it; returns all names of this WITH. */
  private walkWithClause(value: unknown, parent: Scope | undefined): ReadonlySet<string> {
    if (!isObj(value)) return new Set()
    const ctes = list(value.ctes)
    const allNames = ctes.map((cte) => str(nodeOf(cte, 'CommonTableExpr')?.ctename) ?? '')
    const recursive = value.recursive === true
    ctes.forEach((cte, index) => {
      // Without RECURSIVE a CTE sees only earlier siblings (an unqualified name it
      // cannot see would resolve through the search path instead).
      const visible = new Set(recursive ? allNames : allNames.slice(0, index))
      const cteScope: Scope = { parent, ctes: visible, relations: [] }
      const body = nodeOf(cte, 'CommonTableExpr')
      if (body === undefined) {
        this.walkValue(cte, cteScope)
        return
      }
      const query = nodeOf(body.ctequery, 'SelectStmt')
      if (query === undefined) {
        this.walkValue(body.ctequery, cteScope)
      } else {
        this.walkSelect(query, cteScope, false)
      }
      this.walkFields(body, cteScope, 'CommonTableExpr', ['ctequery'])
    })
    return new Set(allNames)
  }

  private collectRelations(fromItems: unknown[], scope: Scope): Relation[] {
    const relations: Relation[] = []
    const visit = (item: unknown): void => {
      const node = asNode(item)
      if (node === undefined) return
      const alias = isObj(node.body.alias) ? str(node.body.alias.aliasname) : undefined
      if (node.type === 'RangeVar') {
        const schema = str(node.body.schemaname)
        const table = str(node.body.relname) ?? ''
        const isCte = schema === undefined && cteVisible(table, scope)
        relations.push({
          name: alias ?? table,
          schema,
          table,
          sensitive: isCte ? undefined : findSensitive(schema, table),
        })
      } else if (node.type === 'JoinExpr') {
        visit(node.body.larg)
        visit(node.body.rarg)
        if (alias !== undefined) relations.push({ name: alias, schema: undefined, table: alias, sensitive: undefined })
      } else if (alias !== undefined) {
        relations.push({ name: alias, schema: undefined, table: alias, sensitive: undefined })
      }
    }
    fromItems.forEach(visit)
    return relations
  }

  private checkRangeVar(body: Obj, scope: Scope): void {
    const schema = str(body.schemaname)
    const table = str(body.relname) ?? ''
    if (body.catalogname !== undefined) {
      this.add('SCHEMA_NOT_ALLOWED', 'Database-qualified table names are not allowed')
      return
    }
    if (schema === undefined) {
      if (!cteVisible(table, scope)) {
        this.add('UNQUALIFIED_TABLE', `Table "${table}" must be schema-qualified`)
      }
      return
    }
    if (!ALLOWED_SCHEMAS.has(schema)) {
      this.add('SCHEMA_NOT_ALLOWED', `Schema "${schema}" is not allowed`)
      return
    }
    if (DENIED_TABLES.some((t) => t.schema === schema && t.table === table)) {
      this.add('TABLE_DENIED', `Table ${schema}.${table} is not allowed`)
    }
    const sensitive = findSensitive(schema, table)
    const colnames = isObj(body.alias) ? list(body.alias.colnames) : []
    if (sensitive !== undefined && colnames.length > 0) {
      this.sensitiveViolation(sensitive, 'Renaming columns')
    }
  }

  private checkColumnRef(body: Obj, scope: Scope, bareTopLevel: boolean): void {
    const fields = list(body.fields)
    const isStar = fields.length > 0 && nodeOf(fields[fields.length - 1], 'A_Star') !== undefined
    const parts = names(isStar ? fields.slice(0, -1) : fields)
    if (parts === undefined) {
      this.add('NOT_SELECT', 'Unsupported column reference')
      return
    }
    if (parts.length > (isStar ? 2 : 3)) {
      this.add('SCHEMA_NOT_ALLOWED', 'Database-qualified column references are not allowed')
      return
    }

    if (isStar) {
      const covered = parts.length === 0 ? scope.relations : [resolve(parts, scope)]
      for (const relation of covered) {
        const table = relation?.sensitive
        if (table === undefined) continue
        if (table.kind === 'denied' || !bareTopLevel) this.sensitiveViolation(table, '"*"')
      }
      return
    }

    const column = parts[parts.length - 1] ?? ''
    const qualifier = parts.slice(0, -1)
    if (DENIED_COLUMN_NAMES.has(column)) {
      this.add('COLUMN_DENIED', `Column "${column}" is not allowed`)
    }
    if (PII_COLUMN_NAMES.has(column) && !bareTopLevel) {
      this.add(
        'PII_IN_EXPRESSION',
        `PII column "${column}" may only be selected directly in the top-level select list`,
      )
    }
    // `t` alone is a whole-row reference; `t.x` with x not a column is functional
    // notation x(t). Either exposes every column of a sensitive table.
    const relation = resolve(qualifier.length === 0 ? [column] : qualifier, scope)
    const table = relation?.sensitive
    if (table !== undefined && !table.columns.has(column)) {
      this.sensitiveViolation(table, qualifier.length === 0 ? 'A whole-row reference' : `"${column}"`)
    }
  }

  private checkJoin(body: Obj): void {
    const sensitive: SensitiveTable[] = []
    const visit = (item: unknown): void => {
      const rangeVar = nodeOf(item, 'RangeVar')
      if (rangeVar !== undefined) {
        const table = findSensitive(str(rangeVar.schemaname), str(rangeVar.relname) ?? '')
        if (table !== undefined) sensitive.push(table)
      }
      const join = nodeOf(item, 'JoinExpr')
      if (join !== undefined) {
        visit(join.larg)
        visit(join.rarg)
      }
    }
    visit(body.larg)
    visit(body.rarg)
    for (const column of names(body.usingClause) ?? []) {
      if (DENIED_COLUMN_NAMES.has(column)) this.add('COLUMN_DENIED', `Column "${column}" is not allowed`)
      if (PII_COLUMN_NAMES.has(column)) {
        this.add('PII_IN_EXPRESSION', `PII column "${column}" may not be used as a join condition`)
      }
    }
    for (const table of sensitive) {
      if (body.isNatural === true) this.sensitiveViolation(table, 'NATURAL JOIN')
      if (body.alias !== undefined) this.sensitiveViolation(table, 'A join alias')
    }
  }

  private checkFunction(body: Obj): void {
    const parts = names(body.funcname) ?? []
    const name = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === 'pg_catalog' ? parts[1] : undefined
    if (name === undefined || !ALLOWED_FUNCTIONS.has(name)) {
      this.add('FUNCTION_NOT_ALLOWED', `Function ${parts.join('.')} is not allowed`)
    }
  }

  private checkCastType(value: unknown): void {
    const typeName = isObj(value) ? value : {}
    const parts = names(typeName.names) ?? []
    const name = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === 'pg_catalog' ? parts[1] : undefined
    const plain = list(typeName.arrayBounds).length === 0 && typeName.setof !== true && typeName.pct_type !== true
    if (name === undefined || !plain || !ALLOWED_CAST_TYPES.has(name)) {
      this.add('FUNCTION_NOT_ALLOWED', `Cast to type ${parts.join('.')} is not allowed`)
    }
  }

  private checkValueKeyword(body: Obj): void {
    const op = str(body.op) ?? ''
    if (!ALLOWED_VALUE_KEYWORDS.has(op)) {
      this.add('FUNCTION_NOT_ALLOWED', `SQL value keyword ${op.replace('SVFOP_', '')} is not allowed`)
    }
  }

  private checkOperator(value: unknown): void {
    const parts = names(value) ?? []
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'pg_catalog')) {
      this.add('FUNCTION_NOT_ALLOWED', `Operator ${parts.join('.')} is not allowed`)
    }
  }

  /**
   * ORDER BY, GROUP BY and DISTINCT ON may name output columns by alias or position.
   * A key that points at a PII output column uses PII outside the select list.
   */
  private checkOutputReferences(select: Obj, scope: Scope): void {
    const piiPositions = new Set<number>()
    const piiAliases = new Set<string>()
    let piiStar = false
    list(select.targetList).forEach((item, index) => {
      const target = nodeOf(item, 'ResTarget')
      const fields = list(nodeOf(target?.val, 'ColumnRef')?.fields)
      if (target === undefined || fields.length === 0) return
      const last = fields[fields.length - 1]
      if (nodeOf(last, 'A_Star') !== undefined) {
        const parts = names(fields.slice(0, -1)) ?? []
        const covered = parts.length === 0 ? scope.relations : [resolve(parts, scope)]
        if (covered.some((r) => r?.sensitive?.kind === 'pii')) piiStar = true
        return
      }
      const column = str(nodeOf(last, 'String')?.sval)
      if (column !== undefined && PII_COLUMN_NAMES.has(column)) {
        piiPositions.add(index + 1)
        piiAliases.add(str(target.name) ?? column)
      }
    })

    const keys: unknown[] = []
    for (const item of list(select.sortClause)) keys.push(nodeOf(item, 'SortBy')?.node)
    const addGroupKeys = (items: unknown[]): void => {
      for (const item of items) {
        const set = nodeOf(item, 'GroupingSet')
        if (set === undefined) keys.push(item)
        else addGroupKeys(list(set.content))
      }
    }
    addGroupKeys(list(select.groupClause))
    keys.push(...list(select.distinctClause))

    for (const key of keys) {
      const position = integerConstant(key)
      const refNames = names(nodeOf(key, 'ColumnRef')?.fields)
      const alias = refNames?.length === 1 ? refNames[0] : undefined
      if (
        (position !== undefined && (piiPositions.has(position) || piiStar)) ||
        (alias !== undefined && piiAliases.has(alias))
      ) {
        this.add('PII_IN_EXPRESSION', 'PII columns may not be used in ORDER BY, GROUP BY or DISTINCT ON')
      }
    }
  }
}

function cteVisible(name: string, scope: Scope | undefined): boolean {
  for (let s = scope; s !== undefined; s = s.parent) {
    if (s.ctes.has(name)) return true
  }
  return false
}

/** Finds the relation a qualifier names (`t` or `schema.table`), innermost scope first. */
function resolve(qualifier: string[], scope: Scope): Relation | undefined {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
    const found = s.relations.find((r) =>
      qualifier.length === 1 ? r.name === qualifier[0] : r.schema === qualifier[0] && r.table === qualifier[1],
    )
    if (found !== undefined) return found
  }
  return undefined
}

function firstViolation(violations: Violation[]): Violation | undefined {
  return [...violations].sort((a, b) => POLICY_RULES.indexOf(a.rule) - POLICY_RULES.indexOf(b.rule))[0]
}

export async function validateSql(sql: string): Promise<ValidationResult> {
  const parsed = await parseSql(sql)
  if (!parsed.ok) {
    return { ok: false, rule: 'PARSE_ERROR', message: `SQL does not parse: ${parsed.message}`, retryable: true }
  }
  const [statement, ...rest] = parsed.statements
  if (statement === undefined) {
    return { ok: false, rule: 'PARSE_ERROR', message: 'SQL contains no statement', retryable: true }
  }
  if (rest.length > 0) {
    return { ok: false, rule: 'MULTIPLE_STATEMENTS', message: 'Only one statement is allowed', retryable: false }
  }
  const root = asNode(statement.stmt)
  if (root?.type !== 'SelectStmt') {
    return {
      ok: false,
      rule: 'NOT_SELECT',
      message: `Only SELECT statements are allowed${root === undefined ? '' : ` (got ${root.type})`}`,
      retryable: false,
    }
  }
  const walker = new PolicyWalker()
  walker.walkSelect(root.body, undefined, true)
  const violation = firstViolation(walker.violations)
  if (violation !== undefined) {
    return { ok: false, rule: violation.rule, message: violation.message, retryable: false }
  }
  return { ok: true, statement }
}
