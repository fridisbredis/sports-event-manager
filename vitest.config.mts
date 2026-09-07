import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    pool: 'threads',
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['tests/integration/**', 'scripts/**', 'src/types/database.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
