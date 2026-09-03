Create a new Server Action file named $ARGUMENTS in `src/lib/actions/`.

This project uses Next.js Server Actions — not a services layer. Server Actions are the right pattern for server-side logic called from Client Components.

Conventions:

- Add 'use server' at the top of the file
- Export named async functions — one logical domain per file
- TypeScript — no `any`, define input/result interfaces
- Auth check first: createSupabaseServerClient() → getUser() → redirect('/login') if no user
- Tenant check second: hasAdminAccessToTenant(userId, tenantId) from src/lib/auth/tenant.ts
- Return { error?: string } on failure — never throw
- No error handling for scenarios that can't happen

Place the file at `src/lib/actions/$ARGUMENTS.ts`.

Example of an existing action for reference: src/lib/actions/publish-event.ts

Tests (Vitest):

- If the action contains non-trivial business logic (validation, data shaping, branching), extract it into a plain function and unit-test that directly — following `src/lib/scheduling/grid-logic.test.ts` as the convention
- Don't try to unit-test the Supabase/auth plumbing itself — mock the client if the logic can't be cleanly extracted, or skip if it's pure passthrough
