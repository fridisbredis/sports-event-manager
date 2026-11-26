# Sports Event Manager (Viadal)

A multi-tenant web app for planning and running sports events. Each tenant is a club or organization. Event admins set up events, stages and work areas, invite officials and schedule them. Officials sign in with their phone number (SMS code), see their shifts and get announcements by SMS and push. The Viadal 6-day run is the event the app was designed around.

| Folder                        | What                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `src/app/`                    | Next.js 16 App Router: admin, official, system admin and API routes                      |
| `src/lib/`, `src/components/` | Server actions, auth helpers, scheduling logic, shared UI                                |
| `supabase/`                   | Migrations (the schema's source of truth), seed and local config                         |
| `public/locales/`             | Translations, English and Swedish                                                        |
| `tests/`                      | Integration and Playwright end-to-end tests                                              |
| `docs/`                       | Scope, flows, screen specs, C4 diagrams, ADRs. Start at [docs/README.md](docs/README.md) |

**Stack:** Next.js 16, React 19, TypeScript, HeroUI and Tailwind, i18next. Supabase for auth (phone OTP), Postgres with Row Level Security and storage. Twilio for SMS, Sentry for errors. Runs as a Docker image on Azure Container Apps.

- **Tenant isolation:** every tenant-scoped table has RLS, and route handlers check the user's role in the tenant as well. The conventions are in [.claude/CLAUDE.md](.claude/CLAUDE.md).
- **Tournaments:** premium and professional tenants get tournaments from the separate tournament engine (`tournament-app` repo). See [ADR-0005](docs/adr/0005-turneringsmotor-viadal.md).
- **CI:** `quality.yml` runs lint, typecheck, format check, unit and integration tests, migration guards and a production build on every pull request.
- **Deploy:** every push to `main` deploys to dev. Prod is deployed by running _Deploy to prod_ on `main` and approving it. Both apply pending migrations first.

## Run locally

[SETUP.md](SETUP.md) has the steps: local Supabase in Docker, seeded test users, and the checks to run before pushing. Day-to-day commands and debug recipes are in [DEVELOPMENT.md](DEVELOPMENT.md).

## More

- [PRE_PROD_CHECKLIST.md](PRE_PROD_CHECKLIST.md): what must be done before real users
- [docs/quality-requirements.md](docs/quality-requirements.md): quality requirements and open findings
- [docs/adr/](docs/adr/): architecture decisions
- [docs/ops/backup-and-restore.md](docs/ops/backup-and-restore.md): prod backups and restores
