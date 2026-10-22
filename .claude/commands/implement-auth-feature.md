Context:
@context.md
@skills/auth-flow.md

Plan first (before anything else):

- Call EnterPlanMode as the very first action of this command, before reading
  files or running anything. Don't skip it because the task looks small, and
  don't ask whether to plan — just enter.
- If plan mode is already active, this is a no-op. Entering twice is harmless;
  not entering is the failure mode this guards against.
- Then explore, and present the plan for approval via ExitPlanMode. No edits,
  migrations or commands that change state until the plan is approved.

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
