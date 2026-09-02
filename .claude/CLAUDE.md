# Sports Event Manager — Project Context for Claude

> This file is read automatically by Claude (VS Code extension and Claude Code CLI) to establish project context. Keep it up to date as the project evolves.

---

## Project overview

Multi-tenant sports event web platform. Each tenant is a sports organization or club. The platform handles event management, official assignments, participant management, and SMS-based announcements.

**Stakeholders:**

- **Frida Bredberg** — IT consultant at Extrapreneur AB, developer on this project
- **Peter Thorn** — project manager / customer
- **Deadline:** Viadal 2026
- As of 2026-09, **two** people work on this codebase in parallel (Frida and Eduardo; previously solo) — see "Workflow" below for how work is now coordinated. It was briefly three; the third has since left.

**Repo:** github.com/fridisbredis/sports-event-manager

---

## How Frida likes to work

- Prefers understanding over copy-paste. Explain the "why" alongside the "what."
- Incremental changes, one thing at a time. Don't batch up large rewrites.
- Background: Angular, React, SQL, some .NET. Newer to Next.js, Docker, and Azure.
- Comfortable in Swedish and English. Default to Swedish for conversation, English for code/comments.
- Uses VS Code with Claude extension and claude.ai in browser as complementary tools.
- Values aesthetics — clean, spacious, elegant design in UI work.

---

## Source documents

Peter has delivered a complete v1 specification in `docs/`. These are the source of truth — CLAUDE.md only summarizes.

- `docs/scope/problem-statement-mvp-scope.md` — MVP scope and decisions
- `docs/flows/*.md` — detailed flow per use case
- `docs/ia/screen-map.md` — all screens grouped by role
- `docs/screens/screen-documentation.md` — developer-ready screen specs (IDs, blocks, states)
- `docs/design/claude-design-prompt.md` — wireframe regeneration prompts
- `docs/wireframes/` — lo-fi grayscale wireframes from Claude Design. Layout-and-content reference only, NOT a visual design spec. Don't recreate the grayscale look in the real app.
- `docs/c4/level1-context.mermaid` and `docs/c4/level2-container.mermaid` — architecture diagrams

### Screen IDs

Use IDs from `screen-documentation.md` in commits and branches:
SYS-01/02, EVT-01/02, WS-01/02, OFF-01, SCHED-01, COMM-01, ACCT-01, AUTH-01/02, HOME-01, INFO-01, MYSCH-01, ANN-01.

Example: `feat(EVT-01): scaffold event dashboard`

### Key implementation rules

- **UI delivery:** one responsive codebase. Admin screens are web-first; official/participant screens are mobile-first.
- **SCHED-01:** edit-on-desktop, view-only on mobile. MYSCH-01 is a separate mobile component.
- **Capacity:** "up to X" ceiling. Below normal, over warns, outside operating window is hard-blocked (UI level).
- **Schedulability:** only Confirmed officials are schedulable. Admin is always schedulable.
- **Checklists:** informational only in v1, no completion tracking.
- **Feature tier:** single-select (one of standard/premium/professional per tenant).

---

## Stack

- **Framework:** Next.js 16 App Router
- **UI:** React 19, TypeScript, Tailwind (via Next.js defaults)
- **Auth + DB:** Supabase — Auth (Phone/SMS OTP), Postgres with RLS, Storage
- **SMS provider:** Twilio
- **Validation:** Zod
- **Infra:** Docker, Azure Container Apps, Azure Container Registry
- **CI/CD:** GitHub Actions
- **Secrets:** GitHub repository secrets, 1Password for personal backup

---

## Infrastructure

### Azure subscription

- Subscription ID: `dc64af83-c062-48db-abae-4cb73a478bb2`
- Region: `swedencentral`
- Shared Container Apps Environment: `kanban-env` in `kanban-app-rg` (free tier allows 1 env per region per subscription, so dev and prod Container Apps both use this same environment)

### Dev environment

