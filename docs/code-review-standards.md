# Code review standards

> Status: Draft — checklist/convention for PR review. Doesn't block anything
> urgent, but is requested as a prerequisite for consistent quality now that
> two developers (Frida + Eduardo) work in parallel on this codebase.
>
> No `MNT-0x` ID is assigned yet — every existing MNT slot in
> `docs/quality-requirements.md` covers something else, and MNT-03 there is
> a different, unrelated requirement (test coverage for business rules).
> Minting a new ID is a call for whoever owns that register, not something
> this PR should decide unilaterally.

This document describes **how we review PRs here**, not general best
practices. Where a project decision is already documented in
`.claude/CLAUDE.md`, it's linked instead of repeated.

---

## 1. Before opening a PR (author's responsibility)

- [ ] Branch + PR for anything non-trivial (convention since two people work
      in parallel, see CLAUDE.md → Workflow)
- [ ] Trello card exists and is linked, or the screen ID/scope justifies why
      not (SYS-01, EVT-02, SEC-09, etc. — see `docs/screens/screen-documentation.md`)
- [ ] `npm run format` run on changed files (not just `--check`)
- [ ] `npm test` run locally — and a `supabase db reset` if the PR touches
      migrations or RLS
- [ ] If the PR includes a new migration: the forward-fix header is filled in
      (see CLAUDE.md → "Forward-fix plan"), not just `<placeholder>`
- [ ] If the PR reads or writes a `.rpc(...)` response: the key contract is
      unchanged, or an integration test verifies the new response
      (see CLAUDE.md → "RPC return-shape contracts")
- [ ] The PR description says **why**, not just what — especially for scale
      decisions or deviations from an established pattern

A PR missing any of the above can still be sent for review, but the reviewer
flags it explicitly instead of assuming it's fine.

---

## 2. Review checklist (reviewer's responsibility)

Go through in this order — security and data integrity before style.

### 2.1 Tenant isolation and auth (always, for any route/RPC change)

- [ ] The route handler validates `tenant_id` against the user's role via
      `requireTenantAdmin` / the equivalent helper in `src/lib/auth/tenant.ts`
      — **not** RLS alone. Defense in depth is mandatory, not optional.
- [ ] A new tenant-scoped table follows the RLS pattern from migration 0004:
      `tenant_admin_manage_<table>` and `tenant_member_read_<table>`, both with
      the `is_system_admin()` OR clause. Direct subqueries on `user_roles` or
      `IN ('tenant_admin','system_admin')` lists are obsolete — flag them.
- [ ] A new SELECT policy exists if there's a new DELETE policy on the same
      table (a DELETE policy without a matching SELECT hides the row before
      it can be deleted — see the migration 0024 incident)
- [ ] No new `SUPABASE_SERVICE_ROLE_KEY` usage added without first considering
      an RLS client (see `docs/adr/0001-service-role-vs-session-client.md`)

### 2.2 Migrations

