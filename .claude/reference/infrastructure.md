# Infrastructure reference

> Read this when touching deploy config, secrets, environment setup, or CI/CD. Not loaded into every session by default — see the pointer in the core `CLAUDE.md`.

---

## Azure subscription

- Subscription ID: `dc64af83-c062-48db-abae-4cb73a478bb2`
- Region: `swedencentral`
- Shared Container Apps Environment: `kanban-env` in `kanban-app-rg` (free tier allows 1 env per region per subscription, so dev and prod Container Apps both use this same environment)

## Dev environment

- Resource group: `sports-event-manager-dev-rg`
- ACR: `sportsevtmgrdev` (`sportsevtmgrdev.azurecr.io`)
- Container App: `sports-event-manager-dev`
- URL: `https://sports-event-manager-dev.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io`
- Service principal: `github-actions-sports-event-manager`
- Supabase project ref: `lhflutwvwvzawzbcuwup` (the `wvw` letter pattern is correct — three letters: w, v, w)
- Supabase URL: `https://lhflutwvwvzawzbcuwup.supabase.co`
- Twilio subaccount: `sports-event-manager` (SID in 1Password)
- Sentry project: `viadal-event-dev` in org `extrapreneur` — https://extrapreneur.sentry.io/projects/viadal-event-dev/ (added 2026-08-25, REL-02)

## Perf environment (PERF-01 load testing)

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

## Prod environment

- Resource group: `sports-event-manager-prod-rg`
- ACR: `sportsevtmgrprod` (`sportsevtmgrprod.azurecr.io`), admin-enabled, credentials in 1Password as "ACR sportsevtmgrprod"
- Container App: `sports-event-manager-prod`
- URL: `https://sports-event-manager-prod.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io`
- Service principal: `github-actions-sports-event-manager-prod` — scoped only to prod-rg with Contributor + AcrPush on the ACR
- Supabase: separate prod project in Stockholm region (project ref in 1Password)
- Twilio: separate Messaging Service "Sports Event Manager Prod" in the same subaccount as dev
- **Important:** `minReplicas: 1` is required (default `null`/0 causes startup probe failures, see `.claude/reference/lessons-learned.md`)
- **Custom domain:** `https://app.viadalevent.se` — configured on the prod Container App via a managed certificate on the shared `kanban-env` environment. This is now the primary prod URL; the Azure-generated URL above still works as a fallback.
- Sentry project: `viadal-event-prod` in org `extrapreneur` — https://extrapreneur.sentry.io/projects/viadal-event-prod/ (added 2026-08-25, REL-02)

## Twilio sender setup (MVP-phase)

- Dev Messaging Service: Swedish number +46728101619
- Prod Messaging Service: Swedish number +46766900096
- Dev login can be tested via Supabase Test Phone Numbers — number `46768109304` with fixed OTP code `000000` (dev Supabase project `lhflutwvwvzawzbcuwup`), bypasses Twilio entirely
- Prod login has always used the real Twilio sender — no Supabase Test Phone Number entry was ever added to prod (confirmed 2026-08-18; the earlier note claiming otherwise was incorrect)

## GitHub Secrets

**19 secrets per environment as of SYS-03 (2026-09-02)**, up from 18 — the
`*_SENTRY_API_TOKEN` addition below. Read the workflow rather than this list
if they ever disagree again.

**Dev (19) — naming is NOT uniformly prefixed, unlike prod. Verified against `deploy-dev.yml`:**
`DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_APP_URL`, `DEV_SENTRY_DSN`, `DEV_SENTRY_ORG`, `DEV_SENTRY_PROJECT`, `DEV_SENTRY_AUTH_TOKEN`, `DEV_SENTRY_API_TOKEN` (these nine have the `DEV_` prefix), plus `AZURE_RESOURCE_GROUP_DEV` (suffix, not prefix), and `AZURE_CREDENTIALS`, `REGISTRY_LOGIN_SERVER`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `CRON_SECRET`, `SUPABASE_ACCESS_TOKEN` (no prefix at all).