- Resource group: `sports-event-manager-dev-rg`
- ACR: `sportsevtmgrdev` (`sportsevtmgrdev.azurecr.io`)
- Container App: `sports-event-manager-dev`
- URL: `https://sports-event-manager-dev.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io`
- Service principal: `github-actions-sports-event-manager`
- Supabase project ref: `lhflutwvwvzawzbcuwup` (the `wvw` letter pattern is correct — three letters: w, v, w)
- Supabase URL: `https://lhflutwvwvzawzbcuwup.supabase.co`
- Twilio subaccount: `sports-event-manager` (SID in 1Password)
- Sentry project: `viadal-event-dev` in org `extrapreneur` — https://extrapreneur.sentry.io/projects/viadal-event-dev/ (added 2026-08-25, REL-02)

### Perf environment (PERF-01 load testing)

Created 2026-09-01 for the PERF-01 load run. **Disposable** — holds only seeded
volume data, no real phone numbers, nothing anyone else depends on.

- Supabase project ref: `jsusfleoufnjfrgsshmi` (eu-north-1, ~10 USD/month)
- Container App: `sports-event-manager-perf` in `sports-event-manager-dev-rg`,
  on the shared `kanban-env`
- URL: `https://sports-event-manager-perf.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io`
- CPU/memory sized to match prod: 0.5 vCPU, 1 GiB per replica. Replica count
  does NOT match prod: this env runs min 2 / max 3 for measurement, while prod
  runs `minReplicas: 1` (see Prod environment below). The PERF-01 result does
  not depend on this difference — the 2026-09-01 run found replica count is
  not the constraint (3 → 5 moved throughput by 2 rps) — but the two configs
  are not identical and shouldn't be described as such.
- **Scaled to `minReplicas 0` between runs** so it costs nothing idle. Scale it
  back up before measuring, and check `az containerapp replica list` — a run
  against a cold or single replica is not comparable to an earlier one.
- Config is in `.env.perf` (gitignored). `scripts/perf-env.ts` reaches this
  project through an **exact-ref allowlist**: dev is explicitly refused, prod is
  refused by default-deny. Never add either.
- Auth rate limits are raised here (`sign_in_sign_ups = 500`) because the
  harness signs in 90 users at the start of a run. Phone auth is enabled;
  the harness uses password sign-in on the seeded +4672000xxxx pool.

To delete when PERF-01 is closed: `az containerapp delete` plus removing the
Supabase project, and drop the allowlist entry in `scripts/perf-env.ts`.

### Prod environment

- Resource group: `sports-event-manager-prod-rg`
- ACR: `sportsevtmgrprod` (`sportsevtmgrprod.azurecr.io`), admin-enabled, credentials in 1Password as "ACR sportsevtmgrprod"
- Container App: `sports-event-manager-prod`
- URL: `https://sports-event-manager-prod.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io`
- Service principal: `github-actions-sports-event-manager-prod` — scoped only to prod-rg with Contributor + AcrPush on the ACR
- Supabase: separate prod project in Stockholm region (project ref in 1Password)
- Twilio: separate Messaging Service "Sports Event Manager Prod" in the same subaccount as dev
- **Important:** `minReplicas: 1` is required (default `null`/0 causes startup probe failures, see Lessons Learned)
- **Custom domain:** `https://app.viadalevent.se` — configured on the prod Container App via a managed certificate on the shared `kanban-env` environment. This is now the primary prod URL; the Azure-generated URL above still works as a fallback.
- Sentry project: `viadal-event-prod` in org `extrapreneur` — https://extrapreneur.sentry.io/projects/viadal-event-prod/ (added 2026-08-25, REL-02)

### Twilio sender setup (MVP-phase)

