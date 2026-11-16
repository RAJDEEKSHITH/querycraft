import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { getEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'

// Admin endpoints need `Authorization: Bearer <ADMIN_TOKEN>` (IMPLEMENTATION.md
// 13.5, 14.2). Both sides are hashed to a fixed length first, so the constant-time
// comparison never depends on the length of the presented token.

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function isAdminToken(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected))
}

export function adminAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization') ?? ''
  const match = /^Bearer (\S+)$/.exec(header)
  if (match?.[1] === undefined || !isAdminToken(match[1], getEnv().ADMIN_TOKEN)) {
    next(new AppError('UNAUTHORIZED', 'Admin token missing or invalid'))
    return
  }
  next()
}
