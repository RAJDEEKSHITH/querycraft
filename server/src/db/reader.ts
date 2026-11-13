import { Pool } from 'pg'
import { getEnv } from '../config/env.js'

// Read-only pool as qc_reader on adventureworks.
// Only safety/executor.ts, safety/cost.ts and the knowledge-base scripts may import
// this module (IMPLEMENTATION.md 9.3 rule 1; enforced by test/architecture.test.ts).

// qc_reader has CONNECTION LIMIT 5; keep headroom for the knowledge-base scripts.
const READER_POOL_MAX = 3

let pool: Pool | undefined

export function getReaderPool(): Pool {
  pool ??= new Pool({
    connectionString: getEnv().READER_DATABASE_URL,
    max: READER_POOL_MAX,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

export async function closeReaderPool(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}
