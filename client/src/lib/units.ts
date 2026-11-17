// Column names → readable titles and units (IMPLEMENTATION.md 15, "Chart presentation").
// Units are inferred conservatively from the column name; when unsure there is no unit.
// All formatting is en-US so the table, chart and metadata read the same everywhere.

export type Unit = 'currency' | 'percent' | 'count' | 'none'

export interface ValueFormat {
  unit: Unit
  /** Multiplier before display: 100 for percent columns holding fractions, else 1. */
  scale: number
  /** Fraction digits of a full value. */
  decimals: number
  /** Thousands separators (off for ids and year-like columns). */
  grouping: boolean
}

// Whole concatenated AdventureWorks names, split into words for titles.
const SPLITS: Record<string, string> = {
  averagerate: 'average rate',
  endofdayrate: 'end of day rate',
  linetotal: 'line total',
  listprice: 'list price',
  orderdate: 'order date',
  orderqty: 'order qty',
  saleslastyear: 'sales last year',
  salesquota: 'sales quota',
  salesytd: 'sales ytd',
  standardcost: 'standard cost',
  taxamt: 'tax amount',
  taxrate: 'tax rate',
  totaldue: 'total due',
  unitprice: 'unit price',
  unitpricediscount: 'unit price discount',
}
const ACRONYMS = new Set(['id', 'ytd', 'usd', 'sku'])
const WORDS: Record<string, string> = { pct: 'percent' }

/** Raw lowercase name tokens: snake_case, kebab-case, camelCase and a trailing 4-digit year. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/([a-z])(\d{4})(?!\d)/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '')
}

/** Words of a name for display, acronyms kept upper case. */
export function nameWords(name: string): string[] {
  return nameTokens(name)
    .flatMap((t) => (SPLITS[t] ?? t).split(' '))
    .map((w) => {
      const word = WORDS[w] ?? w
      return ACRONYMS.has(word) ? word.toUpperCase() : word
    })
}

/** "revenue_2024" → "Revenue 2024", "totaldue" → "Total due". */
export function humanize(name: string): string {
  const words = nameWords(name)
  const [first, ...rest] = words
  if (first === undefined) return name
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

/** The same words in lower case (acronyms kept), for use inside a sentence. */
export function humanizeLower(name: string): string {
  return nameWords(name).join(' ')
}

const DATE_PART_NAME = /(^|_)(year|yr|quarter|month|week|day|hour)$/i
const NO_UNIT = /currency|exchange|averagerate|endofdayrate|discount/
const PERCENT_POINTS = /percent|pct/
const FRACTION_OR_POINTS = new Set(['share', 'growth', 'rate'])
const MONEY = /revenue|sales|subtotal|totaldue|price|cost|freight|spend|amount|amt|linetotal/
const COUNT_WORDS = new Set(['count', 'cnt', 'number', 'num', 'qty', 'quantity', 'units', 'orders', 'customers', 'items', 'products', 'employees', 'transactions', 'times'])
const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint'])

function isIdName(raw: string, tokens: string[]): boolean {
  return tokens.at(-1) === 'id' || (/[a-z]id$/.test(raw) && !/paid$/.test(raw))
}

function isCountToken(t: string): boolean {
  return COUNT_WORDS.has(t) || t.endsWith('qty') || t.endsWith('count')
}

function lastIndex(tokens: string[], test: (t: string, i: number) => boolean): number {
  for (let i = tokens.length - 1; i >= 0; i--) if (test(tokens[i] ?? '', i)) return i
  return -1
}

function numbersOf(values: readonly unknown[]): number[] {
  return values.flatMap((v) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? [n] : []
  })
}

