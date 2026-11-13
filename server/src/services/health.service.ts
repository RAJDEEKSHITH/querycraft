import { pingAppDb } from '../db/app.js'
import type { Logger } from '../lib/logger.js'
import { pingReader } from '../safety/executor.js'

export type DatabaseStatus = 'up' | 'down'

export interface HealthReport {
  status: 'ok' | 'degraded'
  appDb: DatabaseStatus
  readerDb: DatabaseStatus
}

async function check(name: string, ping: () => Promise<void>, logger: Logger): Promise<DatabaseStatus> {
  try {
    await ping()
    return 'up'
  } catch (err: unknown) {
    // Error code/name only: driver messages are not needed to diagnose reachability.
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
    logger.warn({ database: name, code, errorName: err instanceof Error ? err.name : undefined }, 'database health check failed')
    return 'down'
  }
}

/** Checks both databases (IMPLEMENTATION.md 14.1). */
export async function checkHealth(logger: Logger): Promise<HealthReport> {
  const [appDb, readerDb] = await Promise.all([
    check('app', pingAppDb, logger),
    check('reader', pingReader, logger),
  ])
  return { status: appDb === 'up' && readerDb === 'up' ? 'ok' : 'degraded', appDb, readerDb }
}
