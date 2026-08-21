Context:
@context.md
@skills/supabase-core.md
@skills/auth-flow.md

Review the current diff (uncommitted changes; if none, diff against main): {{selection}}

Run `git status` and `git diff` (and `git diff main...HEAD` if the working tree is clean) to see what changed before reviewing.

Focus on:
- Correctness bugs (wrong logic, off-by-one, null handling)
- Security issues: missing tenant_id checks, exposed service role key, RLS bypassed without reason, user_metadata used for auth decisions
- Next.js App Router misuse: client/server boundary violations, missing 'use client' / 'use server', getSession() instead of getUser()
- Supabase query issues: missing .eq('tenant_id', ...), wrong client (browser vs server), no error handling on DB writes
- i18n: hardcoded UI strings instead of t()
- TypeScript: any casts, missing types
- Migration hygiene: if a migration file changed, check it follows the 0004 RLS convention (tenant_admin_manage_<table> / tenant_member_read_<table> with the is_system_admin() OR clause) and that a SELECT policy exists before any DELETE policy
- Unit test coverage: non-trivial logic (calculations, branching, validation) missing a Vitest test, following `src/lib/scheduling/grid-logic.test.ts` as the convention
- Integration test coverage: changed route handlers or Server Actions missing a test that exercises tenant isolation (cross-tenant access should be denied) and the auth-required path (unauthenticated/wrong-role should be rejected)
- If DB schema changed: confirm `npm run db:types` was run and `src/types/app.ts` was updated to match (per the "After any DB migration" convention)

Skip:
- Style preferences
- Abstracting things that are only used once
- Comments explaining what the code does (only flag missing WHY comments)

Output:
- Bullet list of findings, most critical first
- For each: what the issue is, why it matters, suggested fix
- If nothing significant found, say so
