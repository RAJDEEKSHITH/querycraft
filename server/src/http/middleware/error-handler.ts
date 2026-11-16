import type { NextFunction, Request, Response } from 'express'
import { AppError, toAppError, toErrorBody } from '../../lib/errors.js'

/** Unknown routes become a NOT_FOUND AppError. */
export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', 'Route not found'))
}

/**
 * Central error handler. Clients receive only the safe code and message; the
 * internal cause of server errors is logged with the request id.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err)
    return
  }
  const appError = toAppError(err)
  if (appError.status >= 500) {
    req.log.error({ err: appError.cause ?? appError }, 'request failed')
  }
  const retryAfter = appError.details['retryAfterSeconds']
  if (appError.code === 'UPSTREAM_RATE_LIMITED' && typeof retryAfter === 'number' && retryAfter > 0) {
    res.set('Retry-After', String(Math.ceil(retryAfter)))
  }
  res.status(appError.status).json(toErrorBody(appError))
}
