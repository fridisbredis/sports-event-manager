ROLE:
Supabase engineer for this project — Next.js App Router, multi-tenant Postgres with RLS, Supabase Auth + Storage.

CLIENT SETUP:

- Server Components / Route Handlers / Server Actions: createSupabaseServerClient() from src/lib/supabase/server.ts
- Client Components: createSupabaseBrowserClient() from src/lib/supabase/client.ts
- Service role (bypasses RLS, server-only): createSupabaseServiceClient() from src/lib/supabase/server.ts
  → last resort only. Default to the RLS-bound server client so the database
  enforces tenant isolation; reach for service role only when RLS genuinely
  blocks a legitimate server-side operation (seeding, cron/worker jobs,
  cross-tenant system-admin tasks), and say why in a comment.
  → note auth.uid() is NULL under service_role, so policies and functions that
  depend on it behave differently than in a user session
- Never expose service role key to the browser

AUTH:

- Always use supabase.auth.getUser() — never getSession() for auth checks
- signOut: supabase.auth.signOut()
- See auth-flow.md skill for full OTP + routing details

RLS CONVENTIONS (migration 0004 pattern — mandatory for all new tables):

- A DELETE policy is not enough on its own: without a SELECT policy making the
  row visible, the delete silently affects nothing

- Admin write: USING (get_user_role(tenant_id) = 'tenant_admin' OR is_system_admin())
- Member read: USING (get_user_role(tenant_id) IS NOT NULL OR is_system_admin())
- is_system_admin() clause is required — without it system admins lose access
- Never use IN ('tenant_admin', 'system_admin') lists — obsolete pattern from 0003/pre-fix 0005
- Use DROP POLICY IF EXISTS + CREATE POLICY for defensive re-runs

TENANT ISOLATION:

- Every query on a tenant-scoped table must include .eq('tenant_id', tenantId)
- RLS enforces this at DB level, but route handlers also call hasAdminAccessToTenant() as defense in depth
- src/lib/auth/tenant.ts: requireTenantAdmin(tenantId), hasAdminAccessToTenant(userId, tenantId)

QUERYING:

- Prefer .select(), .insert(), .update(), .delete() with explicit column lists
- Use .eq(), .in(), .is() for filtering
- Avoid raw SQL in application code — use migrations or RPCs for complex logic
- RPC example: supabase.rpc('sync_event_stages', { p_event_id, p_tenant_id, p_stages })

STORAGE:

- Buckets: 'logos' (event/tenant logos) and 'avatars' (user profile images)
- Upload: supabase.storage.from(bucket).upload(path, file, { contentType })
- Public URL: supabase.storage.from(bucket).getPublicUrl(path)
- Delete: supabase.storage.from(bucket).remove([path])
- Use the session client for storage ops so RLS policies apply
- Reference usage: src/app/(tenant)/[tenantSlug]/admin/event/actions.ts (logos),
  src/lib/actions/avatar.ts (avatars)

TYPES:

- Generated types: src/types/database.ts (run: npm run db:types after migrations)
- Never overload an RPC (two signatures → PGRST203); `revoke from public` alone
  does not block anon/authenticated — revoke from those roles explicitly
- App aliases: src/types/app.ts — Row, Insert, Update types per table + enum types
- After any migration: regenerate types and update app.ts, remove temporary any casts

MIGRATIONS:

- Files: supabase/migrations/. Legacy ones use NNNN_description.sql and are
  never renumbered; new ones use the CLI's YYYYMMDDHHMMSS_description.sql
  (`supabase migration new <name>` — don't hand-pick a number)
- Every new migration needs a filled-in Forward-fix header (CI enforces the line)
- Run on both dev (ref: lhflutwvwvzawzbcuwup) and prod after changes
- `db push` matches on the number prefix: a colliding number is skipped SILENTLY
  with "up to date" — always verify against information_schema afterwards
- Always show mutating SQL to the user and wait for approval before executing
- Full mechanics, forward-fix format and data model: .claude/reference/migrations.md
