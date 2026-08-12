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
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
