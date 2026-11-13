import { pino, type DestinationStream, type Logger, type LevelWithSilent } from 'pino'

export type { Logger }

/**
 * JSON logger. Never log secrets, env values, connection strings, authorization
 * headers or result rows (IMPLEMENTATION.md section 18). Redaction is a safety
 * net; request serializers already omit headers.
 */
export function createLogger(level: LevelWithSilent, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[redacted]',
    },
  }
  return destination === undefined ? pino(options) : pino(options, destination)
}
