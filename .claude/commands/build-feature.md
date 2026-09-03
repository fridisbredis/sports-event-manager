Context:
@context.md
@skills/supabase-core.md
@skills/auth-flow.md
@skills/ui-system.md

Task:
Build feature:
{{description}}

Existing code:
{{selection}}

Rules:

- Follow existing project patterns (Server Components by default, Server Actions for mutations)
- Admin screens: web-first. Official/participant screens: mobile-first
- All UI strings through t() — add keys to public/locales/en/ as needed
- No theme.ts — use Tailwind utility classes directly, consistent with existing components
- Don't add features beyond what was asked for

Process:

1. Analyze the feature request
2. Ask clarifying questions if anything is unclear
3. Propose a short implementation plan (steps + affected files)
4. Wait for approval before writing code
5. Implement step-by-step with minimal changes
6. If DB changes needed: write migration, show SQL, wait for approval before executing
7. Write Vitest tests for any new non-trivial logic (see Tests below)
8. Run `npm test` and fix any failures before considering the feature done

Screen IDs (use in commit messages):
EVT-01/02, WS-01/02, OFF-01, SCHED-01, COMM-01, ACCT-01, AUTH-01/02,
HOME-01, INFO-01, MYSCH-01, ANN-01, SYS-01/02

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