- Dev Messaging Service: Swedish number +46728101619
- Prod Messaging Service: Swedish number +46766900096
- Dev login can be tested via Supabase Test Phone Numbers — number `46768109304` with fixed OTP code `000000` (dev Supabase project `lhflutwvwvzawzbcuwup`), bypasses Twilio entirely
- Prod login has always used the real Twilio sender — no Supabase Test Phone Number entry was ever added to prod (confirmed 2026-08-18; the earlier note claiming otherwise was incorrect)

### GitHub Secrets

**18 secrets per environment.** Re-verified 2026-08-27 by listing every
`secrets.*` reference in each workflow — the earlier count of 12 predated the
Sentry split and `CRON_SECRET`. Read the workflow rather than this list if they
ever disagree again.

**Dev (18) — naming is NOT uniformly prefixed, unlike prod. Verified against `deploy-dev.yml`:**
`DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_APP_URL`, `DEV_SENTRY_DSN`, `DEV_SENTRY_ORG`, `DEV_SENTRY_PROJECT`, `DEV_SENTRY_AUTH_TOKEN` (these eight have the `DEV_` prefix), plus `AZURE_RESOURCE_GROUP_DEV` (suffix, not prefix), and `AZURE_CREDENTIALS`, `REGISTRY_LOGIN_SERVER`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `CRON_SECRET`, `SUPABASE_ACCESS_TOKEN` (no prefix at all).

**Prod (18):** Consistently `PROD_`-prefixed — `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `PROD_APP_URL`, `PROD_AZURE_CREDENTIALS`, `PROD_AZURE_RESOURCE_GROUP`, `PROD_REGISTRY_LOGIN_SERVER`, `PROD_REGISTRY_USERNAME`, `PROD_REGISTRY_PASSWORD`, `PROD_TWILIO_ACCOUNT_SID`, `PROD_TWILIO_AUTH_TOKEN`, `PROD_TWILIO_PHONE_NUMBER`, `PROD_SENTRY_DSN`, `PROD_SENTRY_ORG`, `PROD_SENTRY_PROJECT`, `PROD_SENTRY_AUTH_TOKEN`, `PROD_CRON_SECRET` — with one exception: `SUPABASE_ACCESS_TOKEN`.

**`SUPABASE_ACCESS_TOKEN` is the only genuinely shared secret.** Same unprefixed name in both workflows; it authenticates the Supabase CLI for `db push` and `db:types`. Everything else is per-environment.

**Note:** `*_APP_URL` is the Azure Container App URL, `*_SUPABASE_URL` is the Supabase API URL — they are NOT the same thing and have caused confusion in the past. Double-check before pasting. When adding a new dev secret, match the existing (inconsistent) name in `deploy-dev.yml` rather than assuming a `DEV_` prefix.

**Sentry (4 per environment, `DEV_`/`PROD_`-prefixed like everything else):** `*_SENTRY_DSN`, `*_SENTRY_ORG`, `*_SENTRY_PROJECT`, `*_SENTRY_AUTH_TOKEN`. Two separate Sentry projects (`viadal-event-dev`, `viadal-event-prod`), so the DSN differs per environment — an earlier version of this section claimed one shared project and unprefixed names, which was wrong. `SENTRY_ENVIRONMENT` (`development`/`production`) is hardcoded per workflow, not a secret. `*_SENTRY_AUTH_TOKEN` is only used at build time for source-map upload — passed as a Docker `ARG`, never an `ENV`, so it isn't persisted into the pushed image's runtime environment.

**`CRON_SECRET` / `PROD_CRON_SECRET`** guard the scheduled route handlers (`api/cron/sms-worker`, `api/cron/gdpr-warning` — SEC-09). The same value must also exist in that environment's Supabase Vault, since pg_cron reads its own copy to make the call (see migration 0029). The handlers fail closed with 401 when the env var is unset.

---

## CI/CD workflows

- `.github/workflows/deploy-dev.yml` — auto-deploys on push to `main`
- `.github/workflows/deploy-prod.yml` — manual trigger (`workflow_dispatch`) or git tag `v*`. Uses `environment: production` with required reviewer (Frida) for approval gate.

**Image tagging:** Always tag with `${{ github.sha }}`, not `latest`. Azure Container Apps doesn't detect updates if the tag doesn't change.

**Docker layer cache:** Separate scopes for dev and prod (`scope=dev`, `scope=prod`) so they don't interfere.

**Single revision mode:** Both Container Apps are in Single revision mode so each deploy replaces the previous.

---

### When writing new RLS policies

For any new tenant-scoped table, the policies MUST use the conventions
established in migration 0004. The pattern is:

tenant*admin_manage*<table>: USING (get*user_role(tenant_id) = 'tenant_admin' OR is_system_admin())
tenant_member_read*<table>: USING (get_user_role(tenant_id) IS NOT NULL OR is_system_admin())

The is_system_admin() OR clause is mandatory. Without it, system_admins
cannot access tenants where they don't have an explicit user_roles row.
Direct subqueries on user_roles (the 0003 style) are obsolete.

---

## Data model (Supabase Postgres)

All tables have RLS enabled. Tenant isolation is enforced via RLS policies that check `tenant_id` against the requesting user's `user_roles` rows.

```
tenants
  id (uuid, PK)
  name (text)
  slug (text) — used in URL paths like /[tenantSlug]/dashboard
  is_active (boolean)
  tier (text) — likely 'free', 'paid', etc., used with feature_flags
  feature_flags (jsonb)
  created_at (timestamptz)

