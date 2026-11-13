import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Number of generated Drizzle migrations: subfolders that contain migration.sql
 * (the layout drizzle-orm 1.0 reads). A missing or empty folder has none.
 */
export function countMigrations(folder: string): number {
  if (!existsSync(folder)) {
    return 0
  }
  return readdirSync(folder, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(join(folder, entry.name, 'migration.sql')),
  ).length
}