- [ ] New migrations use the Supabase CLI's native
      `YYYYMMDDHHMMSS_description.sql` filename, not a hand-picked sequential
      `00NN` number (#151, merged 2026-09-08) — this is what eliminates the
      collision risk when two people create migrations in parallel. The last
      sequential migration on `main` is `0060` — the cutover happened
      mid-sequence, not cleanly at a round number, so don't assume "0059
      onward" or any other fixed number; check the tail of
      `supabase/migrations/` for the actual latest file. Migrations
      0001–0055, 0058–0060 are never renamed retroactively (0056/0057 don't
      exist on `main`; the sequence has a gap there).
- [ ] The forward-fix block exists and is filled in (for migrations created
      from 0033 onward — see `.claude/CLAUDE.md`)
- [ ] If `destructive`: the `Data:` line describes something **verified**,
      not hoped — run a `select` as a snapshot of affected rows before
      pushing if unsure
- [ ] If the change touches a column/RPC that existing code reads: compatible
      with the code already running during the deploy window (see the "What's
      safe in one release" table in CLAUDE.md) — otherwise require an
      expand/contract split
- [ ] CI's `migration-number-collision` job (`quality.yml`, PR #74) catches a
      shared numeric prefix under `supabase/migrations/` automatically —
      the prefix-extraction regex matches a 14-digit timestamp exactly as
      well as a 4-digit number, so this already covers timestamped filenames
      too. A collision is practically impossible under the timestamp scheme;
      the job existing is belt-and-braces, not a manual step for reviewers
      to redo.
- [ ] No `RENAME COLUMN` or CHECK tightening that old code could violate

### 2.3 Types and data model

- [ ] `npm run db:types` run after the migration, `src/types/app.ts` manually
      updated with new Row/Insert/Update aliases
- [ ] No leftover `any` casts that were waiting on types
- [ ] The diff against `--local` types is hand-applied to the dev-generated
      `database.ts`, not wholesale overwritten (the PostgREST version
      difference is infrastructure, not schema — see CLAUDE.md)

### 2.4 UI conventions

- [ ] Form fields use `Input`/`Textarea`/`Select`/`TimeInput`/
      `DateRangePicker` from `@/components/ui/form-fields` — never raw HeroUI
- [ ] White cards use `AppCard`/`CARD_SURFACE` — no custom
      `rounded-xl`/`shadow-md` combinations
- [ ] Responsiveness matches the requirement for the screen type: admin
      web-first, official/participant mobile-first (SCHED-01 edit-on-desktop /
      view-only mobile is the special case, see screen-documentation.md)

### 2.5 Secrets and environment

- [ ] No hardcoded keys/URLs in the diff, not even temporarily (if a debug
      session left a hardcode in workflow.yml — remove it before merging)
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` or equivalent in client code (only
      `NEXT_PUBLIC_*` may reach the bundle)
- [ ] New secrets are named per the existing (inconsistent) convention in
      `deploy-dev.yml`/`deploy-prod.yml` — not per what "should" be consistent

### 2.6 General code quality

- [ ] No silent `catch` blocks that swallow errors and render empty (the
      F-REL-10 pattern)
- [ ] No new abstraction without at least 3 real use cases
- [ ] Comments explain **why**, not what — no comment that just restates the
      line of code

---

## 3. What does NOT block a merge

- Missing Swedish (`sv`) i18n keys — `sv` is a registered, active locale
  (`src/lib/i18n/config.ts`) but most namespace files under
  `public/locales/sv/` are incomplete or absent (e.g. `common.json` has 2 of
  the 7 keys `en` has). The app falls back to English for missing keys, so
  this is a known, accepted gap rather than a regression — don't block a PR
  on adding `sv` translations unless the PR is specifically about i18n. No
  written decision doc exists for this yet; treat this bullet itself as
  that record until one does.
- Style nits with no functional consequence — comment, but don't hold up
  the merge for it
- Missing retroactive "down" migration for 0001–0032 — these are explicitly
  exempt (see `docs/testing/rollback-rehearsal.md` and F-REL-05)

---

## 4. Escalation

- Unsure about an RLS or migration change involving live data? Show the
  mutating SQL and wait for explicit approval before executing — applies
  during review too, not just your own work.
- Unsure about scope or ownership? The Trello board
  (https://trello.com/b/7uISlZyI/sports-event-manager) is the source of
  truth for who owns what, not assumptions in the comment thread.
- Found something bigger than the PR (e.g. a pattern repeated across 10+
  files)? File a separate Trello card instead of blocking the current PR
  on it.

---

## Changelog

- 2026-09-08 — First draft
- 2026-09-08 — Address review by @eduardoOlguin on PR #153: dropped the
  `MNT-03` ID (already taken by an unrelated requirement in
  `quality-requirements.md`; no ID assigned yet, pending register owner);
  marked the timestamp migration-naming bullet as pending #151 rather than
  already in force; corrected the CI collision-job description (it already
  covers timestamped filenames); replaced the unresolvable
  `feedback_sv_locale_intentionally_incomplete` citation with an inline,
  verifiable statement of the sv-locale gap
- 2026-09-08 — #151 merged same day. Updated §2.2 from "pending" to
  in-force; corrected the naming cutover point — it landed mid-sequence at
  `0060`, not cleanly at `0059` — and pointed reviewers at the actual tail
  of `supabase/migrations/` instead of a fixed number that will go stale
  again
