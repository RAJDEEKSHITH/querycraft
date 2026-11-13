import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { errorHandler, notFound } from './http/middleware/error-handler.js'
import { requestLogger } from './http/middleware/request-logger.js'
import { apiRouter } from './http/routes.js'
import type { Logger } from './lib/logger.js'

export interface AppOptions {
  logger: Logger
  clientOrigin: string
  trustProxy: number
}

export function createApp({ logger, clientOrigin, trustProxy }: AppOptions): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)

  app.use(requestLogger(logger))
  app.use(helmet())
  app.use(cors({ origin: clientOrigin }))
  app.use(express.json({ limit: '10kb' }))

  app.use('/api', apiRouter())

  app.use(notFound)
  app.use(errorHandler)
  return app
}