/** How a numeric column is shown, from its name, type and values. */
export function inferFormat(column: { name: string; type: string }, values: readonly unknown[]): ValueFormat {
  const raw = column.name.toLowerCase()
  const tokens = nameTokens(column.name)
  const numbers = numbersOf(values)
  const whole = numbers.every((n) => Number.isInteger(n))
  const base = column.type.replace(/\(.*\)$/, '').trim().toLowerCase()
  const plain: ValueFormat = { unit: 'none', scale: 1, decimals: INTEGER_TYPES.has(base) ? 0 : 2, grouping: true }

  if (isIdName(raw, tokens) || (DATE_PART_NAME.test(column.name) && whole)) return { ...plain, decimals: 0, grouping: false }
  if (NO_UNIT.test(raw)) return plain
  if (PERCENT_POINTS.test(raw)) return { unit: 'percent', scale: 1, decimals: 1, grouping: true }
  const fractionOrPoints = tokens.some((t) => FRACTION_OR_POINTS.has(t)) || /(rate|share|growth)$/.test(raw)
  if (fractionOrPoints) {
    const fractions = numbers.length > 0 && numbers.every((n) => n >= -1 && n <= 1)
    return { unit: 'percent', scale: fractions ? 100 : 1, decimals: 1, grouping: true }
  }
  // "total_due" is two tokens: a pair of tokens counts when neither matches alone.
  const money = lastIndex(tokens, (t, i) => {
    const prev = tokens[i - 1] ?? ''
    return MONEY.test(t) || (!MONEY.test(prev) && MONEY.test(`${prev}${t}`))
  })
  const count = lastIndex(tokens, isCountToken)
  if (count > money) return { unit: 'count', scale: 1, decimals: whole ? 0 : 2, grouping: true }
  if (money >= 0) return { unit: 'currency', scale: 1, decimals: 2, grouping: true }
  return plain
}

const formatters = new Map<string, Intl.NumberFormat>()
function numberFormat(decimals: number, grouping: boolean, minDecimals = decimals): Intl.NumberFormat {
  const key = `${minDecimals}:${decimals}:${grouping}`
  let f = formatters.get(key)
  if (f === undefined) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: minDecimals, maximumFractionDigits: decimals, useGrouping: grouping })
    formatters.set(key, f)
  }
  return f
}

function withUnit(text: string, negative: boolean, unit: Unit): string {
  const sign = negative ? '-' : ''
  if (unit === 'currency') return `${sign}$${text}`
  return unit === 'percent' ? `${sign}${text}%` : `${sign}${text}`
}

/** Magnitude text and sign; a negative that rounds to zero shows no "-". */
function parts(n: number, f: ValueFormat): { text: string; negative: boolean } {
  const v = n * f.scale
  const text = numberFormat(f.decimals, f.grouping).format(Math.abs(v))
  return { text, negative: v < 0 && /[1-9]/.test(text) }
}

/** Number without its unit symbol (table cells; the header carries the unit). */
export function formatPlain(n: number, f: ValueFormat): string {
  const { text, negative } = parts(n, f)
  return withUnit(text, negative, 'none')
}

/** Full value with its unit: "$1,234,567.89", "12.3%", "1,234". */
export function formatFull(n: number, f: ValueFormat): string {
  const { text, negative } = parts(n, f)
  return withUnit(text, negative, f.unit)
}

/** Unit for a title: "USD", "%" or null. */
export function unitLabel(f: ValueFormat): string | null {
  if (f.unit === 'currency') return 'USD'
  if (f.unit === 'percent') return '%'
  return null
}

/** "Revenue 2024" + " (USD)"; no suffix when the title already says percent. */
export function titleWithUnit(title: string, f: ValueFormat | null): string {
  const unit = f === null ? null : unitLabel(f)
  if (unit === null || (unit === '%' && /percent/i.test(title))) return title
  return `${title} (${unit})`
}

/** Fraction digits that show the step exactly (2.5 → 1, 0.25 → 2), at most 4. */
function decimalsFor(step: number): number {
  if (!(step > 0)) return 0
  let d = 0
  while (d < 4 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d++
  return d
}

/**
 * Axis tick label. Compact ($1.2M, 350K) once the axis reaches 10,000, in full below;
 * the decimals follow the tick step, so neighbouring ticks never print the same text.
 */
export function formatTick(n: number, f: ValueFormat, step: number, maxAbs: number): string {
  const v = n * f.scale
  const s = step * f.scale
  const m = maxAbs * f.scale
  const negative = v < 0
  if (m >= 10_000) {
    const [div, suffix] = m >= 1e9 ? [1e9, 'B'] : m >= 1e6 ? [1e6, 'M'] : [1e3, 'K']
    const text = numberFormat(decimalsFor(s / div), true, 0).format(Math.abs(v) / div)
    return withUnit(v === 0 ? '0' : `${text}${suffix}`, negative, f.unit)
  }
  const text = numberFormat(decimalsFor(s), f.grouping, 0).format(Math.abs(v))
  return withUnit(text, negative, f.unit)
}

const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A whole number with thousands separators (tokens, costs, row counts). */
export function formatCount(n: number): string {
  return countFormat.format(Math.round(n))
}
