import { closeReaderPool, getReaderPool } from '../db/reader.js'

// Layer 4 executor (IMPLEMENTATION.md 13.3) is added in M1.
// M0 provides only a fixed connectivity check for GET /api/health; it runs no
// caller-provided SQL.

export async function pingReader(): Promise<void> {
  await getReaderPool().query('SELECT 1')
}

export async function closeReaderConnections(): Promise<void> {
  await closeReaderPool()
}
