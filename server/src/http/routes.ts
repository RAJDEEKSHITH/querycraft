import { Router, type RequestHandler } from 'express'
import type { AskContext } from '../services/ask.service.js'
import { adminHandlers } from './controllers/admin.controller.js'
import { getHealth } from './controllers/health.controller.js'
import { questionHandlers } from './controllers/questions.controller.js'
import { adminAuth } from './middleware/admin-auth.js'

// Routes of the API contract (IMPLEMENTATION.md 14). The rate limit covers the
// question and resume endpoints (13.5); admin routes need the admin token.

export function apiRouter(ctx: AskContext, rateLimit: RequestHandler): Router {
  const router = Router()
  const q = questionHandlers(ctx)
  const a = adminHandlers(ctx.deps.embeddings)

  router.get('/health', getHealth)

  router.post('/questions', rateLimit, q.create)
  router.get('/questions/:id/events', q.events)
  router.get('/questions/:id', q.get)
  router.post('/questions/:id/rerun', q.rerun)
  router.post('/questions/:id/clarification', rateLimit, q.clarification)
  router.post('/questions/:id/approval', rateLimit, q.approval)
  router.post('/questions/:id/feedback', q.feedback)
  router.get('/conversations/:id', q.conversation)

  const admin = Router()
  admin.use(adminAuth)
  admin.get('/examples', a.listExamples)
  admin.post('/examples', a.createExample)
  admin.patch('/examples/:id', a.updateExample)
  admin.get('/tables', a.listTables)
  admin.patch('/tables/:id', a.updateTable)
  admin.get('/glossary', a.listGlossary)
  admin.post('/glossary', a.createGlossary)
  admin.patch('/glossary/:id', a.updateGlossary)
  admin.delete('/glossary/:id', a.deleteGlossary)
  admin.post('/reindex', a.reindex)
  admin.get('/audit', a.audit)
  admin.get('/usage', a.usage)
  router.use('/admin', admin)

  return router
}
