# Sports Event Manager — Setup Guide

The starting point for getting the app running, locally or in a new environment.
It is deliberately short: it tells you the order to do things in and points to the
document that owns the details, so the details only live (and go stale) in one place.

| Document                                                                     | Owns                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`DEVELOPMENT.md`](DEVELOPMENT.md)                                           | Day-to-day commands, local Supabase, local login, local tournaments, debug recipes  |
| [`.claude/reference/infrastructure.md`](.claude/reference/infrastructure.md) | Azure resources per environment, GitHub Secrets, Twilio, CI/CD workflows, 1Password |
| [`.claude/reference/migrations.md`](.claude/reference/migrations.md)         | Writing and applying migrations, forward-fix headers, type generation               |
| [`.env.local.example`](.env.local.example)                                   | Every app env var, with what it does and what to leave blank locally                |
| [`docs/ops/backup-and-restore.md`](docs/ops/backup-and-restore.md)           | Prod backups, restores, SAS tokens                                                  |

---

## Prerequisites

- **Node.js 22** — the version CI uses. Node 26 makes ~70 tests fail with false
  `localStorage` errors; if Homebrew installed a newer Node, put an nvm 22 first in `PATH`.
- **Docker Desktop** — the local Supabase stack runs in it.
- **Supabase CLI** — installed as a dev dependency; run it as `npx supabase`.
- **Azure CLI** (`az`) and **GitHub CLI** (`gh`) — only for deploy and environment work.
- **1Password** access to the "Viadal Event Manager" vault (Work account) — for real
  dev/prod secrets. Not needed for local development.

---

## 1. Local development

Local development runs against a local Supabase stack, not the dev cloud project.
No real SMS is sent: seeded test numbers log in with a fixed code.

```bash
git clone https://github.com/fridisbredis/sports-event-manager
cd sports-event-manager
npm install

cp .env.local.example .env.local
# Fill in the local values: `npx supabase start` prints the local URL and keys.
# SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN can be any non-empty string.

export SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=dummy   # read only at `supabase start`
npx supabase start            # local db, auth, PostgREST, Studio
npx supabase db reset         # all migrations + supabase/seed.sql (grants)
npm run seed:dev:local        # test tenants, events and users

npm run dev                   # http://localhost:3000
```

Log in with phone `700000001`, country SE (+46), code `000000`.

If login fails with "We didn't recognize that number", the app is probably talking to
the dev cloud project instead of the local stack. `NEXT_PUBLIC_*` values are baked in
at build time. See "Local phone login" in `DEVELOPMENT.md`.

### Checks before pushing

```bash
npm run lint
npm run typecheck
npm test                      # unit tests (Vitest)
npm run test:integration      # against the local Supabase stack
npm run test:e2e              # Playwright, against the local app
npm run format                # Prettier — CI fails on unformatted files
```

### Optional pieces

- **Tournaments (ADR-0005)** need the separate `tournament-app` repo running next to
  this one. See "Local tournaments" in `DEVELOPMENT.md`.
- **SMS and push delivery** cannot be tested locally (Twilio and Apple both need a
  public https URL). Deploy the branch to dev through the workflow's "Run workflow"
  button instead.
- **Docker:** `docker compose up --build` runs the app in a container locally.

---

## 2. Setting up a new cloud environment

This is rarely done. Dev and prod already exist, and the perf environment is scaled to
zero between runs. Do it in this order, using `infrastructure.md` for names and values:

1. **Supabase project:** create it, enable Phone auth, configure the Send SMS hook,
   and store the Vault secrets that pg_cron reads (`CRON_SECRET`).
2. **Twilio:** set up a Messaging Service and sender for the environment.
3. **Azure:** create the resource group, container registry, Container Apps
   environment and Container App, plus a service principal scoped to that resource
   group only. For prod, set `minReplicas: 1`, because scale-to-zero breaks the
   startup probes.
4. **GitHub Secrets:** add every secret the environment's deploy workflow reads. The
   workflow file (`.github/workflows/deploy-*.yml`) is the source of truth for that
   list. Keep a copy of each in 1Password.
5. **First deploy:** run the workflow. It applies all migrations, checks that
   `src/types/database.ts` matches the migrated schema, then builds and deploys
   the image.

---

## 3. Deploying

| Target | How                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------- |
| Dev    | Automatic on every push to `main` (`deploy-dev.yml`). A branch can be deployed with "Run workflow". |
| Prod   | Actions → "Deploy to prod" → Run workflow on `main`, then approve under Environments → production.  |

Both workflows apply pending migrations before deploying. Never run `supabase db push`
against prod by hand.

A migration must ship with a matching `src/types/database.ts`, or the deploy's types
gate fails. A new migration only exists locally until merge, so `npm run db:types`
(which reads dev) can't see it yet. How to update the types by hand is in
`.claude/reference/migrations.md`.
