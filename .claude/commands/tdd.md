Context:
@context.md
@skills/supabase-core.md
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
Build this feature test-first (TDD):
{{description}}

Existing code:
{{selection}}

The rule that makes this TDD and not "tests afterwards": never write
implementation code while the test suite is green. Every piece of production
code must be preceded by a test that fails for the right reason.

Process:

1. Clarify the behavior. Restate the feature as a short list of observable
   behaviors ("rejects an assignment when the official is unconfirmed"). Ask
   before starting if any behavior is ambiguous — a vague behavior produces a
   vague test and TDD stops being useful.

2. Pick the first behavior. Smallest one that is still meaningful. One
   behavior per cycle, not the whole list.

3. RED — write the failing test first.
   - Co-locate as `<filename>.test.ts` next to the source, following
     `src/lib/scheduling/grid-logic.test.ts`
   - `describe` per function, `it` names as behavior statements
     ("flags X when Y"), not implementation details
   - No hardcoded date literals — the seed is relative to today, derive dates
     the way the seed does
   - Run `npm test -- <path>` and READ the failure. It must fail because the
     behavior is missing, not because of a typo, a bad import, or a missing
     mock. A test that errors out is not a red test — fix it until it fails
     on the assertion.

4. GREEN — the simplest implementation that passes.
   - Only enough code to satisfy the current test. Resist writing the next
     behavior's code because you can already see it coming; it will get its
     own cycle.
   - Run `npm test -- <path>` until green.

5. REFACTOR — clean up with the test as a safety net.
   - Extract, rename, deduplicate. Behavior must not change.
   - Re-run the test after each change. Green stays green.
   - If no cleanup is warranted, say so and move on. Don't invent refactors.

6. Repeat 2-5 for the next behavior until the list from step 1 is done.

7. Close out:
   - `npm test` (full suite, not just the new file)
   - `npm run format` on changed files
   - Report which behaviors got tests and which deliberately did not

What to drive with TDD, and what not to:

- Good fit: pure logic — capacity/scheduling rules, validation, data shaping,
  permission predicates, date and time handling
- Poor fit: JSX rendering, Server Actions that are pure Supabase glue with no
  branching. Don't force a cycle around these; build them normally and say why
- Supabase-dependent logic: extract the decision into a pure function, TDD
  that, and leave the query as thin glue around it. Mocking the client just to
  reach a branch usually means the branch belongs in its own function

Project rules still apply:

- Server Components by default, Server Actions for mutations
- Every tenant-scoped query filters on tenant_id; RLS is not the only guard
- All UI strings through t(), new keys in BOTH public/locales/en/ and
  public/locales/sv/ (locale-parity test enforces this)
- DB changes: write the migration, show the SQL, wait for approval before
  executing
- Don't add features beyond what was asked for

Output per cycle:

- The behavior being driven
- The failing test and its actual failure output
- The implementation that turned it green
- What was refactored, if anything
