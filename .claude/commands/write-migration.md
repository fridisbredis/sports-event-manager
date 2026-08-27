Context:
@context.md
@skills/supabase-core.md

Context:

- PostgreSQL via Supabase
- Migrations in supabase/migrations/ — numbered NNNN_description.sql (next: 0033)
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

Forward-fix header (mandatory — see .claude/CLAUDE.md "Forward-fix plan"):

- Every migration starts with a SQL comment header stating what it does and why
- The header MUST include a filled-in Forward-fix block:

```sql
-- Forward-fix: <additive | destructive | replace>
--   Rollback: <SQL or steps for a new migration that undoes this>
--   Data:     <can the data be recovered, and from where — or "no data loss">
--   Blast:    <what breaks in the app between the bad deploy and the fix>
--   Window:   <what happens to the CURRENTLY DEPLOYED code while this schema
--             is live but the new image is not — "compatible", or the
--             expand/contract split this needs>
```

- Pick exactly one class:

```text
additive    — new table / nullable-or-defaulted column / index / RPC.
              Rollback is a `drop ... if exists`; Data is "no data loss".
destructive — drop or rename a column, tighten a CHECK, backfill or
              UPDATE existing rows. Data MUST name where the original
              lives (PITR window, export file) or say "not recoverable".
replace     — changed RPC / RLS policy / trigger. Rollback is "restore the
              definition from migration 00MM", naming the file.
```

- Never leave a placeholder or a guess in these lines — an unfilled Data line
  on a destructive migration blocks the prod push
- Window is about the DEPLOY ORDER, not about a bad migration: schema is
  applied minutes before the new image (deploy-prod.yml step 1 vs step 4), so
  the migration must be backward-compatible with the code already running.
  A new mandatory column WITHOUT a default, or a rename/drop of a column any
  deployed page selects, is NOT safe in one release — split it expand/contract
  (first ship code that stops depending on the old shape, then the migration).
  See .claude/CLAUDE.md "The ordering guarantee".
- CI enforces that the `-- Forward-fix:` line exists; only a human reviewer can
  tell whether the Data line is true, so make it specific

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

1. Verify the Forward-fix block is filled in with real values, not placeholders
2. Run npm run db:types to regenerate src/types/database.ts
3. Update src/types/app.ts with any new Row/Insert/Update aliases
4. Apply to both dev and prod Supabase projects

Output:

- SQL only, starting with the comment header described above
- No prose outside the SQL comment header
- No markdown fences
- Suggested filename: 0033\_<short_description>.sql
