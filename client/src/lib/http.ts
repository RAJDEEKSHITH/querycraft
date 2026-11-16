import axios from 'axios'
import type { ErrorCode } from '../types/api'
import { isRecord } from './guards'

// The one axios instance (IMPLEMENTATION.md 15). Every failure is turned into an
// ApiError with the API's error shape, so views only ever handle one error type.

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/** API codes plus NETWORK_ERROR for "the server could not be reached". */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR'

const API_CODES: readonly ErrorCode[] = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'INVALID_STATE',
  'RATE_LIMITED',
  'BUDGET_EXCEEDED',
  'UPSTREAM_RATE_LIMITED',
  'INTERNAL_ERROR',
]

export class ApiError extends Error {
  readonly code: ClientErrorCode
  readonly status: number | null
  readonly details: Record<string, unknown>
  readonly retryAfterSeconds: number | null

  constructor(
    code: ClientErrorCode,
    message: string,
    options: { status?: number | null; details?: Record<string, unknown>; retryAfterSeconds?: number | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status ?? null
    this.details = options.details ?? {}
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (API_CODES as readonly string[]).includes(value)
}

function retryAfter(headers: unknown): number | null {
  if (!isRecord(headers)) return null
  const raw = headers['retry-after']
  const seconds = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

const FALLBACK_MESSAGES: Partial<Record<number, string>> = {
  429: 'Too many requests. Please wait a moment and try again.',
  503: 'The service is temporarily unavailable.',
}

/** Converts anything axios (or other code) throws into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (axios.isAxiosError(err)) {
    const response = err.response
    if (response === undefined) {
      return new ApiError('NETWORK_ERROR', 'Cannot reach the QueryCraft server. Is it running?')
    }
    const data: unknown = response.data
    const body = isRecord(data) && isRecord(data['error']) ? data['error'] : null
    const seconds = retryAfter(response.headers)
    if (body !== null && isErrorCode(body['code']) && typeof body['message'] === 'string') {
      return new ApiError(body['code'], body['message'], {
        status: response.status,
        details: isRecord(body['details']) ? body['details'] : {},
        retryAfterSeconds: seconds,
      })
    }
    const code: ErrorCode = response.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR'
    return new ApiError(code, FALLBACK_MESSAGES[response.status] ?? 'Unexpected response from the server.', {
      status: response.status,
      retryAfterSeconds: seconds,
    })
  }
  return new ApiError('INTERNAL_ERROR', 'Something went wrong in the client.')
}

export const http = axios.create({ baseURL: `${API_BASE_URL}/api`, timeout: 30_000 })

http.interceptors.response.use(
  (response) => response,
  (err: unknown) => Promise.reject(toApiError(err)),
)

/** A short user-facing text for an error, including the wait time when the server gave one. */
export function errorText(err: unknown): string {
  const e = toApiError(err)
  return e.retryAfterSeconds === null ? e.message : `${e.message} (retry in ${Math.ceil(e.retryAfterSeconds)} s)`
}
