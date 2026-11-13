import '../config/load-dotenv.js'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { formatInvalidEnvMessage, parseEnv } from '../config/env.js'
import { countMigrations } from './migrations.js'

// Applies Drizzle migrations to both app databases (CLAUDE.md section 9).
// Logs database names only, never connection strings.

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

async function migrateDatabase(name: string, url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder })
    console.log(`Migrations applied to ${name}`)
  } finally {
    await pool.end()
  }
}

async function main(): Promise<void> {
  const parsed = parseEnv(process.env)
  if (!parsed.ok) {
    throw new Error(formatInvalidEnvMessage(parsed.invalidNames))
  }
  const { APP_DATABASE_URL, TEST_APP_DATABASE_URL } = parsed.env
  if (TEST_APP_DATABASE_URL === undefined) {
    throw new Error(formatInvalidEnvMessage(['TEST_APP_DATABASE_URL']))
  }
  // Without migrations the migrator would still create its bookkeeping table,
  // so the databases are not touched at all.
  const count = countMigrations(migrationsFolder)
  if (count === 0) {
    console.log('No migrations generated yet in server/drizzle; nothing to apply.')
    return
  }
  console.log(`Found ${count} migration(s)`)
  await migrateDatabase('querycraft_app', APP_DATABASE_URL)
  await migrateDatabase('querycraft_test', TEST_APP_DATABASE_URL)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Migration failed')
  process.exitCode = 1
})
