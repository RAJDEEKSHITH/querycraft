import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countMigrations } from '../../src/db/migrations.js'

// Regression: an empty server/drizzle folder (created by `drizzle-kit generate`
// with no schema changes) made db:migrate run the migrator with zero migrations.
describe('countMigrations', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qc-migrations-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns 0 for a missing folder', () => {
    expect(countMigrations(join(root, 'does-not-exist'))).toBe(0)
  })

  it('returns 0 for an empty folder', () => {
    expect(countMigrations(root)).toBe(0)
  })

  it('ignores subfolders without migration.sql and top-level files', () => {
    mkdirSync(join(root, '20261113000000_empty'))
    writeFileSync(join(root, 'notes.txt'), 'not a migration')
    expect(countMigrations(root)).toBe(0)
  })

  it('counts each subfolder that contains migration.sql', () => {
    for (const name of ['20261113000000_first', '20261114000000_second']) {
      mkdirSync(join(root, name))
      writeFileSync(join(root, name, 'migration.sql'), 'SELECT 1;')
    }
    expect(countMigrations(root)).toBe(2)
  })
})