user_roles  — join table connecting Supabase Auth users to tenants
  id (uuid, PK)
  user_id (uuid) — references auth.users(id)
  tenant_id (uuid, nullable) — references tenants(id); null only for system_admin rows
  role (text) — 'system_admin' | 'tenant_admin' | 'official' | 'participant'

events
  id, tenant_id, name, event_type, start_date, end_date,
  location, description, logo_url, created_at

officials
  id, tenant_id,
  user_id (nullable — null until they sign up via SMS invite),
  name, phone, invite_status, created_at

participants
  id, tenant_id,
  user_id (nullable — same pattern as officials),
  name, phone, bib, category, race_results_url, created_at

assignments
  id, tenant_id, official_id, workstation,
  timeslot_start, timeslot_end, todo, created_at

announcements
  id, tenant_id, channel ('officials' | 'participants'),
  body, sms_sent, published_at, created_at
```

**Resolved (migration 0021):** `system_admin` is a global role — `tenant_id` is nullable and set to `null` for `system_admin` rows. A check constraint requires `tenant_id` for every other role. `is_system_admin()` and the app-level auth helpers in `src/lib/auth/tenant.ts` already ignored `tenant_id` for this role, so no RLS or app-code behavior changed.

---

### How to apply migrations

1. `supabase migration new <descriptive_name>` — creates the file under `supabase/migrations/` with a timestamp prefix
2. Write the SQL, then test locally: `supabase db reset` (replays all migrations against the local Docker stack)
3. Apply to dev: `supabase link --project-ref lhflutwvwvzawzbcuwup` then `supabase db push`
4. Apply to prod: `supabase link --project-ref rauvaxuypujbeintnnoe` then `supabase db push`

**Don't use the MCP `apply_migration` tool for normal migrations.** It writes its own ledger row with a `YYYYMMDDHHMMSS` version instead of reusing the migration file's own prefix, which creates an invisible duplicate if the same file is later applied via `db push` (or vice versa) — this caused a multi-hour cleanup on 2026-08-25 (mismatched `schema_migrations` history broke `supabase db pull` on both dev and prod). MCP/manual SQL execution is still fine for one-off inspection, verification queries, and the intentionally-manual files in `supabase/prod-manual-migrations/` (see below) — just not for applying a numbered migration file.

If `supabase db pull` ever reports a migration history mismatch pointing at a version that doesn't correspond to a real file, don't guess — inspect `supabase_migrations.schema_migrations` directly (via SQL) to see what the row actually contains before repairing or deleting it. `migration repair --status reverted` and a direct `delete from supabase_migrations.schema_migrations where version = '...'` may both be needed; `supabase migrations fetch` can help resync the CLI's view but will overwrite local migration file formatting as a side effect — discard those file changes (`git checkout -- supabase/migrations/`) unless you actually intended to regenerate them from the remote schema.

---

### Forward-fix plan (mandatory for every new migration)

Migrations here are forward-only. There are no `down.sql` files and none
will be added — recovery from a bad migration always means writing a new
numbered migration that moves forward. To make that survivable during a
live incident, **every migration from 0033 onward must document its own
forward-fix plan in the SQL comment header.** The person paging through a
broken deploy at 22:00 should find the answer already written down, not
have to reverse-engineer the migration under pressure.

This is the forward-fix half of MNT-07 ("every migration has a tested
reverse or a documented forward-fix"). The 32 existing migrations
(0001–0032) are intentionally exempt: they are already applied and stable
on both dev and prod, and retrofitting plans onto them costs more than it
would ever return.

**Format** — extends the header convention already used in
`0026_rate_limit_officials_invite.sql` and `0031_create_workstation_rpc.sql`:

```sql
-- ============================================================================
-- Migration 00NN: <title>
-- ============================================================================
--
-- <what it does and why — as today>
--
-- Forward-fix: <additive | destructive | replace>
--   Rollback: <the SQL, or the steps, for a new migration that undoes this>
--   Data:     <can the data be recovered, and from where — or "no data loss">
--   Blast:    <what breaks in the app between the bad deploy and the fix>
--   Window:   <what happens to the CURRENTLY DEPLOYED code while this schema
--             is live but the new image is not — "compatible", or the
--             expand/contract split this needs>
-- ============================================================================
```

**Risk classes** — pick exactly one; it sets the bar for the other lines:

| Class         | Typical changes                                                            | What `Rollback:` must say                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `additive`    | new table, new nullable/defaulted column, new index, new RPC               | A `drop ... if exists`. Safe by construction, so `Data:` is "no data loss".                                                                                                                                              |
| `destructive` | drop or rename a column, tighten a CHECK, backfill or UPDATE existing rows | Must name where the original data lives — the PITR window, an export file, or an explicit "not recoverable". Snapshot the affected rows with a `select` **before** pushing, or state outright that the loss is accepted. |
| `replace`     | changed RPC definition, changed RLS policy, changed trigger                | "Restore the definition from migration 00MM", with the filename. Always cheap, because the `create or replace` / `drop policy if exists` pattern is already the norm here.                                               |

### The ordering guarantee (why `Window:` exists)

**Schema goes first, and the app follows minutes later.** `deploy-prod.yml`
applies `supabase db push` as step 1 and only swaps the Container App
revision at step 4, after the type gate and the Docker build. Prod runs
`minReplicas: 1` in Single revision mode, so there is also a short overlap
where Azure has started the new revision and not yet drained the old one.
For that whole window — minutes, not seconds — **the new schema is live and
the previously deployed code is still serving traffic.**

Schema-first is the right order (the alternative, code-first, breaks the new
code instead and gives you no working version at all). But it obliges every
migration to satisfy one rule:

> **A migration must be backward-compatible with the code already running,
> for the length of one deploy window.**

What that permits and forbids:

| Change                                             | Safe in one release?                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| New nullable column, new index, new table, new RPC | **Yes.** Old code ignores what it does not select.                      |
| New mandatory column **with** a default            | **Yes.** Old code's `INSERT` omits the field; the default fills it.     |
| New mandatory column **without** a default         | **No.** Every `INSERT` from old code fails for the whole window.        |
| Renaming or dropping a column old code reads       | **No.** PostgREST returns `42703` to live users until step 4 completes. |
| Tightening a CHECK old code can still violate      | **No.** Old writes fail until the new image lands.                      |

**For anything in the "No" rows, split it across two releases** — the
expand/contract pattern:

1. **Expand.** Ship code that no longer depends on the old shape (stops
   reading the column, writes both old and new, tolerates either). Deploy it.
   The schema is untouched, so this release is safe in both directions.
2. **Contract.** Ship the migration that drops or renames. By now no running
   code reads the old shape, so the window is harmless.

A rename is two migrations under this pattern, not one: add the new column
and backfill (expand), then drop the old one in a later release (contract).
Never `ALTER TABLE ... RENAME COLUMN` on a column any deployed page selects
— that is exactly the break rehearsed in Del 3 of
`docs/testing/rollback-rehearsal.md`, and in a real deploy it would have hit
every user at once instead of one local test.

The `Window:` line in the header is where this is stated per migration. For
`additive` it is usually one word, "compatible". For `destructive` it must
name which release this is — expand or contract — or explain why the change
is safe against old code without a split. The `Migration forward-fix` job in
`quality.yml` requires it on every newly added migration and rejects an
unfilled `<placeholder>`; it only inspects files added in the diff, so
`0033` and `0034` — written before this line existed — are not retroactively
in breach, the same exemption 0001–0032 have.

**What has protected prod so far** is not this rule but two habits that
happen to imply it, and `docs/quality-requirements.md` says so outright: no
wildcard reads (all 78 database reads name their fields) and a default on
every mandatory column ever added. Habits do not survive two people
working in parallel, which is why the rule is written down here.

**The one hard rule:** a `destructive` migration does not get pushed to
prod until the `Data:` line says something verified rather than something
hoped. This is the same discipline that `docs/quality-requirements.md`
credits for prod not having had a schema incident yet — no wildcard reads,
a default on every mandatory column added. Keep it.

**Rehearse it:** `docs/testing/rollback-rehearsal.md` is the routine for
practising recovery before it is needed, and for verifying that the
migration suite still builds prod's schema exactly. Run it before any prod
release containing a migration. It runs against the local stack with
`npm run seed:dev` — never against a copy of prod data, which carries real
phone numbers under the SEC-09 retention decisions.

**Six migrations have no correct reverse** (`0003`, `0008`, `0009`, `0012`,
`0014`, `0015`) — retroactive downs for 0001–0032 were evaluated and
rejected in 2026-08-26; see F-REL-05 for the per-migration classification
and the rehearsal doc for the table. `0009` is the one to remember: a
naive reverse of its `invite_status` remap corrupts legitimate
confirmations, because it cannot tell them from the rows the migration
touched.

---

### After any DB migration

1. Run `npm run db:types` — regenerates src/types/database.ts
2. Update src/types/app.ts manually with aliases for any new tables
   (Row, Insert, Update types) and any new enum/status types matching
   CHECK constraints
3. Remove any temporary `any` casts that were placed pending types

---

## Status

### Phase 1-3: Foundation (DONE)

- Next.js scaffold, Supabase schema with RLS, Twilio SMS-OTP login working locally

### Phase 4: Dev CI/CD (DONE)

- Full GitHub Actions pipeline from push to deployed Azure Container App
- End-to-end SMS login verified on live dev URL

### Phase 5: Prod environment (DONE)

- Separate Supabase prod project in Stockholm
- Separate Twilio Messaging Service for prod
- Separate Azure resources with least-privilege service principal
- Prod GitHub Actions workflow with approval gate
- End-to-end SMS login verified on live prod URL

### Phase 6 (current): Application features

Working through PRE_PROD_CHECKLIST:

### Phase 6 (current): Application features

- [x] Tenant_id validation in route handlers
- [x] Post-login routing based on user role
- [x] DB migration 0003 — workstations, operating windows, todos, event stages, scheduling granularity, draft/published status, assignment statuses
- [x] TypeScript types regenerated from new schema
- [x] Lo-fi wireframes from Claude Design (key screens as reference)
- [x] Build admin screens (EVT-01, EVT-02, WS-01, WS-02, OFF-01, SCHED-01, COMM-01)
- [ ] Build official screens (HOME-01, INFO-01, MYSCH-01, ANN-01, ACCT-01)
- [ ] Build system admin screens (SYS-01, SYS-02)
- [x] i18next applied to UI strings
- [ ] Race Results integration

### Deferred / blocked on Peter

- Scope PDF renaming to "Sports Event Manager"
- Twilio EU data residency for strict GDPR compliance (post-MVP)

---

UX decisions and wireframes are located in `/Docs/`

## Conventions and design decisions

### Security

- **Defense in depth:** RLS protects the database; route handlers ALSO validate tenant_id against the authenticated user's role. Don't rely on one alone.
- **Service principals are least-privilege:** dev SP is scoped to dev RG only, prod SP to prod RG only. Even if leaked, blast radius is limited.
- **Service role key only on server:** Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser bundle. Only `NEXT_PUBLIC_*` variables get baked in at build time.
- **Server-side auth helper pattern:** Route handlers use `requireTenantAdmin(tenantId)` from `src/lib/auth/tenant.ts` — returns `{ user, role }` on success or `{ error: NextResponse }` to return directly. No try/catch needed in route handlers.

### Deployment

- Tag Docker images with `github.sha`, never `latest` — Azure doesn't detect updates on unchanged tags
- Container Apps in Single revision mode so deploys replace cleanly
- Always set `minReplicas: 1` (NOT 0) for the prod Container App — scale-to-zero breaks Next.js startup probes
- ACR auth on Container App via `az containerapp registry set` (one-time config)

### Secrets handling

- Always copy URLs and keys directly from source-of-truth UIs (Supabase Dashboard Copy button, `az` CLI output), never retype or rely on copies-of-copies
- When a secret seems "stuck wrong," hardcode the value in workflow.yml temporarily to isolate — the secret will either be the bug or eliminated as variable
- Browser DevTools is source of truth for what `NEXT_PUBLIC_*` values got baked in — search the loaded JS bundle

### Workflow

- **Task tracking:** Trello board at https://trello.com/b/7uISlZyI/sports-event-manager is the source of truth for who's working on what — used now that two people work on this codebase in parallel. Reference the Trello card in branch names/commits where it clarifies scope, similar to how screen IDs (EVT-01, SEC-09, etc.) are already used.
- Branch + PR for non-trivial changes (helps with traceability, and is now required with two people working in parallel to avoid conflicting changes)
- Commit messages: imperative mood, scope first if applicable ("auth: add requireTenantAdmin helper")
- Push tags (`v*`) only when intentionally cutting a release for prod

### RLS policy convention

For any new tenant-scoped table, the policies MUST follow the pattern established in migration 0004:

- `tenant_admin_manage_<table>` (FOR ALL): `USING (public.get_user_role(tenant_id) = 'tenant_admin' OR public.is_system_admin())`
- `tenant_member_read_<table>` (FOR SELECT): `USING (public.get_user_role(tenant_id) IS NOT NULL OR public.is_system_admin())`

The `is_system_admin()` OR clause is mandatory. Without it, system_admins cannot access tenants where they don't have an explicit user_roles row. Direct subqueries on `user_roles` (the 0003 style) and `IN ('tenant_admin', 'system_admin')` lists (the 0005-pre-fix style) are obsolete.

Use `DROP POLICY IF EXISTS` + `CREATE POLICY` for defensive re-runs. Avoid `DO $$ IF NOT EXISTS $$` blocks for policies.

### After any DB migration

1. Run `npm run db:types` to regenerate `src/types/database.ts`
2. Manually update `src/types/app.ts` with aliases for new tables (Row, Insert, Update types) and any new enum/status types matching CHECK constraints
3. Remove any temporary `any` casts that were placed pending types
4. Run the migration on **both dev and prod** Supabase projects

---

## Lessons learned (from real debugging sessions)

### Phase 4: The `wvw` vs `wvv` typo (cost ~2 days of debugging)

A Supabase URL was typed with `wvv` instead of `wvw` and the typo propagated through 1Password, GitHub Secrets, and several debug attempts. Browser bundle inspection (DevTools → loaded JS → search for the value) is the source of truth for what got built into the deploy. When updating a secret seems to not take effect, hardcode the value in workflow.yml temporarily — that eliminates the secret as a variable.

URLs with repeated character patterns (`wvw`) are very easy to mistype as a single letter (`wvv`). Always copy from the source UI's Copy button.

### Phase 5: Probe of StartUp failed with status code: 1 (cost ~1 hour)

Prod Container App was created with `minReplicas: null` (effectively 0). When the Next.js app started successfully but Azure's HTTP startup probe failed a few times during cold start, KEDA scaled it to zero and Azure fell back to the hello-world placeholder revision. The fix was to set `minReplicas: 1` — keeps a pod always warm and gives the probe more retries.

"ManuallyStopped" in `ContainerAppSystemLogs_CL` does NOT mean a manual stop — it's KEDA deactivating the deployment. Don't be misled by the terminology.

Dev had `minReplicas: 1` from earlier setup, which is why dev worked and prod didn't with otherwise identical configs.

### Phase 5: Port mismatch from hello-world placeholder (cost ~30 min)

Container App was created with `--target-port 80` (from the hello-world image default). Next.js listens on 3000. Required `az containerapp ingress update --target-port 3000` after the fact. **Future:** when creating Container Apps from scratch, set the target port directly.

### Phase 5: ACR auth missing on Container App (cost ~15 min)

Container App couldn't pull from ACR despite the service principal having AcrPush. The Container App resource itself needs registry credentials configured via `az containerapp registry set` — this is a one-time config, separate from GitHub Actions' ACR access.

### Phase 5: Two similar GitHub Secrets caused confusion

`DEV_SUPABASE_URL` and `DEV_APP_URL` are different things (Supabase API vs the deployed app's own URL). At one point in debugging it was unclear which contained what, contributing to the wvw/wvv confusion. Naming conventions matter — `*_SUPABASE_URL` for the database, `*_APP_URL` for the Azure-hosted app URL.

---

## Quick reference commands

### Common Azure CLI checks

```bash
# List all Container Apps in subscription
az containerapp list --query "[].{name:name, rg:resourceGroup, fqdn:properties.configuration.ingress.fqdn}" --output table

