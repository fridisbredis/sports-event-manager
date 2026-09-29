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
    //
    // .claude/worktrees/** holds git worktrees for in-flight branches. Their
    // src/ trees are ordinary test files, so vitest collected them alongside
    // ours and `npm test` reported another branch's failures as this one's —
    // '**/node_modules/**' does not cover them, it only skips files inside a
    // node_modules directory, not a sibling checkout that has one. Each
    // worktree is tested from its own root.
    exclude: ['**/node_modules/**', '.claude/worktrees/**', 'tests/integration/**', 'tests/e2e/**'],
    pool: 'threads',
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        '.claude/worktrees/**',
        'tests/integration/**',
        'tests/e2e/**',
        'scripts/**',
        'src/types/database.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
