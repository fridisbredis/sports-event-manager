Context:
@context.md
@skills/supabase-core.md
@skills/auth-flow.md

Review this code:

{{selection}}

Focus on:
- Correctness bugs (wrong logic, off-by-one, null handling)
- Security issues: missing tenant_id checks, exposed service role key, RLS bypassed without reason, user_metadata used for auth decisions
- Next.js App Router misuse: client/server boundary violations, missing 'use client' / 'use server', getSession() instead of getUser()
- Supabase query issues: missing .eq('tenant_id', ...), wrong client (browser vs server), no error handling on DB writes
- i18n: hardcoded UI strings instead of t()
- TypeScript: any casts, missing types
- Test coverage: non-trivial logic (calculations, branching, validation) missing a Vitest test, following `src/lib/scheduling/grid-logic.test.ts` as the convention

Skip:
- Style preferences
- Abstracting things that are only used once
- Comments explaining what the code does (only flag missing WHY comments)

Output:
- Bullet list of findings, most critical first
- For each: what the issue is, why it matters, suggested fix
- If nothing significant found, say so
