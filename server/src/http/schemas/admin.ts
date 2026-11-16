import { z } from 'zod'
import { auditDecision, exampleStatus } from '../../db/schema.js'
import { AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX } from '../../services/audit.service.js'

// Request schemas for the admin endpoints (IMPLEMENTATION.md 14.2).

const id = z.uuid()
const text = (max: number): z.ZodString => z.string().trim().min(1).max(max)
const SQL_MAX = 10_000

export const idParams = z.object({ params: z.object({ id }) })

export const listExamplesInput = z.object({
  query: z.strictObject({ status: z.enum(exampleStatus.enumValues).optional() }),
})

export const createExampleInput = z.object({
  body: z.strictObject({ question: text(1000), sql: text(SQL_MAX) }),
})

export const updateExampleInput = z.object({
  params: z.object({ id }),
  body: z
    .strictObject({ question: text(1000).optional(), sql: text(SQL_MAX).optional(), status: z.enum(exampleStatus.enumValues).optional() })
    .refine((b) => Object.keys(b).length > 0, 'nothing to change'),
})

export const updateTableInput = z.object({
  params: z.object({ id }),
  body: z.strictObject({ description: text(2000) }),
})

export const createGlossaryInput = z.object({
  body: z.strictObject({ term: text(100), definition: text(1000), sqlHint: text(1000).nullable().optional() }),
})

export const updateGlossaryInput = z.object({
  params: z.object({ id }),
  body: z
    .strictObject({ term: text(100).optional(), definition: text(1000).optional(), sqlHint: text(1000).nullable().optional() })
    .refine((b) => Object.keys(b).length > 0, 'nothing to change'),
})

export const auditInput = z.object({
  query: z.strictObject({
    decision: z.enum(auditDecision.enumValues).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
    before: id.optional(),
  }),
})

/** Endpoints without params, query or body. */
export const noInput = z.object({})
