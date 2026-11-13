import { z } from 'zod'
import { getAppPool } from '../db/app.js'

// Value lookup (IMPLEMENTATION.md 11.3, D24): question words and phrases matched
// against stored column values with pg_trgm similarity. No embeddings, no quota.
// `%` uses the GIN trigram index; its threshold is set for this transaction only.

export const VALUE_TOP_K = 10
export const VALUE_SIMILARITY_THRESHOLD = 0.3
const MAX_PHRASE_WORDS = 3
const MIN_WORD_LENGTH = 3

// Words that never name a stored value on their own. A phrase is kept only when it
// starts and ends with a content word ("price of bikes" is dropped, "new york" kept).
const STOPWORDS = new Set(
  (
    'a an and any are as at be by can did do does for from get give had has have how i in is it its list ' +
    'many me much my of on or our per show than that the their them there these they this to total ' +
    'top us was we were what when where which who why will with within without year years month months ' +
    'day days all each every most least more less number count sum average avg by between during over under'
  ).split(' '),
)

/** Lower-case words of a question (letters, digits, inner apostrophes and hyphens). */
function words(question: string): string[] {
  return question.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
}

function isContentWord(word: string): boolean {
  return word.length >= MIN_WORD_LENGTH && !STOPWORDS.has(word)
}

/** Distinct 1–3 word phrases that start and end with a content word. */
export function questionPhrases(question: string): string[] {
  const list = words(question)
  const phrases = new Set<string>()
  for (let start = 0; start < list.length; start += 1) {
    for (let size = 1; size <= MAX_PHRASE_WORDS && start + size <= list.length; size += 1) {
      const phrase = list.slice(start, start + size)
      const first = phrase[0]
      const last = phrase[phrase.length - 1]
      if (first !== undefined && last !== undefined && isContentWord(first) && isContentWord(last)) {
        phrases.add(phrase.join(' '))
      }
    }
  }
  return [...phrases]
}

export interface ValueMatch {
  schema: string
  table: string
  column: string
  value: string
  /** The question phrase it matched. */
  phrase: string
  similarity: number
}

const matchRow = z.object({
  schema_name: z.string(),
  table_name: z.string(),
  column_name: z.string(),
  value: z.string(),
  phrase: z.string(),
  similarity: z.coerce.number(),
})

// Best phrase per value, then at most MAX_VALUES_PER_PHRASE values per phrase, so one
// generic word ("mountain" → Mountain-100 … Mountain-500) cannot fill the top k.
const MAX_VALUES_PER_PHRASE = 3

const LOOKUP_SQL = `
SELECT schema_name, table_name, column_name, value, phrase, similarity
  FROM (
    SELECT best.*, row_number() OVER (PARTITION BY phrase ORDER BY similarity DESC, length(value), value) AS phrase_rank
      FROM (
        SELECT DISTINCT ON (cv.id) cv.schema_name, cv.table_name, cv.column_name, cv.value,
               p.phrase, similarity(cv.value, p.phrase) AS similarity
          FROM unnest($1::text[]) AS p(phrase)
          JOIN column_values cv ON cv.value % p.phrase
         ORDER BY cv.id, similarity(cv.value, p.phrase) DESC, length(p.phrase) DESC
      ) best
  ) ranked
 WHERE phrase_rank <= ${MAX_VALUES_PER_PHRASE}
 ORDER BY similarity DESC, length(value), value
 LIMIT $2`

/** Stored values most similar to the question's phrases, best match per value, top k. */
export async function lookupValues(
  question: string,
  options: { limit?: number; threshold?: number } = {},
): Promise<ValueMatch[]> {
  const phrases = questionPhrases(question)
  if (phrases.length === 0) return []
  const limit = options.limit ?? VALUE_TOP_K
  const threshold = options.threshold ?? VALUE_SIMILARITY_THRESHOLD

  const client = await getAppPool().connect()
  let rows: unknown[]
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('pg_trgm.similarity_threshold', $1, true)", [String(threshold)])
    const result = await client.query(LOOKUP_SQL, [phrases, limit])
    await client.query('COMMIT')
    rows = result.rows
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return z.array(matchRow).parse(rows).map((r) => ({
    schema: r.schema_name,
    table: r.table_name,
    column: r.column_name,
    value: r.value,
    phrase: r.phrase,
    similarity: r.similarity,
  }))
}
