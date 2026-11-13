// Safety policy data (IMPLEMENTATION.md 13.1). Must stay consistent with the
// qc_reader grants in infra/postgres/init/03-reader-grants.sh (CLAUDE.md section 10);
// test/safety/policy-grants.test.ts checks both against the live catalog.

/** Rule ids in reporting order: when several rules fail, the first is reported. */
export const POLICY_RULES = [
  'PARSE_ERROR',
  'MULTIPLE_STATEMENTS',
  'NOT_SELECT',
  'DATA_MODIFYING_CTE',
  'SELECT_INTO',
  'LOCKING_CLAUSE',
  'UNQUALIFIED_TABLE',
  'SCHEMA_NOT_ALLOWED',
  'TABLE_DENIED',
  'COLUMN_DENIED',
  'PII_IN_EXPRESSION',
  'FUNCTION_NOT_ALLOWED',
] as const

export type PolicyRule = (typeof POLICY_RULES)[number]

export const ALLOWED_SCHEMAS: ReadonlySet<string> = new Set([
  'sales',
  'production',
  'person',
  'humanresources',
  'purchasing',
])

export interface TableName {
  schema: string
  table: string
}

export const DENIED_TABLES: readonly TableName[] = [{ schema: 'person', table: 'password' }]

export type PiiKind = 'email' | 'phone'

export interface ColumnPolicy {
  schema: string
  table: string
  column: string
}

export const DENIED_COLUMNS: readonly ColumnPolicy[] = [
  { schema: 'sales', table: 'creditcard', column: 'cardnumber' },
  { schema: 'humanresources', table: 'employee', column: 'nationalidnumber' },
  { schema: 'humanresources', table: 'employee', column: 'loginid' },
  { schema: 'person', table: 'person', column: 'additionalcontactinfo' },
  { schema: 'humanresources', table: 'jobcandidate', column: 'resume' },
]

export const PII_COLUMNS: readonly (ColumnPolicy & { kind: PiiKind })[] = [
  { schema: 'person', table: 'emailaddress', column: 'emailaddress', kind: 'email' },
  { schema: 'person', table: 'personphone', column: 'phonenumber', kind: 'phone' },
  { schema: 'production', table: 'productreview', column: 'emailaddress', kind: 'email' },
]

export const DENIED_COLUMN_NAMES: ReadonlySet<string> = new Set(DENIED_COLUMNS.map((c) => c.column))
export const PII_COLUMN_NAMES: ReadonlySet<string> = new Set(PII_COLUMNS.map((c) => c.column))

/**
 * Tables holding denied or PII columns, with their full column lists. A reference
 * `t.x` to one of them where `x` is not a real column is Postgres functional
 * notation (`x(t)`, e.g. `t.text` casts the whole row) and is blocked.
 */
export interface SensitiveTable extends TableName {
  kind: 'denied' | 'pii'
  columns: ReadonlySet<string>
}

export const SENSITIVE_TABLES: readonly SensitiveTable[] = [
  {
    schema: 'sales',
    table: 'creditcard',
    kind: 'denied',
    columns: new Set(['creditcardid', 'cardtype', 'cardnumber', 'expmonth', 'expyear', 'modifieddate']),
  },
  {
    schema: 'humanresources',
    table: 'employee',
    kind: 'denied',
    columns: new Set([
      'businessentityid',
      'nationalidnumber',
      'loginid',
      'jobtitle',
      'birthdate',
      'maritalstatus',
      'gender',
      'hiredate',
      'salariedflag',
      'vacationhours',
      'sickleavehours',
      'currentflag',
      'rowguid',
      'modifieddate',
      'organizationnode',
    ]),
  },
  {
    schema: 'person',
    table: 'person',
    kind: 'denied',
    columns: new Set([
      'businessentityid',
      'persontype',
      'namestyle',
      'title',
      'firstname',
      'middlename',
      'lastname',
      'suffix',
      'emailpromotion',
      'additionalcontactinfo',
      'demographics',
      'rowguid',
      'modifieddate',
    ]),
  },
  {
    schema: 'humanresources',
    table: 'jobcandidate',
    kind: 'denied',
    columns: new Set(['jobcandidateid', 'businessentityid', 'resume', 'modifieddate']),
  },
  {
    schema: 'person',
    table: 'emailaddress',
    kind: 'pii',
    columns: new Set(['businessentityid', 'emailaddressid', 'emailaddress', 'rowguid', 'modifieddate']),
  },
  {
    schema: 'person',
    table: 'personphone',
    kind: 'pii',
    columns: new Set(['businessentityid', 'phonenumber', 'phonenumbertypeid', 'modifieddate']),
  },
  {
    schema: 'production',
    table: 'productreview',
    kind: 'pii',
    columns: new Set([
      'productreviewid',
      'productid',
      'reviewername',
      'reviewdate',
      'emailaddress',
      'rating',
      'comments',
      'modifieddate',
    ]),
  },
]

