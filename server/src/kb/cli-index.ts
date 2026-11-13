import '../config/load-dotenv.js'
import { getEnv } from '../config/env.js'
import { closeAppPool } from '../db/app.js'
import { closeReaderPool, getReaderPool } from '../db/reader.js'
import { AppError } from '../lib/errors.js'
import { createLogger } from '../lib/logger.js'
import { createGeminiEmbeddingsClient } from '../retrieval/embeddings.js'
import { indexKnowledge } from '../retrieval/indexer.js'
import {
  examplesFileSchema,
  glossaryFileSchema,
  readSeedFile,
  schemaFileSchema,
  seedPath,
  tableDescriptionsFileSchema,
  valueColumnsFileSchema,
} from './seed-files.js'
import { loadColumnValues } from './values.js'

// `pnpm kb:index`: loads column values (free) and embeds tables, verified seed
// examples and glossary terms whose content changed (Gemini free-tier quota;
// approval required, CLAUDE.md section 11). Usage is recorded as source `app`.

async function main(): Promise<void> {
  try {
    const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
    const valueColumns = await readSeedFile(seedPath.valueColumns, valueColumnsFileSchema)
    const input = {
      schema,
      descriptions: await readSeedFile(seedPath.tableDescriptions, tableDescriptionsFileSchema),
      examples: await readSeedFile(seedPath.examples, examplesFileSchema),
      glossary: await readSeedFile(seedPath.glossary, glossaryFileSchema),
    }
    const values = await loadColumnValues(getReaderPool(), valueColumns, schema)
    console.log(`Column values: ${values.values} from ${values.columns} column(s)`)
    const stats = await indexKnowledge(input, createGeminiEmbeddingsClient({ logger: createLogger(getEnv().LOG_LEVEL) }))
    console.log(
      `Indexed ${stats.tables} tables, ${stats.examples} seed examples, ${stats.glossary} glossary terms; ` +
        `embedded ${stats.embedded} item(s); removed ${stats.deletedTables} table(s), ${stats.deletedSeedExamples} seed example(s).`,
    )
  } finally {
    await closeReaderPool()
    await closeAppPool()
  }
}

main().catch((err: unknown) => {
  const message = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : ''
  console.error(`kb:index stopped. ${message} Re-run to continue; unchanged items are not embedded again.`)
  process.exitCode = 1
})
