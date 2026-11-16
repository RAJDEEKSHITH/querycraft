import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { isAdminToken } from '../../src/http/middleware/admin-auth.js'
import { errorHandler } from '../../src/http/middleware/error-handler.js'
import { requestLogger } from '../../src/http/middleware/request-logger.js'
import { AppError } from '../../src/lib/errors.js'
import { captureLogger } from '../helpers/log-capture.js'

describe('error handler: UPSTREAM_RATE_LIMITED', () => {
  function appThrowing(err: AppError): express.Express {
    const app = express()
    app.use(requestLogger(captureLogger().logger))
    app.get('/x', () => {
      throw err
    })
    app.use(errorHandler)
    return app
  }

  it('sends 503 with Retry-After when the provider gave a delay', async () => {
    const res = await request(appThrowing(new AppError('UPSTREAM_RATE_LIMITED', 'busy', { details: { retryAfterSeconds: 42 } }))).get('/x')
    expect(res.status).toBe(503)
    expect(res.headers['retry-after']).toBe('42')
    expect(res.body).toEqual({ error: { code: 'UPSTREAM_RATE_LIMITED', message: 'busy', details: { retryAfterSeconds: 42 } } })
  })

  it('sends no Retry-After without a delay, or for other errors', async () => {
    expect((await request(appThrowing(new AppError('UPSTREAM_RATE_LIMITED', 'busy'))).get('/x')).headers['retry-after']).toBeUndefined()
    const budget = await request(appThrowing(new AppError('BUDGET_EXCEEDED', 'cap', { details: { retryAfterSeconds: 5 } }))).get('/x')
    expect(budget.status).toBe(503)
    expect(budget.headers['retry-after']).toBeUndefined()
  })
})

describe('admin token comparison', () => {
  it('accepts only the exact token, whatever the length of the presented one', () => {
    const token = 'a-fake-admin-token-of-at-least-32-chars'
    expect(isAdminToken(token, token)).toBe(true)
    expect(isAdminToken(`${token}x`, token)).toBe(false)
    expect(isAdminToken(token.slice(0, -1), token)).toBe(false)
    expect(isAdminToken('', token)).toBe(false)
  })
})
