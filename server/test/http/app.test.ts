import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { errorHandler } from '../../src/http/middleware/error-handler.js'
import { requestLogger } from '../../src/http/middleware/request-logger.js'
import { captureLogger } from '../helpers/log-capture.js'

const clientOrigin = 'http://localhost:5173'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function testApp(): { app: ReturnType<typeof createApp>; lines: string[] } {
  const { logger, lines } = captureLogger()
  return { app: createApp({ logger, clientOrigin, trustProxy: 0 }), lines }
}

describe('Express app (no database)', () => {
  it('returns NOT_FOUND in the contract shape for unknown routes', async () => {
    const res = await request(testApp().app).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found', details: {} } })
  })

  it('sets a server-generated request id on every response', async () => {
    const { app } = testApp()
    const first = await request(app).get('/api/x').set('X-Request-Id', 'client-chosen-id')
    const second = await request(app).get('/api/x')
    expect(first.headers['x-request-id']).toMatch(uuidPattern)
    expect(second.headers['x-request-id']).toMatch(uuidPattern)
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id'])
  })

  it('sets security headers and hides the framework', async () => {
    const res = await request(testApp().app).get('/api/x')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toBeDefined()
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('allows only CLIENT_ORIGIN for CORS', async () => {
    const { app } = testApp()
    const allowed = await request(app).get('/api/x').set('Origin', clientOrigin)
    const other = await request(app).get('/api/x').set('Origin', 'https://evil.example')
    expect(allowed.headers['access-control-allow-origin']).toBe(clientOrigin)
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example')
  })

  it('rejects malformed JSON with VALIDATION_ERROR', async () => {
    const res = await request(testApp().app)
      .post('/api/x')
      .set('Content-Type', 'application/json')
      .send('{"question": ')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON', details: {} },
    })
  })

  it('rejects bodies over 10 kB with VALIDATION_ERROR', async () => {
    const res = await request(testApp().app)
      .post('/api/x')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ question: 'a'.repeat(11 * 1024) }))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', message: 'Request body exceeds 10 kB' } })
  })

  it('accepts a JSON body under 10 kB (then routes normally)', async () => {
    const res = await request(testApp().app)
      .post('/api/x')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ question: 'a'.repeat(9 * 1024) }))
    expect(res.status).toBe(404)
  })

  it('logs id, method, path and status, but no headers or query strings', async () => {
    const { app, lines } = testApp()
    const res = await request(app)
      .get('/api/x?token=fake-query-secret')
      .set('Authorization', 'Bearer fake-header-secret')
      .set('Cookie', 'session=fake-cookie-secret')
    const all = lines.join('\n')
    expect(all).not.toContain('fake-query-secret')
    expect(all).not.toContain('fake-header-secret')
    expect(all).not.toContain('fake-cookie-secret')
    const entry: unknown = JSON.parse(lines.at(-1) ?? '{}')
    expect(entry).toMatchObject({
      req: { id: res.headers['x-request-id'], method: 'GET', path: '/api/x' },
      res: { statusCode: 404 },
    })
  })
})

describe('error handler', () => {
  it('returns INTERNAL_ERROR for unknown errors without exposing internals', async () => {
    const { logger } = captureLogger()
    const app = express()
    app.use(requestLogger(logger))
    app.get('/boom', () => {
      throw new Error('relation "fake_secret_table" does not exist')
    })
    app.use(errorHandler)

    const res = await request(app).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} } })
    expect(res.text).not.toContain('fake_secret_table')
    expect(res.text).not.toContain('at ')
  })
})
