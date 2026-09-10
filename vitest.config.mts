import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // tests/e2e/** are Playwright specs run by `npm run test:e2e`. Vitest's
    // default include matches *.spec.ts, so without this it picks them up and
    // fails on `test.describe() called here` from Playwright's runner guard.
    exclude: ['**/node_modules/**', 'tests/integration/**', 'tests/e2e/**'],
    pool: 'threads',
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['tests/integration/**', 'tests/e2e/**', 'scripts/**', 'src/types/database.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
