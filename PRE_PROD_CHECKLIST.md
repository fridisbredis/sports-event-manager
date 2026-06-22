# Pre-Production Checklist

Living document. Tick items as they're completed. Last updated: 2026-06-22.

---

## 🚨 Must-have before going to prod

### Security

- [ ] Build `tenant_id` validation into `src/app/api/announcements/route.ts` — verify the authenticated user is a tenant admin for the supplied `tenantId` before using `createSupabaseServiceClient()`
- [ ] Build `tenant_id` validation into `src/app/api/officials/route.ts` — same as above
- [ ] Audit any other route that uses the service role client — service role bypasses RLS, so application-layer checks are the only safety net
- [ ] Rotate ACR passwords (and any other secret) if it's been shared, screenshotted, or pasted anywhere outside 1Password
- [ ] Verify Twilio EU data residency setting (Console → Account → General Settings → Region) for strict GDPR compliance

### Missing features

- [ ] Post-login routing in `src/app/page.tsx` based on user role:
  - `system_admin` → `/admin`
  - `tenant_admin` → `/[tenantSlug]/dashboard`
  - `official` → `/[tenantSlug]/dashboard`
  - `participant` → `/[tenantSlug]/my`
- [ ] System admin view: create/deactivate tenants, toggle feature flags per tenant
- [ ] Tenant admin flows: event configuration, officials management, announcements
- [ ] Official view: assignments (workstation, timeslot, todo)
- [ ] Participant view: event info, schedule, Race Results link, personal view with bib/category
- [ ] Personal account settings for all roles: phone, name, notification opt-out toggle
- [ ] Announcement publishing UI with two channels (officials, participants)
- [ ] Replace all hardcoded UI strings with `i18next` translation keys (English-only in v1, but no hardcoded strings — non-negotiable architectural requirement)

### Naming and documentation

- [ ] Peter renames Mermaid files and scope PDF from "Viadal Event Planner" to "Sports Event Manager"
- [ ] Peter's corrected Level 2 diagram (Supabase outside the app boundary) added to `docs/c4/`
- [ ] Create `DEVELOPMENT.md` (gitignored) with Azure resource details, URLs, and deployment procedures — mirror the Kanban setup

### Domain and URLs

- [ ] Decide on production domain (e.g. `sportseventmanager.com`)
- [ ] Register domain
- [ ] Configure custom domain on Azure Container Apps (CNAME → fqdn)
- [ ] Provision and verify SSL certificate (Azure handles this, but allow time)
- [ ] Update `NEXT_PUBLIC_APP_URL` to the production domain
- [ ] Decide tenant routing strategy: subdomain (`viadal.sportseventmanager.com`) vs. path (`/viadal`)

### Twilio production

- [ ] Confirm Messaging Service is fully out of trial mode (no verified caller IDs required)
- [ ] Decide whether to register an alphanumeric sender ID ("Viadal" or "SportEvtMgr") — approval takes days, start early
- [ ] Budget for SMS costs (~$0.07 per OTP + announcement volume per event)
- [ ] Document SMS spend tracking — Twilio Console → Monitor → Usage, filtered by subaccount

---

## 👍 Should-have before prod (or shortly after)

### Performance and operations

- [ ] Pipe Next.js logs into Azure Log Analytics (structured logging)
- [ ] Add a `/api/health` endpoint for Container Apps liveness/readiness probes
- [ ] Tune `min-replicas` and `max-replicas` for prod (consider 2 minimum for redundancy)
- [ ] Enable Supabase connection pooling (Supavisor) if "too many connections" errors appear
- [ ] Configure container app autoscaling rules based on HTTP traffic

### Error handling

- [ ] Add Sentry (or equivalent) for production error tracking
- [ ] Replace `setError` with toast notifications in UI
- [ ] Handle partial failures in announcement SMS sending (e.g. 3 of 200 failed → how does the admin see this?)
- [ ] Add retry logic for transient Twilio failures

### Secrets management

- [ ] Migrate env vars from Container Apps env to Azure Key Vault references
- [ ] Use 1Password CLI to inject secrets into local dev (no more plaintext `.env.local`)
- [ ] Set up GitHub Actions OIDC federation with Azure (replace ACR username/password with managed identity)

### Testing

- [ ] Smoke tests for auth flow (phone OTP login end-to-end)
- [ ] Multi-tenant isolation test: sign in as tenant A, attempt to read tenant B's data → RLS must block
- [ ] Seed script for dev database with realistic test data

### Multi-tenant edge cases

- [ ] Design behaviour when a user has roles in multiple tenants (tenant switcher UI?)
- [ ] Decide: can a user be both `official` and `participant` in the same tenant?
- [ ] Soft delete vs hard delete for tenants and events — historical data preservation strategy

### Backup and disaster recovery

- [ ] Verify Supabase plan is Pro (has Point-in-Time Recovery) before launch
- [ ] Document restore procedure from Supabase backup
- [ ] Document rollback procedure for bad deployments (re-deploy previous Docker tag)

---

## 📋 Phase tracking

### Phase 3: Azure dev environment (in progress)

- [x] Resource group `sports-event-manager-dev-rg` created
- [x] ACR `sportsevtmgrdev` created and passwords rotated + saved in 1Password
- [x] First Docker image built and pushed to ACR (`dev-initial`)
- [x] Container Apps Environment (using shared environment from Kanban project due to quota)
- [x] Container App `sports-event-manager-dev` created
- [x] Login flow verified on Azure URL

### Phase 4: GitHub Actions CI/CD

- [x] GitHub repo created (named `sports-event-manager`)
- [x] All secrets added (ACR credentials, Supabase keys, Twilio keys, etc.)
- [x] `deploy-dev.yml` workflow runs on push to `main`
- [ ] `deploy-prod.yml` workflow runs on version tag push

### Phase 5: Production environment

- [ ] Prod Supabase project created in Stockholm region
- [ ] Migrations + RLS policies applied to prod
- [ ] Prod ACR or prod tag strategy in place
- [ ] Prod Container App created
- [ ] Prod environment variables configured (separate from dev)
- [ ] Domain + SSL + custom domain on Container App
- [ ] First production deployment verified
- [ ] Quota request to Azure for dedicated prod Container Apps Environment (optional)

---

## ✅ Already done

- [x] Stack decided: Next.js 16 + Supabase + Twilio + Docker + Azure Container Apps
- [x] Repo scaffolded with App Router, route groups, Supabase client helpers, middleware
- [x] Database schema migrations (`0001_initial_schema.sql`)
- [x] RLS policies migration (`0002_rls_policies.sql`) — RLS enabled on all tables
- [x] Dev Supabase project in Stockholm region
- [x] Twilio subaccount under Nattvandrarna parent
- [x] Twilio Messaging Service with Swedish phone number
- [x] Phone OTP login working locally
- [x] Phone OTP login working in Docker container
- [x] Next.js 16 + React 19 upgrade with async `cookies()` API fixes
