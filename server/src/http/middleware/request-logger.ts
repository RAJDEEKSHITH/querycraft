import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pinoHttp, type HttpLogger } from 'pino-http'
import type { Logger } from '../../lib/logger.js'

/**
 * Assigns every request a server-generated id (returned as X-Request-Id) and logs
 * one line per request: id, method, path (no query string), status, duration.
 * Headers, bodies and query strings are never logged (IMPLEMENTATION.md section 18).
 */
export function requestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (_req: IncomingMessage, res: ServerResponse): string => {
      const id = randomUUID()
      res.setHeader('X-Request-Id', id)
      return id
    },
    serializers: {
      req: (req: { id: unknown; method: unknown; url: unknown }) => ({
        id: req.id,
        method: req.method,
        path: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
      }),
      res: (res: { statusCode: unknown }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => {
      if (err !== undefined || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
  })
}
