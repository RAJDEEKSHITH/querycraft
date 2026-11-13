import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// IMPLEMENTATION.md 9.3 rule 1: only safety/executor.ts, safety/cost.ts and the
// knowledge-base scripts (kb:introspect, kb:index) import db/reader.ts.
const ALLOWED_READER_IMPORTERS = ['safety/executor.ts', 'safety/cost.ts', 'kb/cli-introspect.ts', 'kb/cli-index.ts']

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
const readerModule = join(srcRoot, 'db', 'reader')

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/** Relative specifiers of static imports/exports, dynamic imports and require calls. */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ''))
}

function importsReader(file: string): boolean {
  return importSpecifiers(readFileSync(file, 'utf8'))
    .filter((specifier) => specifier.startsWith('.'))
    .some((specifier) => resolve(dirname(file), specifier).replace(/\.(js|ts)$/, '') === readerModule)
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

describe('architecture', () => {
  const files = listTsFiles(srcRoot)
  const readerImporters = files
    .filter((file) => importsReader(file))
    .map((file) => toPosix(relative(srcRoot, file)))
    .sort()

  it('detects reader imports (scanner self-check)', () => {
    expect(readerImporters).toContain('safety/executor.ts')
  })

  it('only allowed modules import db/reader.ts', () => {
    const violations = readerImporters.filter((file) => !ALLOWED_READER_IMPORTERS.includes(file))
    expect(violations).toEqual([])
  })

  it('recognises every import form', () => {
    const sample = [
      "import { a } from '../db/reader.js'",
      "import type { B } from '../db/reader.js'",
      "export { c } from '../db/reader.js'",
      "import '../db/reader.js'",
      "await import('../db/reader.js')",
      "require('../db/reader.js')",
    ].join('\n')
    expect(importSpecifiers(sample)).toEqual(Array(6).fill('../db/reader.js'))
  })
})
