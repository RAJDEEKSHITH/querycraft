import type { RequestHandler } from 'express'
import type { EmbeddingsClient } from '../../retrieval/embeddings.js'
import { listAuditEvents } from '../../services/audit.service.js'
import { createExample, listExamples, updateExample } from '../../services/examples.service.js'
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossary,
  listTables,
  reindex,
  updateGlossaryTerm,
  updateTableDescription,
} from '../../services/knowledge.service.js'
import { usageToday } from '../../services/usage.service.js'
import { validated } from '../middleware/validate.js'
import {
  auditInput,
  createExampleInput,
  createGlossaryInput,
  idParams,
  listExamplesInput,
  noInput,
  updateExampleInput,
  updateGlossaryInput,
  updateTableInput,
} from '../schemas/admin.js'

// Admin endpoints (IMPLEMENTATION.md 14.2), behind adminAuth in the router.

export type AdminHandlerName =
  | 'listExamples'
  | 'createExample'
  | 'updateExample'
  | 'listTables'
  | 'updateTable'
  | 'listGlossary'
  | 'createGlossary'
  | 'updateGlossary'
  | 'deleteGlossary'
  | 'reindex'
  | 'audit'
  | 'usage'

export function adminHandlers(embeddings: EmbeddingsClient): Record<AdminHandlerName, RequestHandler> {
  return {
    listExamples: validated(listExamplesInput, async ({ query }, _req, res) => {
      res.json({ examples: await listExamples(query.status) })
    }),
    createExample: validated(createExampleInput, async ({ body }, _req, res) => {
      res.status(201).json(await createExample(body))
    }),
    updateExample: validated(updateExampleInput, async ({ params, body }, _req, res) => {
      res.json(await updateExample(params.id, body))
    }),
    listTables: validated(noInput, async (_input, _req, res) => {
      res.json({ tables: await listTables() })
    }),
    updateTable: validated(updateTableInput, async ({ params, body }, _req, res) => {
      res.json(await updateTableDescription(params.id, body.description))
    }),
    listGlossary: validated(noInput, async (_input, _req, res) => {
      res.json({ terms: await listGlossary() })
    }),
    createGlossary: validated(createGlossaryInput, async ({ body }, _req, res) => {
      res.status(201).json(await createGlossaryTerm(body))
    }),
    updateGlossary: validated(updateGlossaryInput, async ({ params, body }, _req, res) => {
      res.json(await updateGlossaryTerm(params.id, body))
    }),
    deleteGlossary: validated(idParams, async ({ params }, _req, res) => {
      await deleteGlossaryTerm(params.id)
      res.status(204).end()
    }),
    reindex: validated(noInput, async (_input, _req, res) => {
      res.json(await reindex(embeddings))
    }),
    audit: validated(auditInput, async ({ query }, _req, res) => {
      res.json(await listAuditEvents(query))
    }),
    usage: validated(noInput, async (_input, _req, res) => {
      res.json(await usageToday())
    }),
  }
}
