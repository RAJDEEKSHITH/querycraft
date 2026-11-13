import './config/load-dotenv.js'
import { createApp } from './app.js'
import { formatInvalidEnvMessage, parseEnv } from './config/env.js'
import { closeAppPool } from './db/app.js'
import { createLogger } from './lib/logger.js'
import { closeReaderConnections } from './safety/executor.js'
import { recoverStaleRuns } from './services/question.service.js'

const parsed = parseEnv(process.env)
if (!parsed.ok) {
  // Names only, never values (IMPLEMENTATION.md section 19).
  console.error(formatInvalidEnvMessage(parsed.invalidNames))
  process.exit(1)
}

const env = parsed.env
const logger = createLogger(env.LOG_LEVEL)
const app = createApp({ logger, clientOrigin: env.CLIENT_ORIGIN, trustProxy: env.TRUST_PROXY })

// Questions left `running` by a previous process can never finish (IMPLEMENTATION.md 12.6).
recoverStaleRuns().then(
  (count) => {
    logger.info({ count }, 'stale question runs marked failed')
  },
  (err: unknown) => {
    logger.error({ err }, 'stale-run recovery failed')
  },
)

const server = app.listen(env.PORT, (err?: Error) => {
  if (err !== undefined) {
    logger.fatal({ err }, 'server failed to start')
    process.exit(1)
  }
  logger.info({ port: env.PORT }, 'server listening')
})

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down')
  server.close()
  await Promise.allSettled([closeAppPool(), closeReaderConnections()])
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal).catch((err: unknown) => {
      logger.error({ err }, 'shutdown failed')
      process.exitCode = 1
    })
  })
}
