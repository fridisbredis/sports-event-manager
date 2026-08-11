Run ESLint and fix any issues found.

1. Run `npm run lint` and capture the output
2. Fix each reported issue in the relevant source files
3. Re-run `npm run lint` to confirm all issues are resolved
4. Run `npm run typecheck` to catch any TypeScript errors introduced during fixes
5. Only fix what lint/typecheck flags — don't refactor or clean up unrelated code
