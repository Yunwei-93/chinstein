import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://chinstein_test:test-only-password@127.0.0.1:5433/chinstein_test',
      JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
      JWT_EXPIRES_IN: '1h',
    },
  },
})
