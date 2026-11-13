import '../config/load-dotenv.js'
import { existsSync } from 'node:fs'
import { createGroqLlmClient } from '../agent/llm.js'
import { getEnv } from '../config/env.js'
import { closeAppPool } from '../db/app.js'
import { AppError } from '../lib/errors.js'
import { createLogger } from '../lib/logger.js'
import { draftMissingDescriptions } from './describe.js'
import {
  readSeedFile,
  schemaFileSchema,
  seedPath,
  tableDescriptionsFileSchema,
  writeSeedFile,
  type TableDescriptions,
} from './seed-files.js'

// `pnpm kb:describe`: drafts missing table descriptions into
// seed/table-descriptions.json for human editing. Uses Groq free-tier quota
// (approval required, CLAUDE.md section 11). Usage is recorded as source `app`.

async function main(): Promise<void> {
  try {
    const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
    const existing: TableDescriptions = existsSync(seedPath.tableDescriptions)
      ? await readSeedFile(seedPath.tableDescriptions, tableDescriptionsFileSchema)
      : {}
    const result = await draftMissingDescriptions(schema, existing, createGroqLlmClient({ logger: createLogger(getEnv().LOG_LEVEL) }), (descriptions) =>
      writeSeedFile(seedPath.tableDescriptions, descriptions),
    )
    console.log(`Drafted ${result.drafted} description(s); ${Object.keys(result.descriptions).length} in total.`)
    console.log('Review and edit seed/table-descriptions.json before running kb:index.')
  } finally {
    await closeAppPool()
  }
}

main().catch((err: unknown) => {
  const message = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : ''
  console.error(`kb:describe stopped. ${message} Drafts saved so far are kept; re-run to continue.`)
  process.exitCode = 1
})
