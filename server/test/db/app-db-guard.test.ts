import { describe, expect, it } from 'vitest'
import { resolveAppDatabaseUrl } from '../../src/db/app.js'

const appUrl = 'postgres://fake_user:fake_pw@localhost:5432/querycraft_app'
const testUrl = 'postgres://fake_user:fake_pw@localhost:5432/querycraft_test'

describe('app database URL resolution', () => {
  it('uses APP_DATABASE_URL outside tests', () => {
    expect(
      resolveAppDatabaseUrl({ NODE_ENV: 'development', APP_DATABASE_URL: appUrl, TEST_APP_DATABASE_URL: testUrl }),
    ).toBe(appUrl)
  })

  it('uses TEST_APP_DATABASE_URL under NODE_ENV=test', () => {
    expect(
      resolveAppDatabaseUrl({ NODE_ENV: 'test', APP_DATABASE_URL: appUrl, TEST_APP_DATABASE_URL: testUrl }),
    ).toBe(testUrl)
  })

  it('refuses any database other than querycraft_test under NODE_ENV=test', () => {
    expect(() =>
      resolveAppDatabaseUrl({ NODE_ENV: 'test', APP_DATABASE_URL: appUrl, TEST_APP_DATABASE_URL: appUrl }),
    ).toThrow('must be querycraft_test')
  })

  it('refuses a missing test URL under NODE_ENV=test', () => {
    expect(() =>
      resolveAppDatabaseUrl({ NODE_ENV: 'test', APP_DATABASE_URL: appUrl, TEST_APP_DATABASE_URL: undefined }),
    ).toThrow('TEST_APP_DATABASE_URL is required')
  })

  it('runs the test suite with NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })
})
