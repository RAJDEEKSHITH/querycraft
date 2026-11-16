import type { RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { AppError } from '../../lib/errors.js'

// Per-IP limit on the question and resume endpoints (IMPLEMENTATION.md 13.5,
// RATE_LIMIT_PER_MINUTE). In-memory and per app instance (D16); the client IP
// honours TRUST_PROXY through Express's `trust proxy` setting.

export function questionRateLimit(perMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests. Please wait a minute and try again.'))
    },
  })
}
