import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Forces the test database (src/db/app.ts refuses anything but querycraft_test).
    env: { NODE_ENV: 'test' },
    setupFiles: ['test/setup.ts'],
    // Database tests share querycraft_test and truncate its tables, so files run one at a time.
    fileParallelism: false,
  },
})
