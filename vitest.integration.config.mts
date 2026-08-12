import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup-env.ts'],
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
