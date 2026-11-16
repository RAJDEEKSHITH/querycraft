import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { ApiError, errorText, toApiError } from './http'

const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }

function axiosError(status: number | null, data: unknown, headers: Record<string, string> = {}): AxiosError {
  const response =
    status === null
      ? undefined
      : ({ status, statusText: '', data, headers, config } satisfies AxiosResponse<unknown>)
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, {}, response)
}

describe('toApiError', () => {
  it('keeps the API error shape', () => {
    const e = toApiError(axiosError(409, { error: { code: 'INVALID_STATE', message: 'Not waiting', details: { status: 'answered' } } }))
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ code: 'INVALID_STATE', message: 'Not waiting', status: 409, details: { status: 'answered' } })
  })

  it('reads Retry-After for provider and rate limits', () => {
    const e = toApiError(axiosError(503, { error: { code: 'UPSTREAM_RATE_LIMITED', message: 'busy', details: {} } }, { 'retry-after': '12' }))
    expect(e.retryAfterSeconds).toBe(12)
    expect(errorText(e)).toBe('busy (retry in 12 s)')
  })

  it('maps a 429 without the API shape to RATE_LIMITED', () => {
    expect(toApiError(axiosError(429, 'Too many')).code).toBe('RATE_LIMITED')
  })

  it('maps other unexpected bodies to INTERNAL_ERROR without echoing them', () => {
    const e = toApiError(axiosError(502, '<html>proxy error at 10.0.0.1</html>'))
    expect(e.code).toBe('INTERNAL_ERROR')
    expect(e.message).not.toContain('10.0.0.1')
  })

  it('rejects unknown codes in the body', () => {
    expect(toApiError(axiosError(400, { error: { code: 'SOMETHING', message: 'x', details: {} } })).code).toBe('INTERNAL_ERROR')
  })

  it('no response → NETWORK_ERROR', () => {
    expect(toApiError(axiosError(null, null)).code).toBe('NETWORK_ERROR')
  })

  it('non-axios errors become a generic client error; ApiErrors pass through', () => {
    expect(toApiError(new TypeError('boom')).message).not.toContain('boom')
    const original = new ApiError('NOT_FOUND', 'Question not found')
    expect(toApiError(original)).toBe(original)
  })
})
