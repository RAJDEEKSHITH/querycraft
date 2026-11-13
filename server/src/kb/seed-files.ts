import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Seed files in server/seed/ (IMPLEMENTATION.md 11.1). Every file is validated
// with Zod when read; files written by scripts are formatted deterministically.

export const SEED_DIR = fileURLToPath(new URL('../../seed/', import.meta.url))

export const seedPath = {
  schema: `${SEED_DIR}schema.json`,
  tableDescriptions: `${SEED_DIR}table-descriptions.json`,
  examples: `${SEED_DIR}examples.json`,
  glossary: `${SEED_DIR}glossary.json`,
  valueColumns: `${SEED_DIR}value-columns.json`,
} as const

const identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/)

export const kbColumnSchema = z.strictObject({
  name: identifier,
  type: z.string().min(1),
  nullable: z.boolean(),
  fk: z.strictObject({ schema: identifier, table: identifier, column: identifier }).nullable(),
  pii: z.enum(['email', 'phone']).nullable(),
  denied: z.boolean(),
})

export const introspectedTableSchema = z.strictObject({
  schema: identifier,
  table: identifier,
  /** The database's own table comment, used as input for kb:describe only. */
  comment: z.string().nullable(),
  columns: z.array(kbColumnSchema).min(1),
})

export const schemaFileSchema = z.strictObject({ tables: z.array(introspectedTableSchema) })

/** `{ "schema.table": "description" }`, edited by hand after kb:describe drafts it. */
export const tableDescriptionsFileSchema = z.record(z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/), z.string().min(1))

export const seedExampleSchema = z.strictObject({ question: z.string().min(1), sql: z.string().min(1) })
export const examplesFileSchema = z.array(seedExampleSchema)

export const glossaryEntrySchema = z.strictObject({
  term: z.string().min(1),
  definition: z.string().min(1),
  sqlHint: z.string().min(1).nullable(),
})
export const glossaryFileSchema = z.array(glossaryEntrySchema)

export const valueColumnSchema = z.strictObject({ schema: identifier, table: identifier, column: identifier })
export const valueColumnsFileSchema = z.array(valueColumnSchema)

export type IntrospectedTable = z.infer<typeof introspectedTableSchema>
export type SchemaFile = z.infer<typeof schemaFileSchema>
export type TableDescriptions = z.infer<typeof tableDescriptionsFileSchema>
export type SeedExample = z.infer<typeof seedExampleSchema>
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>
export type ValueColumn = z.infer<typeof valueColumnSchema>

/** Reads and validates a JSON seed file; the error names the file, not its content. */
export async function readSeedFile<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const text = await readFile(path, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON`, { cause: err })
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`${path} is invalid: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export async function writeSeedFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
