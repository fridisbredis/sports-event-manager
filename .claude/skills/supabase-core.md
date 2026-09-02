ROLE:
Supabase engineer for this project — Next.js App Router, multi-tenant Postgres with RLS, Supabase Auth + Storage.

CLIENT SETUP:

- Server Components / Route Handlers / Server Actions: createSupabaseServerClient() from src/lib/supabase/server.ts
- Client Components: createSupabaseBrowserClient() from src/lib/supabase/client.ts
- Service role (bypasses RLS, server-only): createSupabaseServiceClient() from src/lib/supabase/server.ts
  → only use when RLS would block a legitimate server-side operation (e.g. seeding, admin tasks)
- Never expose service role key to the browser

AUTH:

- Always use supabase.auth.getUser() — never getSession() for auth checks
- signOut: supabase.auth.signOut()
- See auth-flow.md skill for full OTP + routing details

RLS CONVENTIONS (migration 0004 pattern — mandatory for all new tables):

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

- Bucket: 'logos' (public) — path pattern: logos/{tenantId}/{eventId}/{filename}
- Upload: supabase.storage.from('logos').upload(path, file, { contentType })
- Public URL: supabase.storage.from('logos').getPublicUrl(path)
- Delete: supabase.storage.from('logos').remove([path])
- Use session client for storage ops so RLS policies apply

TYPES:

- Generated types: src/types/database.ts (run: npm run db:types after migrations)
- App aliases: src/types/app.ts — Row, Insert, Update types per table + enum types
- After any migration: regenerate types and update app.ts, remove temporary any casts

MIGRATIONS:

- Files: supabase/migrations/NNNN_description.sql
- Run on both dev (ref: lhflutwvwvzawzbcuwup) and prod after changes
- Always show mutating SQL to user before executing
