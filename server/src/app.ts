import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { errorHandler, notFound } from './http/middleware/error-handler.js'
import { questionRateLimit } from './http/middleware/rate-limit.js'
import { requestLogger } from './http/middleware/request-logger.js'
import { apiRouter } from './http/routes.js'
import type { Logger } from './lib/logger.js'
import { createQuestionEventBus } from './services/question-events.js'
import type { QuestionDeps } from './services/question.service.js'

export interface AppOptions {
  logger: Logger
  clientOrigin: string
  trustProxy: number
  /** LLM, embeddings and checkpointer for question runs (mocks in tests). */
  questionDeps: QuestionDeps
  rateLimitPerMinute: number
}

export function createApp({ logger, clientOrigin, trustProxy, questionDeps, rateLimitPerMinute }: AppOptions): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)

  app.use(requestLogger(logger))
  app.use(helmet())
  app.use(cors({ origin: clientOrigin }))
  app.use(express.json({ limit: '10kb' }))

  // One event bus and one rate-limit store per app instance (single instance, D16).
  const ask = { deps: questionDeps, bus: createQuestionEventBus() }
  app.use('/api', apiRouter(ask, questionRateLimit(rateLimitPerMinute)))

  app.use(notFound)
  app.use(errorHandler)
  return app
}
