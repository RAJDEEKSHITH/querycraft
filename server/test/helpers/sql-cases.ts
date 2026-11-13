import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { POLICY_RULES } from '../../src/safety/policy.js'

// SQL safety corpora (IMPLEMENTATION.md 21): server/test/sql-cases/*.json, validated on load.

const maliciousSchema = z.array(
  z.strictObject({ id: z.string().min(1), rule: z.enum(POLICY_RULES), sql: z.string() }),
)
const safeSchema = z.array(z.strictObject({ id: z.string().min(1), sql: z.string().min(1) }))

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../sql-cases/${name}`, import.meta.url), 'utf8'))
}

export type MaliciousCase = z.infer<typeof maliciousSchema>[number]
export type SafeCase = z.infer<typeof safeSchema>[number]

export function loadMaliciousCases(): MaliciousCase[] {
  return maliciousSchema.parse(readJson('malicious.json'))
}

export function loadSafeCases(): SafeCase[] {
  return safeSchema.parse(readJson('safe.json'))
}
