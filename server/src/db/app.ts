import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv, type Env } from '../config/env.js'

const TEST_DATABASE_NAME = 'querycraft_test'

type AppDbEnv = Pick<Env, 'NODE_ENV' | 'APP_DATABASE_URL' | 'TEST_APP_DATABASE_URL'>

/**
 * App database URL. Under NODE_ENV=test this is TEST_APP_DATABASE_URL and must
 * point at querycraft_test, so tests can never touch querycraft_app.
 */
export function resolveAppDatabaseUrl(env: AppDbEnv): string {
  if (env.NODE_ENV !== 'test') {
    return env.APP_DATABASE_URL
  }
  const url = env.TEST_APP_DATABASE_URL
  if (url === undefined) {
    throw new Error('TEST_APP_DATABASE_URL is required when NODE_ENV=test')
  }
  if (new URL(url).pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new Error(`Under NODE_ENV=test the app database must be ${TEST_DATABASE_NAME}`)
  }
  return url
}

let pool: Pool | undefined
let db: NodePgDatabase | undefined

export function getAppPool(): Pool {
  pool ??= new Pool({
    connectionString: resolveAppDatabaseUrl(getEnv()),
    max: 10,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

export function getAppDb(): NodePgDatabase {
  db ??= drizzle({ client: getAppPool() })
  return db
}

/** Fixed connectivity check for the health endpoint. */
export async function pingAppDb(): Promise<void> {
  await getAppPool().query('SELECT 1')
}

export async function closeAppPool(): Promise<void> {
  const current = pool
  pool = undefined
  db = undefined
  await current?.end()
}
