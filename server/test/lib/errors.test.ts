import { describe, expect, it } from 'vitest'
import { AppError, errorStatus, toAppError, toErrorBody } from '../../src/lib/errors.js'

describe('AppError', () => {
  it('derives the HTTP status from the contract code', () => {
    expect(new AppError('VALIDATION_ERROR', 'x').status).toBe(400)
    expect(new AppError('UNAUTHORIZED', 'x').status).toBe(401)
    expect(new AppError('NOT_FOUND', 'x').status).toBe(404)
    expect(new AppError('INVALID_STATE', 'x').status).toBe(409)
    expect(new AppError('RATE_LIMITED', 'x').status).toBe(429)
    expect(new AppError('INTERNAL_ERROR', 'x').status).toBe(500)
    expect(new AppError('BUDGET_EXCEEDED', 'x').status).toBe(503)
    expect(new AppError('UPSTREAM_RATE_LIMITED', 'x').status).toBe(503)
    // Exactly the codes of the API contract (IMPLEMENTATION.md section 14).
    expect(Object.keys(errorStatus).sort()).toEqual([
      'BUDGET_EXCEEDED',
      'INTERNAL_ERROR',
      'INVALID_STATE',
      'NOT_FOUND',
      'RATE_LIMITED',
      'UNAUTHORIZED',
      'UPSTREAM_RATE_LIMITED',
      'VALIDATION_ERROR',
    ])
  })

  it('serialises to the contract error shape without the cause', () => {
    const err = new AppError('INVALID_STATE', 'Not awaiting approval', {
      details: { status: 'answered' },
      cause: new Error('internal detail'),
    })
    expect(toErrorBody(err)).toEqual({
      error: { code: 'INVALID_STATE', message: 'Not awaiting approval', details: { status: 'answered' } },
    })
    expect(JSON.stringify(toErrorBody(err))).not.toContain('internal detail')
  })

  it('defaults details to an empty object', () => {
    expect(toErrorBody(new AppError('NOT_FOUND', 'Route not found')).error.details).toEqual({})
  })
})

describe('toAppError', () => {
  it('returns AppErrors unchanged', () => {
    const err = new AppError('UNAUTHORIZED', 'Missing token')
    expect(toAppError(err)).toBe(err)
  })

  it('maps body-parser size and parse errors to VALIDATION_ERROR', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large' })
    const badJson = Object.assign(new Error('Unexpected token'), { type: 'entity.parse.failed' })
    const badCharset = Object.assign(new Error('unsupported charset'), { type: 'charset.unsupported' })
    expect(toAppError(tooLarge)).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Request body exceeds 10 kB' })
    expect(toAppError(badJson)).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' })
    expect(toAppError(badCharset)).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid request body' })
  })

  it('maps unknown errors to INTERNAL_ERROR without exposing their message', () => {
    const raw = new Error('relation "secret_table" does not exist')
    const mapped = toAppError(raw)
    expect(mapped).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, message: 'Internal server error' })
    expect(mapped.cause).toBe(raw)
    expect(JSON.stringify(toErrorBody(mapped))).not.toContain('secret_table')
  })

  it('maps non-Error throwables to INTERNAL_ERROR', () => {
    expect(toAppError('a string').code).toBe('INTERNAL_ERROR')
    expect(toAppError(null).code).toBe('INTERNAL_ERROR')
    expect(toAppError({ type: 42 }).code).toBe('INTERNAL_ERROR')
  })
})
