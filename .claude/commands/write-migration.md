Context:
@context.md
@skills/supabase-core.md

Context:
- PostgreSQL via Supabase
- Migrations in supabase/migrations/ — numbered NNNN_description.sql (next: 0016)
- Existing production database — do NOT recreate schema, use ALTER TABLE
- RLS enabled on all tables
- Both dev (lhflutwvwvzawzbcuwup) and prod must receive the migration

Change request:
{{description}}

Optional context:
{{selection}}

Rules:
- Valid PostgreSQL only
- ALTER TABLE for existing tables, CREATE TABLE for new ones
- Never DROP columns or tables unless explicitly requested
- Use IF EXISTS / IF NOT EXISTS throughout
- Minimal change — only what was asked for

RLS rules (mandatory for new tables):
- ALTER TABLE ... ENABLE ROW LEVEL SECURITY
- Admin write policy: USING (public.get_user_role(tenant_id) = 'tenant_admin' OR public.is_system_admin())
- Member read policy: USING (public.get_user_role(tenant_id) IS NOT NULL OR public.is_system_admin())
- Never use IN ('tenant_admin', 'system_admin') — use get_user_role() + is_system_admin() instead
- Use DROP POLICY IF EXISTS before CREATE POLICY

Schema conventions:
- All tenant-scoped tables have tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
- Primary keys: id uuid PRIMARY KEY DEFAULT gen_random_uuid()
- Timestamps: created_at timestamptz NOT NULL DEFAULT now()
- Roles: 'system_admin' | 'tenant_admin' | 'official' | 'participant'

After generating, remind user to:
1. Run npm run db:types to regenerate src/types/database.ts
2. Update src/types/app.ts with any new Row/Insert/Update aliases
3. Apply to both dev and prod Supabase projects

Output:
- SQL only
- No explanation
- No markdown fences
- Suggested filename: 0016_<short_description>.sql
