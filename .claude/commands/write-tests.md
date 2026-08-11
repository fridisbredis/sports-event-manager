Write Vitest tests for: $ARGUMENTS

1. Read each target file to understand what it exports and what it depends on (Supabase clients, Next.js request/response, etc.)
2. Place the test file next to the source file, same name with `.test.ts` (or `.test.tsx` for components), matching the convention in `src/lib/scheduling/grid-logic.test.ts`
3. Test behavior, not implementation:
   - Cover the normal case, edge cases (empty input, boundary values), and any branching logic
   - For scheduling/capacity logic, mirror the style in `grid-logic.test.ts` — plain input objects in, assert on the returned value/Set/array
   - For Server Actions or route handlers, mock the Supabase client (browser or server, whichever the file uses) and assert on tenant_id filtering and error handling
   - For hooks, use `renderHook` from `@testing-library/react`
4. No comments unless the WHY of a test case is non-obvious (e.g. "regression for capacity off-by-one")
5. Run `npm test -- <path-to-new-test-file>` and fix failures until green
6. Don't touch unrelated existing tests or source files
