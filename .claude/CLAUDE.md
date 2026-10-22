# Sports Event Manager — Project Context for Claude

> This file is read automatically by Claude (VS Code extension and Claude Code CLI) to establish project context. Keep it up to date as the project evolves.
>
> **This is the core file — kept short on purpose.** Detailed reference material lives in `.claude/reference/` and is loaded only when relevant (see "Reference documents" below). Don't inline infrastructure specifics, migration mechanics, or historical postmortems here — add them to the matching reference file instead.

---

## Project overview

Multi-tenant sports event web platform. Each tenant is a sports organization or club. The platform handles event management, official assignments, participant management, and SMS-based announcements.

**Stakeholders:**

- **Frida Bredberg** — IT consultant at Extrapreneur AB, developer on this project
- **Peter Thorn** — project manager / customer
- **Deadline:** Viadal 2026
- As of 2026-10, Frida works on this codebase **solo** again. Treat every branch, PR and task as Frida's own unless proven otherwise.

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

## Subagent usage

This repo has its own subagents in `.claude/agents/` — prefer them over the
generic built-ins:

- **`explore`** (Haiku) — read-only code search: finding files, grepping
  symbols, "where is X defined". Use instead of `general-purpose` for research.
- **`plan`** (Sonnet) — implementation plans that account for this codebase's
  constraints (RLS, migrations, tenant isolation). Use before non-trivial work.
- **`scheduling-env-tester`** — runs the scheduling E2E flow against localhost
  only, then read-only config diff localhost vs prod.

Don't delegate at all for something answerable with one or two direct
`grep`/`Read` calls. Reserve `general-purpose` for tasks that need broader
tools (editing, multi-step reasoning) alongside research.

---

## Reference documents — read when relevant, not by default

- **`.claude/reference/infrastructure.md`** — Azure subscriptions, dev/perf/prod environment details, GitHub Secrets naming, Twilio setup, CI/CD workflows, deployment conventions, secrets handling, Azure CLI quick-reference commands. Read before touching deploy config, secrets, environment setup, or CI/CD.
- **`.claude/reference/migrations.md`** — migration naming convention, forward-fix plan format, RPC return-shape contracts, the schema/code backward-compatibility rules, how to apply migrations, the data model. Read before writing, reviewing, or reasoning about any migration or RPC change.
- **`.claude/reference/lessons-learned.md`** — past incident postmortems (the `wvw`/`wvv` typo, `minReplicas` probe failure, port mismatch, ACR auth, secrets confusion). Read when debugging something that smells like it might be a repeat of a known issue.

---

## Source documents

Peter has delivered a complete v1 specification in `docs/`. These are the source of truth — CLAUDE.md only summarizes.

- `docs/scope/`, `docs/flows/`, `docs/ia/screen-map.md` — scope, per-use-case flows, screen map
- `docs/screens/screen-documentation.md` — developer-ready screen specs (IDs, blocks, states)
- `docs/c4/` — architecture diagrams
- `docs/wireframes/` — lo-fi grayscale wireframes. Layout-and-content reference only, NOT a visual design spec — don't recreate the grayscale look in the real app.

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

## Conventions and design decisions

### Security

- **Defense in depth:** RLS protects the database; route handlers ALSO validate tenant_id against the authenticated user's role. Don't rely on one alone.
- **Service principals are least-privilege:** dev SP is scoped to dev RG only, prod SP to prod RG only. Even if leaked, blast radius is limited.
- **Service role key only on server:** Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser bundle. Only `NEXT_PUBLIC_*` variables get baked in at build time.
- **Server-side auth helper pattern:** Route handlers use `requireTenantAdmin(tenantId)` from `src/lib/auth/tenant.ts` — returns `{ user, role }` on success or `{ error: NextResponse }` to return directly. No try/catch needed in route handlers.

### RLS policy convention (mandatory for any new tenant-scoped table)

Policies MUST follow the pattern established in migration 0004:

- `tenant_admin_manage_<table>` (FOR ALL): `USING (public.get_user_role(tenant_id) = 'tenant_admin' OR public.is_system_admin())`
- `tenant_member_read_<table>` (FOR SELECT): `USING (public.get_user_role(tenant_id) IS NOT NULL OR public.is_system_admin())`

The `is_system_admin()` OR clause is **mandatory**. Without it, system_admins cannot access tenants where they don't have an explicit `user_roles` row. Direct subqueries on `user_roles` (the 0003 style) and `IN ('tenant_admin', 'system_admin')` lists (the 0005-pre-fix style) are obsolete.

Use `DROP POLICY IF EXISTS` + `CREATE POLICY` for defensive re-runs. Avoid `DO $$ IF NOT EXISTS $$` blocks for policies.

(For migration mechanics, forward-fix headers, and the full backward-compatibility rules, see `.claude/reference/migrations.md`.)

### When a server action makes more than one write

If a route handler or server action performs two or more sequential
`.insert()`/`.update()`/`.delete()` calls where a later one can fail after
an earlier one already committed, see `docs/patterns/atomic-multi-table-writes.md`
(REL-01) before adding more — wrap the sequence in one RPC instead.

### Deployment

- Tag Docker images with `github.sha`, never `latest` — Azure doesn't detect updates on unchanged tags
- Container Apps in Single revision mode so deploys replace cleanly
- Always set `minReplicas: 1` (NOT 0) for the prod Container App — scale-to-zero breaks Next.js startup probes
- ACR auth on Container App via `az containerapp registry set` (one-time config)

(Full environment specs, GitHub Secrets list, and CI/CD workflow details: `.claude/reference/infrastructure.md`.)

### Workflow

- **Task tracking:** a shared Claude Artifact, maintained together with Peter, is the source of truth for what's in flight and what's done. It replaces the old Trello board — don't treat Trello as current. Board: https://claude.ai/artifact/2eBcTpeqoyiSx54gCxxR2h?sk=mx9-SNZZ9SsO--FyESohvQ Reference the task in branch names/commits where it clarifies scope, the way screen IDs (EVT-01, SEC-09, etc.) already are.
- Branch + PR for non-trivial changes (traceability and reviewable history; Frida also runs parallel Claude sessions in the same repo, so branches keep those from colliding)
- Commit messages: imperative mood, scope first if applicable ("auth: add requireTenantAdmin helper")
- Push tags (`v*`) only when intentionally cutting a release for prod

---

## Status

**Phases 1-5 (DONE):** Next.js scaffold, Supabase schema with RLS, Twilio SMS-OTP
login, dev CI/CD to Azure Container Apps, and a fully separate prod environment
(own Supabase project, Twilio Messaging Service, Azure resources,
least-privilege SP, approval-gated workflow). SMS login verified end-to-end on
both live URLs.

**Phase 6 (current):** Application features. All admin, official and system admin
screens are built and i18next is applied. Remaining in PRE_PROD_CHECKLIST:
Race Results integration. For everything else in flight, read the task board
rather than this file.

### Deferred / blocked on Peter

- Scope PDF renaming to "Sports Event Manager"
- Twilio EU data residency for strict GDPR compliance (post-MVP)

---

## Where to find more context

- `DEVELOPMENT.md` — Frida's personal cheat sheet with debug recipes
- `PRE_PROD_CHECKLIST.md` — living checklist of what must be done before real users
- `supabase/migrations/` — actual schema source of truth
- `Docs/` — scope PDFs from Peter, ADRs, code-review standards
