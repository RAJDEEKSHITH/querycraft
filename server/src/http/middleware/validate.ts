import type { Request, RequestHandler, Response } from 'express'
import type { z } from 'zod'
import { AppError } from '../../lib/errors.js'

// Zod validation of params, query and body (IMPLEMENTATION.md 9.2). The schema
// describes `{ params, query, body }`; the handler receives only the parsed input.
// Error details name the invalid fields, never their values.

export function validated<S extends z.ZodType>(
  schema: S,
  handler: (input: z.output<S>, req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return async (req, res) => {
    // Express types the parsed JSON body as `any`; Zod decides what it is.
    const body: unknown = req.body
    const parsed = schema.safeParse({ params: req.params, query: req.query, body })
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.map(String).join('.')))]
      throw new AppError('VALIDATION_ERROR', 'Invalid request', { details: { fields } })
    }
    await handler(parsed.data, req, res)
  }
}
