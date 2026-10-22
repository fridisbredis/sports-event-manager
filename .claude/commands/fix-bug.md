Context:
@context.md
@skills/supabase-core.md
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
Fix the bug.

Code:
{{selection}}

Error:
{{error}}

Expected:
{{expected}}

Rules:

- Find root cause — don't patch symptoms
- Fix with minimal changes
- Do not rewrite unrelated code
- Add a Vitest regression test that reproduces the bug (co-located `<filename>.test.ts`, following `src/lib/scheduling/grid-logic.test.ts` as the convention) — it should fail before the fix and pass after
- If the bug lives in code that can't reasonably be unit-tested (e.g. Twilio delivery, live Supabase auth), say so instead of forcing a test
- Run `npm test` to confirm the new test passes and nothing else broke

Common root causes in this project:

- Missing tenant_id check in route handler or query
- Wrong Supabase client (browser client used in Server Component or vice versa)
- getSession() used instead of getUser()
- RLS blocking a query because is_system_admin() is missing from policy
- i18n key missing in public/locales/en/ or public/locales/sv/ (both must have it)
- Types out of sync — run npm run db:types if DB schema changed recently
- Azure deploy showing old version — image tagged with 'latest' instead of git SHA