# Check revision health for a Container App
az containerapp revision list \
  --name <app-name> --resource-group <rg> \
  --query "[].{name:name, active:properties.active, health:properties.healthState, replicas:properties.replicas, image:properties.template.containers[0].image}" \
  --output table

# Tail console logs from a specific revision
az containerapp logs show \
  --name <app-name> --resource-group <rg> \
  --revision <revision-name> \
  --type console --tail 100

# Log Analytics workspace for kanban-env Container Apps
# Workspace customer ID: de1cb037-f845-4b44-8f8a-6a011394bce2
az monitor log-analytics query \
  --workspace de1cb037-f845-4b44-8f8a-6a011394bce2 \
  --analytics-query "ContainerAppSystemLogs_CL | where ContainerAppName_s == '<app-name>' | order by TimeGenerated desc | take 30 | project TimeGenerated, Log_s, Reason_s" \
  --output table
```

### Manual prod deploy

```bash
# Tag-based
git tag v0.1.0 && git push --tags

# Or via UI: Actions → Deploy to prod → Run workflow → main
# Then approve in Environment → production
```

---

## Where to find more context

- `DEVELOPMENT.md` — Frida's personal cheat sheet with debug recipes
- `PRE_PROD_CHECKLIST.md` — living checklist of what must be done before real users
- `level2-container.mermaid` — current architecture diagram (v0.3)
- `prisma/migrations/` or Supabase SQL Editor — actual schema source of truth