/**
 * Function allowlist (13.1), by the names the parser produces. SQL-syntax forms
 * map to internal names: `trim(...)` → btrim/ltrim/rtrim, `extract(...)` → extract,
 * `substring(x from …)` → substring, `position(a in b)` → position.
 * `coalesce`, `nullif`, `greatest`, `least` are separate node types, not calls.
 */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // aggregates
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'string_agg',
  'bool_and',
  'bool_or',
  // date/time
  'date_trunc',
  'date_part',
  'extract',
  'age',
  'to_char',
  'make_date',
  // math
  'round',
  'floor',
  'ceil',
  'abs',
  // string
  'lower',
  'upper',
  'btrim',
  'ltrim',
  'rtrim',
  'concat',
  'length',
  'substring',
  'replace',
  'split_part',
  'position',
  // window
  'row_number',
  'rank',
  'dense_rank',
  'lag',
  'lead',
  'ntile',
  'first_value',
  'last_value',
])

/** Cast-type allowlist (13.1), by internal type names (`integer` → int4, `boolean` → bool, …). */
export const ALLOWED_CAST_TYPES: ReadonlySet<string> = new Set([
  'int2',
  'int4',
  'int8',
  'numeric',
  'float4',
  'float8',
  'text',
  'varchar',
  'bpchar',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'interval',
  'bool',
])

/** SQL value keywords allowed: CURRENT_DATE, CURRENT_TIMESTAMP[(p)], LOCALTIMESTAMP[(p)]. */
export const ALLOWED_VALUE_KEYWORDS: ReadonlySet<string> = new Set([
  'SVFOP_CURRENT_DATE',
  'SVFOP_CURRENT_TIMESTAMP',
  'SVFOP_CURRENT_TIMESTAMP_N',
  'SVFOP_LOCALTIMESTAMP',
  'SVFOP_LOCALTIMESTAMP_N',
])

/** Parse-tree node types a read-only SELECT needs (node-type allowlist, 13.1). */
export const ALLOWED_NODE_TYPES: ReadonlySet<string> = new Set([
  'SelectStmt',
  'CommonTableExpr',
  'ResTarget',
  'RangeVar',
  'JoinExpr',
  'RangeSubselect',
  'ColumnRef',
  'A_Star',
  'A_Const',
  'String',
  'Integer',
  'Float',
  'Boolean',
  'A_Expr',
  'BoolExpr',
  'NullTest',
  'BooleanTest',
  'CaseExpr',
  'CaseWhen',
  'CoalesceExpr',
  'MinMaxExpr',
  'FuncCall',
  'TypeCast',
  'SQLValueFunction',
  'SubLink',
  'SortBy',
  'WindowDef',
  'GroupingSet',
  'List',
  'A_ArrayExpr',
  'A_Indirection',
  'A_Indices',
  'RowExpr',
  'CollateClause',
])

/**
 * Fields of allowed nodes that hold a typed struct instead of a wrapped node, with
 * the struct's type. Any other struct field (e.g. a CTE's SEARCH / CYCLE clause) is
 * rejected, so the node-type allowlist cannot be bypassed through struct fields.
 * SelectStmt's struct fields (withClause, intoClause, larg, rarg) are handled by the
 * validator itself.
 */
export const ALLOWED_STRUCT_FIELDS: ReadonlyMap<string, string> = new Map([
  ['RangeVar.alias', 'Alias'],
  ['RangeSubselect.alias', 'Alias'],
  ['JoinExpr.alias', 'Alias'],
  ['JoinExpr.join_using_alias', 'Alias'],
  ['FuncCall.over', 'WindowDef'],
  ['TypeCast.typeName', 'TypeName'],
  ['A_Const.ival', 'Integer'],
  ['A_Const.fval', 'Float'],
  ['A_Const.boolval', 'Boolean'],
  ['A_Const.sval', 'String'],
  ['A_Const.bsval', 'BitString'],
])

/** Function-like node types: rejected with FUNCTION_NOT_ALLOWED instead of NOT_SELECT. */
export function isFunctionLikeNodeType(type: string): boolean {
  return (
    type.startsWith('Json') ||
    type.startsWith('Xml') ||
    [
      'RangeFunction',
      'RangeTableSample',
      'RangeTableFunc',
      'RangeTableFuncCol',
      'GroupingFunc',
      'MergeSupportFunc',
    ].includes(type)
  )
}

/** Data-modifying statements; inside a SELECT they can only come from a CTE. */
export const DATA_MODIFYING_NODE_TYPES: ReadonlySet<string> = new Set([
  'InsertStmt',
  'UpdateStmt',
  'DeleteStmt',
  'MergeStmt',
])
