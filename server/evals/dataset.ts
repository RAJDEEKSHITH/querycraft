import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Evaluation datasets (IMPLEMENTATION.md 20.1): JSON Lines files in
// server/evals/dataset/, validated with Zod. Answerable items carry a gold SQL;
// the others carry the expected agent behaviour instead.

export const QUESTION_CATEGORIES = ['easy', 'medium', 'hard', 'ambiguous', 'unanswerable'] as const
export const ATTACK_CATEGORIES = ['write', 'forbidden_data', 'prompt_injection', 'resource_exhaustion', 'policy_evasion'] as const

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number]
export type AttackCategory = (typeof ATTACK_CATEGORIES)[number]

const id = z.string().regex(/^[a-z]\d{2}$/)
const question = z.string().trim().min(1)

const answerable = z.strictObject({
  id,
  category: z.enum(['easy', 'medium', 'hard']),
  question,
  goldSql: z.string().trim().min(1),
  expected: z.literal('answer'),
  orderMatters: z.boolean(),
})

const ambiguous = z.strictObject({
  id,
  category: z.literal('ambiguous'),
  question,
  expected: z.literal('clarify'),
  orderMatters: z.literal(false),
})

const unanswerable = z.strictObject({
  id,
  category: z.literal('unanswerable'),
  question,
  expected: z.literal('cannot_answer'),
  orderMatters: z.literal(false),
})

export const questionItemSchema = z.discriminatedUnion('category', [answerable, ambiguous, unanswerable])

export const attackItemSchema = z.strictObject({
  id,
  category: z.enum(ATTACK_CATEGORIES),
  question,
  expected: z.literal('blocked_or_refused'),
  orderMatters: z.literal(false),
})

export type QuestionItem = z.infer<typeof questionItemSchema>
export type AnswerableItem = z.infer<typeof answerable>
export type AttackItem = z.infer<typeof attackItemSchema>
export type EvalItem = QuestionItem | AttackItem

export type DatasetName = 'questions' | 'attacks'

export interface Dataset<T extends EvalItem = EvalItem> {
  name: DatasetName
  items: T[]
  /** sha256 of the file content; a resumed run must use the same dataset. */
  hash: string
}

export function datasetPath(name: DatasetName): string {
  return fileURLToPath(new URL(`./dataset/${name}.jsonl`, import.meta.url))
}

/** Parses JSON Lines; throws with the line number on the first invalid line or a duplicate id. */
export function parseJsonl<T extends EvalItem>(content: string, schema: z.ZodType<T>, label: string): T[] {
  const items: T[] = []
  const ids = new Set<string>()
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      throw new Error(`${label} line ${index + 1}: not valid JSON`)
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(`${label} line ${index + 1}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`)
    }
    if (ids.has(parsed.data.id)) throw new Error(`${label} line ${index + 1}: duplicate id ${parsed.data.id}`)
    ids.add(parsed.data.id)
    items.push(parsed.data)
  }
  return items
}

export async function loadQuestions(path = datasetPath('questions')): Promise<Dataset<QuestionItem>> {
  const content = await readFile(path, 'utf8')
  return { name: 'questions', items: parseJsonl(content, questionItemSchema, 'questions.jsonl'), hash: sha256(content) }
}

export async function loadAttacks(path = datasetPath('attacks')): Promise<Dataset<AttackItem>> {
  const content = await readFile(path, 'utf8')
  return { name: 'attacks', items: parseJsonl(content, attackItemSchema, 'attacks.jsonl'), hash: sha256(content) }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function isAnswerable(item: EvalItem): item is AnswerableItem {
  return 'goldSql' in item
}
