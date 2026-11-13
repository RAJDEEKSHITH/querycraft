import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { captureLogger } from '../helpers/log-capture.js'

// Database pings are mocked here to cover the degraded paths.
// test/http/health.test.ts covers the real databases.
const pings = vi.hoisted(() => ({
  app: vi.fn<() => Promise<void>>(),
  reader: vi.fn<() => Promise<void>>(),
}))
vi.mock('../../src/db/app.js', () => ({ pingAppDb: pings.app }))
vi.mock('../../src/safety/executor.js', () => ({ pingReader: pings.reader }))

function testApp(): { app: ReturnType<typeof createApp>; lines: string[] } {
  const { logger, lines } = captureLogger()
  return { app: createApp({ logger, clientOrigin: 'http://localhost:5173', trustProxy: 0 }), lines }
}

describe('GET /api/health (mocked databases)', () => {
  beforeEach(() => {
    pings.app.mockReset().mockResolvedValue(undefined)
    pings.reader.mockReset().mockResolvedValue(undefined)
  })

  it('returns 200 ok when both databases respond', async () => {
    const res = await request(testApp().app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', appDb: 'up', readerDb: 'up' })
  })

  it('returns 503 degraded when the reader database is down', async () => {
    pings.reader.mockRejectedValue(new Error('fake connection failure'))
    const res = await request(testApp().app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'degraded', appDb: 'up', readerDb: 'down' })
  })

  it('returns 503 degraded when the app database is down', async () => {
    pings.app.mockRejectedValue(new Error('fake connection failure'))
    const res = await request(testApp().app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'degraded', appDb: 'down', readerDb: 'up' })
  })

  it('logs failed checks by code only, without driver messages', async () => {
    const failure = Object.assign(new Error('fake-driver-message with fake-password'), { code: '28P01' })
    pings.app.mockRejectedValue(failure)
    pings.reader.mockRejectedValue(failure)
    const { app, lines } = testApp()
    const res = await request(app).get('/api/health')
    expect(res.body).toEqual({ status: 'degraded', appDb: 'down', readerDb: 'down' })
    const all = lines.join('\n')
    expect(all).toContain('28P01')
    expect(all).not.toContain('fake-driver-message')
    expect(all).not.toContain('fake-password')
  })
})
