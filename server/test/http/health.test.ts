import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { closeAppPool } from '../../src/db/app.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { offlineQuestionDeps } from '../helpers/http.js'
import { captureLogger } from '../helpers/log-capture.js'

// Real databases from Docker Compose: querycraft_test (NODE_ENV=test) and adventureworks as qc_reader.
describe('GET /api/health (real databases)', () => {
  afterAll(async () => {
    await Promise.all([closeAppPool(), closeReaderConnections()])
  })

  it('reports both databases up', async () => {
    const { logger } = captureLogger()
    const app = createApp({ logger, clientOrigin: 'http://localhost:5173', trustProxy: 0, questionDeps: offlineQuestionDeps(), rateLimitPerMinute: 1000 })
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', appDb: 'up', readerDb: 'up' })
  })
})
