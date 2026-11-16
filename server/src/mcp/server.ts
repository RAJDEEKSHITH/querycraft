import './load-env.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { pino } from 'pino'
import { formatInvalidEnvMessage, parseEnv } from '../config/env.js'
import { closeAppPool } from '../db/app.js'
import { createLogger } from '../lib/logger.js'
import { closeReaderConnections } from '../safety/executor.js'
import { createQuestionDeps } from '../services/question.service.js'
import { createMcpServer } from './tools.js'

// MCP stdio server (IMPLEMENTATION.md 16, decision D21), started by an MCP client
// such as Claude Desktop: `node server/dist/mcp/server.js`. stdout carries the
// protocol, so logs go to stderr. Stale-run recovery stays with the HTTP server
// (it would mark the web app's running questions failed).

const parsed = parseEnv(process.env)
if (!parsed.ok) {
  // Names only, never values (IMPLEMENTATION.md section 19).
  console.error(formatInvalidEnvMessage(parsed.invalidNames))
  process.exit(1)
}

const logger = createLogger(parsed.env.LOG_LEVEL, pino.destination({ dest: 2, sync: true }))
const deps = await createQuestionDeps(logger).catch((err: unknown) => {
  logger.fatal({ err }, 'question runner setup failed (is the app database up?)')
  process.exit(1)
})

const server = createMcpServer(deps, logger)
let closing = false

async function shutdown(reason: string): Promise<void> {
  if (closing) return
  closing = true
  logger.info({ reason }, 'MCP server shutting down')
  await server.close().catch(() => undefined)
  await Promise.allSettled([closeAppPool(), closeReaderConnections()])
  process.exit(0)
}

server.server.onclose = () => {
  void shutdown('transport closed')
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
  })
}
// The client closing stdin ends the session.
process.stdin.once('end', () => {
  void shutdown('stdin closed')
})

await server.connect(new StdioServerTransport())
logger.info('MCP server ready on stdio')
