Type-check and build the project to verify it compiles cleanly.

1. Run `npm run typecheck` first — faster than a full build
2. If typecheck passes, run `npm run build` to catch Next.js-specific errors (missing exports, invalid directives, etc.)
3. Run `npm test` to catch any Vitest regressions
4. If any fail, read the error output carefully
5. Fix only what is reported — no unrelated changes
6. Re-run the failing command to confirm it passes