**Prod (19):** Consistently `PROD_`-prefixed — `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `PROD_APP_URL`, `PROD_AZURE_CREDENTIALS`, `PROD_AZURE_RESOURCE_GROUP`, `PROD_REGISTRY_LOGIN_SERVER`, `PROD_REGISTRY_USERNAME`, `PROD_REGISTRY_PASSWORD`, `PROD_TWILIO_ACCOUNT_SID`, `PROD_TWILIO_AUTH_TOKEN`, `PROD_TWILIO_PHONE_NUMBER`, `PROD_SENTRY_DSN`, `PROD_SENTRY_ORG`, `PROD_SENTRY_PROJECT`, `PROD_SENTRY_AUTH_TOKEN`, `PROD_SENTRY_API_TOKEN`, `PROD_CRON_SECRET` — with one exception: `SUPABASE_ACCESS_TOKEN`.

**`SUPABASE_ACCESS_TOKEN` is the only genuinely shared secret.** Same unprefixed name in both workflows; it authenticates the Supabase CLI for `db push` and `db:types`. Everything else is per-environment.

**Note:** `*_APP_URL` is the Azure Container App URL, `*_SUPABASE_URL` is the Supabase API URL — they are NOT the same thing and have caused confusion in the past. Double-check before pasting. When adding a new dev secret, match the existing (inconsistent) name in `deploy-dev.yml` rather than assuming a `DEV_` prefix.

**Sentry (5 per environment, `DEV_`/`PROD_`-prefixed like everything else):** `*_SENTRY_DSN`, `*_SENTRY_ORG`, `*_SENTRY_PROJECT`, `*_SENTRY_AUTH_TOKEN`, `*_SENTRY_API_TOKEN`. Two separate Sentry projects (`viadal-event-dev`, `viadal-event-prod`), so the DSN differs per environment — an earlier version of this section claimed one shared project and unprefixed names, which was wrong. `SENTRY_ENVIRONMENT` (`development`/`production`) is hardcoded per workflow, not a secret.

**`*_SENTRY_AUTH_TOKEN` and `*_SENTRY_API_TOKEN` are two separate secrets with two separate scopes — do not merge them.**
`*_SENTRY_AUTH_TOKEN` is build-only: a Docker `ARG` (never a Dockerfile `ENV`, so never persisted into the pushed image's filesystem layers) used only for source-map upload during `next build`. It needs only the `project:releases` scope.
`*_SENTRY_API_TOKEN` is runtime-only: both deploy workflows pass it to `az containerapp update --set-env-vars`, the same mechanism `SUPABASE_SERVICE_ROLE_KEY` already uses — Container Apps injects it straight into the running process's environment, with no image involved. SYS-03's `/admin/health` reads it there (`process.env.SENTRY_API_TOKEN`) to query Sentry's `GET /issues/` API for live unresolved-issue counts, which needs `project:read` (+ `org:read`) — scopes a release-upload token does not carry.
This split exists because SYS-03 originally tried to reuse `*_SENTRY_AUTH_TOKEN` for both purposes (2026-09-02) and got a 403 from Sentry's API at runtime — the existing token only had `project:releases`. If either token's scope ever needs widening, keep the two purposes on separate tokens rather than reaching for a shared superset again.

**`CRON_SECRET` / `PROD_CRON_SECRET`** guard the scheduled route handlers (`api/cron/sms-worker`, `api/cron/gdpr-warning` — SEC-09). The same value must also exist in that environment's Supabase Vault, since pg_cron reads its own copy to make the call (see migration 0029). The handlers fail closed with 401 when the env var is unset.

---

## CI/CD workflows

- `.github/workflows/deploy-dev.yml` — auto-deploys on push to `main`
- `.github/workflows/deploy-prod.yml` — manual trigger (`workflow_dispatch`) or git tag `v*`. Uses `environment: production` with required reviewer (Frida) for approval gate.

**Image tagging:** Always tag with `${{ github.sha }}`, not `latest`. Azure Container Apps doesn't detect updates if the tag doesn't change.

**Docker layer cache:** Separate scopes for dev and prod (`scope=dev`, `scope=prod`) so they don't interfere.

**Single revision mode:** Both Container Apps are in Single revision mode so each deploy replaces the previous.

---

## Secrets handling

- Always copy URLs and keys directly from source-of-truth UIs (Supabase Dashboard Copy button, `az` CLI output), never retype or rely on copies-of-copies
- When a secret seems "stuck wrong," hardcode the value in workflow.yml temporarily to isolate — the secret will either be the bug or eliminated as variable
- Browser DevTools is source of truth for what `NEXT_PUBLIC_*` values got baked in — search the loaded JS bundle

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
