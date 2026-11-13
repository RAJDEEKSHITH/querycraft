// Error codes and HTTP statuses from the API contract (IMPLEMENTATION.md section 14).
export const errorStatus = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  BUDGET_EXCEEDED: 503,
} as const

export type ErrorCode = keyof typeof errorStatus

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> }
}

/**
 * The application's single error type. `message` and `details` are safe to send
 * to clients; `cause` is internal and only logged.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = errorStatus[code]
    this.details = options.details ?? {}
  }
}

/** Errors raised by Express's JSON body parser carry a string `type`. */
function bodyParserErrorType(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string') {
    return err.type
  }
  return undefined
}

/** Maps any thrown value to a safe AppError. Unknown errors never expose their message. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err
  }
  switch (bodyParserErrorType(err)) {
    case 'entity.too.large':
      return new AppError('VALIDATION_ERROR', 'Request body exceeds 10 kB', { cause: err })
    case 'entity.parse.failed':
      return new AppError('VALIDATION_ERROR', 'Request body is not valid JSON', { cause: err })
    case 'encoding.unsupported':
    case 'charset.unsupported':
    case 'request.size.invalid':
    case 'request.aborted':
    case 'stream.encoding.set':
    case 'stream.not.readable':
      return new AppError('VALIDATION_ERROR', 'Invalid request body', { cause: err })
    default:
      return new AppError('INTERNAL_ERROR', 'Internal server error', { cause: err })
  }
}

export function toErrorBody(err: AppError): ErrorBody {
  return { error: { code: err.code, message: err.message, details: err.details } }
}
