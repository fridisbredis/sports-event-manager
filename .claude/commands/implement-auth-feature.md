Context:
@context.md
@skills/auth-flow.md

Task:
Implement auth feature:
{{description}}

Code:
{{selection}}

Tests (Vitest):

- If the feature contains testable logic (role checks, redirect decisions, data shaping), add a test co-located as `<filename>.test.ts`, following `src/lib/scheduling/grid-logic.test.ts` as the convention
- Skip tests for logic that only manifests via live Supabase auth/Twilio flows — note that manual verification is required instead
- Run `npm test` to confirm

Output:

- Updated code
- Tests for new logic (or note on why one isn't feasible)
- Short explanation
