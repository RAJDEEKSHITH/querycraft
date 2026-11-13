import { createLogger, type Logger } from '../../src/lib/logger.js'

/** A real pino logger whose JSON lines are collected for assertions. */
export function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line)
    },
  })
  return { logger, lines }
}
