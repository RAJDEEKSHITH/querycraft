import '../config/load-dotenv.js'
import { closeReaderPool, getReaderPool } from '../db/reader.js'
import { introspectSchema } from './introspect.js'
import { seedPath, writeSeedFile } from './seed-files.js'

// `pnpm kb:introspect`: writes seed/schema.json. Free (no provider calls).

async function main(): Promise<void> {
  try {
    const schema = await introspectSchema(getReaderPool())
    await writeSeedFile(seedPath.schema, schema)
    const columns = schema.tables.reduce((sum, t) => sum + t.columns.length, 0)
    console.log(`Wrote seed/schema.json: ${schema.tables.length} tables, ${columns} columns`)
  } finally {
    await closeReaderPool()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'kb:introspect failed')
  process.exitCode = 1
})
