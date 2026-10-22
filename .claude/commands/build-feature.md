Context:
@context.md
@skills/supabase-core.md
@skills/auth-flow.md
@skills/ui-system.md

Plan first (before anything else):

- Call EnterPlanMode as the very first action of this command, before reading
  files or running anything. Don't skip it because the task looks small, and
  don't ask whether to plan — just enter.
- If plan mode is already active, this is a no-op. Entering twice is harmless;
  not entering is the failure mode this guards against.
- Then explore, and present the plan for approval via ExitPlanMode. No edits,
  migrations or commands that change state until the plan is approved.

Task:
Build feature:
{{description}}

Existing code:
{{selection}}

Rules:

- Follow existing project patterns (Server Components by default, Server Actions for mutations)
- Admin screens: web-first. Official/participant screens: mobile-first
- All UI strings through t() — add every new key to BOTH public/locales/en/ and public/locales/sv/ (a locale-parity test enforces this)
- No theme.ts — use Tailwind utility classes directly, consistent with existing components
- Don't add features beyond what was asked for

Process:

1. Analyze the feature request
2. Ask clarifying questions if anything is unclear
3. The plan (steps + affected files) goes through plan mode — see "Plan first" above
4. Implement step-by-step with minimal changes
5. If DB changes needed: write migration, show SQL, wait for approval before executing
6. Write Vitest tests for any new non-trivial logic (see Tests below)
7. Run `npm test` and `npm run format` on changed files before considering the feature done

Screen IDs (use in commit messages):
EVT-01/02, WS-01/02, OFF-01, SCHED-01, COMM-01, ACCT-01, AUTH-01/02,
HOME-01, INFO-01, MYSCH-01, ANN-01, SYS-01/02/03

Tests (Vitest):

- Co-locate as `<filename>.test.ts` next to the source file, following `src/lib/scheduling/grid-logic.test.ts` as the convention
- Test pure logic (calculations, validation, data shaping) directly — no mocking needed
- For components/hooks with logic beyond JSX rendering, use @testing-library/react
- `describe` blocks per function, `it` names as behavior statements ("flags X when Y"), not implementation details
- Skip tests for trivial passthrough JSX or Server Actions that are pure Supabase glue with no branching logic

Output:

- Working implementation
- Tests for new logic
- Short explanation per step
