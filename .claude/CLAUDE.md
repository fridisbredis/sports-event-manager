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

## Subagent usage

For read-only research (finding files, grepping symbols, locating patterns —
"where is X defined"), prefer the `explore` subagent (runs on Haiku, cheaper)
over `general-purpose`. Don't delegate at all for something answerable with
one or two direct `grep`/`Read` calls. Reserve `general-purpose` for tasks
that actually need broader tools (editing, multi-step reasoning) alongside
research.

---

## Reference documents — read when relevant, not by default

- **`.claude/reference/infrastructure.md`** — Azure subscriptions, dev/perf/prod environment details, GitHub Secrets naming, Twilio setup, CI/CD workflows, deployment conventions, secrets handling, Azure CLI quick-reference commands. Read before touching deploy config, secrets, environment setup, or CI/CD.
- **`.claude/reference/migrations.md`** — migration naming convention, forward-fix plan format, RPC return-shape contracts, the schema/code backward-compatibility rules, how to apply migrations, the data model. Read before writing, reviewing, or reasoning about any migration or RPC change.
- **`.claude/reference/lessons-learned.md`** — past incident postmortems (the `wvw`/`wvv` typo, `minReplicas` probe failure, port mismatch, ACR auth, secrets confusion). Read when debugging something that smells like it might be a repeat of a known issue.

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

- **Task tracking:** Trello board at https://trello.com/b/7uISlZyI/sports-event-manager is the source of truth for who's working on what — used now that two people work on this codebase in parallel. Reference the Trello card in branch names/commits where it clarifies scope, similar to how screen IDs (EVT-01, SEC-09, etc.) are already used.
- Branch + PR for non-trivial changes (helps with traceability, and is now required with two people working in parallel to avoid conflicting changes)
- Commit messages: imperative mood, scope first if applicable ("auth: add requireTenantAdmin helper")
- Push tags (`v*`) only when intentionally cutting a release for prod

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

## Where to find more context

- `DEVELOPMENT.md` — Frida's personal cheat sheet with debug recipes
- `PRE_PROD_CHECKLIST.md` — living checklist of what must be done before real users
- `level2-container.mermaid` — current architecture diagram (v0.3)
- `prisma/migrations/` or Supabase SQL Editor — actual schema source of truth
- `.claude/reference/` — infrastructure, migrations, and lessons-learned detail (see "Reference documents" above)
