import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup-env.ts'],
    // Runs once before the whole suite (setupFiles runs per file) to
    // reclaim test phone numbers leaked by an earlier interrupted run —
    // see tests/integration/global-setup.ts for why that matters.
    globalSetup: ['./tests/integration/global-setup.ts'],
    globals: true,
    testTimeout: 20000,
    // Test files share one local Supabase/GoTrue instance and the fixed
    // test-OTP phone numbers — running files in parallel causes collisions.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
