# Sports Event Manager — Project Context for Claude

> This file is read automatically by Claude (VS Code extension and Claude Code CLI) to establish project context. Keep it up to date as the project evolves.

---

## Project overview

Multi-tenant sports event web platform. Each tenant is a sports organization or club. The platform handles event management, official assignments, participant management, and SMS-based announcements.

**Stakeholders:**

- **Frida Bredberg** — IT consultant at Extrapreneur AB, sole developer on this project
- **Peter Thorn** — project manager / customer
- **Deadline:** Viadal 2026

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

### Twilio sender setup (MVP-phase)

- Dev Messaging Service: Swedish number +46728101619
- Prod Messaging Service: Swedish number +46766900096
- Dev login can be tested via Supabase Test Phone Numbers — number `46768109304` with fixed OTP code `000000` (dev Supabase project `lhflutwvwvzawzbcuwup`), bypasses Twilio entirely
- Prod login was previously tested via Supabase Test Phone Numbers (Frida's own number with a fixed OTP code) before a real sender was assigned — remove that test phone entry before real users hit prod, if not already done

### GitHub Secrets

**Dev (12) — naming is NOT uniformly prefixed, unlike prod. Actual names, verified against `deploy-dev.yml`:**
`DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_APP_URL` (these four have the `DEV_` prefix), plus `AZURE_CREDENTIALS`, `AZURE_RESOURCE_GROUP_DEV` (suffix, not prefix), `REGISTRY_LOGIN_SERVER`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (these have no prefix at all).

**Prod (12):** Consistently `PROD_`-prefixed: `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `PROD_APP_URL`, `PROD_AZURE_CREDENTIALS`, `PROD_AZURE_RESOURCE_GROUP`, `PROD_REGISTRY_LOGIN_SERVER`, `PROD_REGISTRY_USERNAME`, `PROD_REGISTRY_PASSWORD`, `PROD_TWILIO_ACCOUNT_SID`, `PROD_TWILIO_AUTH_TOKEN`, `PROD_TWILIO_PHONE_NUMBER`.

**Note:** `*_APP_URL` is the Azure Container App URL, `*_SUPABASE_URL` is the Supabase API URL — they are NOT the same thing and have caused confusion in the past. Double-check before pasting. When adding a new dev secret, match the existing (inconsistent) name in `deploy-dev.yml` rather than assuming a `DEV_` prefix.

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
  tenant_id (uuid) — references tenants(id)
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

**Open question:** How is `system_admin` represented in `user_roles`? `tenant_id` is NOT NULL, so either there's a row per tenant or a designated "system tenant." Confirm before building system admin features.

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

- Branch + PR for non-trivial changes, even when working solo (helps with traceability)
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
