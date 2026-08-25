# Service-role usage audit (SEC-03)

> SEC-03 (`docs/quality-requirements.md`): "Service-role access must be exceptional,
> contained, and auditable." Every use of `createSupabaseServiceClient()` must be
> listed here with its justification, the authorization check that precedes it, and
> its test coverage. Keep this file in sync whenever a service-role call site is
> added, removed, or changed — a stale audit is worse than no audit.

`createSupabaseServiceClient()` (`src/lib/supabase/server.ts`) uses
`SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS entirely. The default for any new
data access must be `createSupabaseServerClient()` (RLS-enforced, request-scoped).
Reach for the service client only when RLS itself makes the normal client
unusable — see the justification categories below.

## Justification categories

- **Bootstrap lookup** — the query determines _what role the user has_, so RLS
  (which depends on that same role) can't gate it. This is a chicken-and-egg
  problem, not a convenience.
- **Cross-tenant / admin write** — the operation legitimately needs to act
  outside the caller's own tenant scope (e.g. system admin managing all tenants),
  after an explicit role check.
- **Public token-gated flow** — no authenticated session exists yet (invite
  links, OTP confirmation); the security boundary is a single-use, expiring
  token instead of a session.
- **Auth-admin API** — calls into `service.auth.admin.*`, which has no
  RLS-based equivalent at all.

Anything that doesn't fit one of these should be using the normal server client
instead.

## Audit table

**Updated 2026-08-19 (reads):** rows #3–7 and #10–14 — the ones flagged below
as "broader than necessary" — are migrated to `createSupabaseServerClient()`
(RLS-enforced). C4 (`docs/c4/level2-container.mermaid`) states the service
role is never used for user-scoped tenant data; these ten reads were the
concrete violations of that statement still on the service client, so they
no longer appear in the "current service-role call sites" table below — see
[Migrated call sites](#migrated-call-sites-2026-08-19) for what each one now
does.

**Updated 2026-08-19 (writes):** rows #2, #15, #17, #18, #19 are also now
migrated, after `tests/integration/sec03-write-migration.test.ts` proved the
`tenant_admin_manage_*`/`system_admin_all_tenants` RLS policies (FOR ALL)
permit the same writes these routes already gated with
`requireTenantAdmin`/`assertSystemAdmin`. Each migration keeps any call with
no RLS equivalent (`auth.admin.*`, the `get_user_id_by_phone` RPC) on the
service client — see the per-row detail in
[Migrated call sites](#migrated-call-sites-2026-08-19). Row #17 additionally
needed a new RLS policy (migration `0024`) and a new RPC (migration `0025`,
`remove_official`) before it could move — see
["Row #17: fixed via migration 0024"](#row-17-fixed-via-migration-0024)
below for why a straight client swap wasn't enough there.

Rows #1, #8, #9, #16, #20 are unchanged: they're bootstrap lookups, public
token-gated flows, or the auth-admin API, none of which RLS can substitute
for.

### Current service-role call sites

| #   | File                                              | Call site(s)                                                                                                                  | What it does                                                                      | Auth check before use                                                                                                                                       | Justification                                                                                                                                                | Test coverage                                                                                                                                                           |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/auth/tenant.ts`                          | `getUserRoles`, `hasAdminAccessToTenant`, `requireSystemAdmin`, `requireTenantAdmin`, `canViewOfficialSurfaces`               | Reads `user_roles`/`officials` to determine the caller's role(s)                  | N/A — these functions _are_ the auth check; callers use verified `user.id` from session                                                                     | Bootstrap lookup                                                                                                                                             | `src/lib/auth/tenant.test.ts`                                                                                                                                           |
| 8   | `src/app/invite/[token]/page.tsx`                 | select `officials` by `invite_token`                                                                                          | Render invite confirmation form                                                   | None — no session exists yet                                                                                                                                | Public token-gated flow (token is the boundary, checked for `invited` status + expiry)                                                                       | `page.test.tsx` added 2026-08-12 — covers the lookup-by-token, already-confirmed redirect, expired/wrong-status/missing-official cases, and the valid-invite render     |
| 15  | `src/app/api/officials/route.ts` (`POST`)         | `service.auth.admin.createUser`/`deleteUser`, `service.rpc('get_user_id_by_phone')`                                           | Create (or reuse) the invited official's `auth.users` row                         | `requireTenantAdmin(tenantId)` after Zod validation                                                                                                         | Auth-admin API                                                                                                                                               | `route.test.ts` — verified 2026-08-19: the `officials` insert half moved to the session client (see Migrated call sites); only the `auth.admin.*`/RPC calls remain here |
| 16  | `src/app/api/officials/confirm/route.ts` (`POST`) | select/update `officials`, select `tenants`, upsert `user_roles`                                                              | Confirm invite after OTP verification                                             | Session required (Bearer or cookie); token re-validated server-side (status + expiry) against DB                                                            | Public token-gated flow — session exists but caller has no tenant role yet, so RLS can't apply                                                               | `route.test.ts` — verified 2026-08-12: 10 cases                                                                                                                         |
| 20  | `src/app/api/account/route.ts` (`PATCH`)          | `service.auth.admin.updateUserById` (admin mode); update `officials` by `user_id`+`tenant_id` (official mode)                 | Update display name (admin) or own official row                                   | Session required; official-mode update is double-scoped (`user_id` AND `tenant_id`), so a forged `tenantId` just yields zero rows, not a cross-tenant write | Auth-admin API (admin mode) / bootstrap-adjacent (official mode)                                                                                             | `route.test.ts` — verified 2026-08-12: 10 cases                                                                                                                         |
| 21  | `src/lib/rate-limit.ts`                           | `checkInviteRateLimit`/`releaseInviteRateLimit` (via `service.rpc('check_rate_limit')` / `service.rpc('release_rate_limit')`) | Postgres-based rate limiting for the officials invite/resend endpoints (F-SEC-08) | `requireTenantAdmin(tenantId)` at both call sites (`src/app/api/officials/route.ts`, `src/app/api/officials/[id]/resend/route.ts`)                          | No RLS equivalent — both RPCs are `security definer`, granted to `service_role` only, and the underlying table (`rate_limit_hits`) is not tenant-scoped data | `src/lib/rate-limit.test.ts` (unit) + `tests/integration/rate-limit.test.ts` (integration, real RPCs)                                                                   |

Numbering keeps the original rows' identity for traceability from earlier
findings (F-SEC-03, PR history); it is not a claim that the remaining rows
are exhaustive or contiguous post-migration.

### Migrated call sites (2026-08-19)

Now on `createSupabaseServerClient()` (RLS-enforced). Verified via `tsc
--noEmit`, `eslint .`, the full unit suite, and the full integration suite
(62/62, real local Supabase stack, RLS actually evaluated) — not just a
type-level check.

**Reads (rows #3–7, #10–14):**

| Former # | File                                                         | What it does                                                            | RLS policy that now gates it                                                                          |
| -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 3        | `src/app/(system)/admin/page.tsx`                            | List all tenants for system admin dashboard                             | `system_admin_all_tenants` (FOR ALL, `is_system_admin()`)                                             |
| 4        | `src/app/(system)/admin/[tenantId]/page.tsx`                 | Load one tenant's detail view                                           | Same as #3                                                                                            |
| 5        | `src/app/(tenant)/[tenantSlug]/admin/officials/page.tsx`     | List officials for a tenant's admin screen                              | `tenant_member_read_officials`                                                                        |
| 6        | `src/app/(tenant)/[tenantSlug]/admin/communication/page.tsx` | List announcements for admin screen                                     | `tenant_member_read_announcements`                                                                    |
| 7        | `src/app/(tenant)/[tenantSlug]/admin/account/page.tsx`       | Tenant admin's own account page (tenants, officials, assignments count) | `tenant_member_read` (tenants), `tenant_member_read_officials`, `tenant_admin_manage_assignments`     |
| 10       | `src/app/(official)/[tenantSlug]/schedule/page.tsx`          | Load own schedule                                                       | `tenant_member_read_officials`, `official_read_own_assignments`                                       |
| 11       | `src/app/(official)/[tenantSlug]/home/page.tsx`              | Home screen greeting + event name                                       | `tenant_member_read_officials`, `tenant_member_read_events`                                           |
| 12       | `src/app/(official)/[tenantSlug]/event-info/page.tsx`        | Public-to-tenant event info                                             | `tenant_member_read_events`, `tenant_member_read_event_stages`, `tenant_member_read_event_facilities` |
| 13       | `src/app/(official)/[tenantSlug]/announcements/page.tsx`     | List announcements for officials                                        | `tenant_member_read_announcements`                                                                    |
| 14       | `src/app/(official)/[tenantSlug]/account/page.tsx`           | Own account page (officials, assignments count)                         | `tenant_member_read_officials`, `official_read_own_assignments`                                       |

**Writes (rows #2, #15 officials-insert half, #17, #18, #19):**

| Former # | File                                                  | What it does                                                        | RLS policy that now gates it                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2        | `src/app/(system)/admin/actions.ts`                   | Create tenant + default event/stages; toggle tenant active/tier     | `system_admin_all_tenants` (FOR ALL) on `tenants`; `tenant_member_read_events`/`_event_stages` cover the insert side identically for a system_admin                                                                           |
| 15       | `src/app/api/officials/route.ts` (`POST`)             | Insert the invited `officials` row                                  | `tenant_admin_manage_officials`. **Split file**: `service.auth.admin.createUser`/`deleteUser` and `get_user_id_by_phone` have no RLS equivalent and stay on the service client — see row #15 in the service-role table above. |
| 17       | `src/app/api/officials/[id]/route.ts` (`DELETE`)      | Remove an official — via the `remove_official` RPC (migration 0025) | `tenant_admin_manage_officials`, `tenant_admin_manage_assignments`, and migration 0024's `tenant_admin_read_official_role`/`tenant_admin_revoke_official_role`, all evaluated inside the RPC as the caller (SECURITY INVOKER) |
| 18       | `src/app/api/officials/[id]/resend/route.ts` (`POST`) | Regenerate invite token + resend SMS                                | `tenant_admin_manage_officials`                                                                                                                                                                                               |
| 19       | `src/app/api/announcements/route.ts` (`POST`)         | Publish announcement + send SMS                                     | `tenant_admin_manage_announcements`, `tenant_member_read_officials`/`participants` for the recipient query                                                                                                                    |

Row #9 (`(official)/[tenantSlug]/layout.tsx`) is **not** in this list — the
layout itself already used `createSupabaseServerClient()` for its own
`tenants` lookup; the service-role call the old row #9 pointed at lives
inside `canViewOfficialSurfaces` (`tenant.ts`), which is the bootstrap
lookup covered by row #1. No code change was needed there.

## Open items (tracked, not yet fixed)

0. ~~`admin/actions.ts` had no runtime input validation — `tenantId`, `tier`, and
   `name` were trusted at the TypeScript-type level only, with no Zod schema
   like every other mutating route in this codebase.~~ **Fixed 2026-08-12**: added
   `createTenantSchema`, `setTenantActiveSchema`, `setTenantTierSchema` with
   `safeParse` before any service-role write, matching the pattern in
   `api/officials/route.ts` etc.
1. ~~**Rows #3–4** (`(system)/admin/page.tsx`, `(system)/admin/[tenantId]/page.tsx`) have
   no explicit auth check of their own — they rely entirely on the ambient
   `(system)/layout.tsx` check.~~ **Fixed 2026-08-25:** both pages now call
   `requireSystemAdmin()` (`src/lib/auth/tenant.ts:207`) directly and `notFound()` on
   failure, before doing any data access — the same data-access-boundary pattern
   `canViewOfficialSurfaces` established for the official surfaces. A file moved out
   from under `(system)/layout.tsx` now still protects itself. Covered by new test
   cases in both pages' `page.test.tsx`; full suite (316/316) passing.
2. ~~**Rows #5–7, #10–14** use the service client for reads that are already gated
   by an explicit role check or ambient layout check just above them. They're not
   unsafe, but they're broader than necessary — the RLS-enforced
   `createSupabaseServerClient()` would work identically once the caller's role is
   confirmed, and would shrink the audit surface for this file over time. Left
   as-is for now; revisit if this list grows.~~ **Fixed 2026-08-19**: all ten
   migrated to `createSupabaseServerClient()`. See
   [Migrated call sites](#migrated-call-sites-2026-08-19). Cross-tenant/admin
   write rows (#2, #15, #17–19) were deliberately left out of this pass —
   scoped decision, see F-SEC-03 in `docs/quality-requirements.md`.

### Row #17: fixed via migration 0024

Before touching any of #2/#15/#17–19's production code,
`tests/integration/sec03-write-migration.test.ts` was written to exercise
the exact write shapes those routes perform against a real local Supabase
stack with RLS actually evaluated — not mocked. #2, #15 (the `officials`
insert half), #18, and #19 all passed on the first run: the
`tenant_admin_manage_*`/`system_admin_all_tenants` policies (FOR ALL) permit
the same writes the routes already gate with `requireTenantAdmin`/
`assertSystemAdmin`.

**#17 initially did not.** Its third step — deleting the official's
`official` row in `user_roles` on removal — could not have been migrated to
the session client as written. `user_roles` had exactly two RLS policies
(`supabase/migrations/0002_rls_policies.sql:63-70`): `system_admin_manage_roles`
(FOR ALL, `is_system_admin()`) and `user_read_own_role` (SELECT, self only).
There was no `tenant_admin` policy on `user_roles` at all. A `tenant_admin`'s
delete against this table returned no error and silently matched zero rows,
regardless of how correctly the query was scoped — proven against a real,
existing row before any fix was written.

**Fixed by migration `0024_tenant_admin_revoke_official_role.sql`, which adds
two policies, not one:**

- `tenant_admin_read_official_role` (SELECT) and
- `tenant_admin_revoke_official_role` (DELETE)

both scoped identically: `role = 'official' AND (get_user_role(tenant_id) =
'tenant_admin' OR is_system_admin())`. **The SELECT policy is not optional.**
Discovered while writing this fix: Postgres RLS requires a row to be visible
under some SELECT-permitting policy before a DELETE's `USING` clause is even
evaluated against it. With only the DELETE policy in place, a tenant_admin's
own `SELECT` of another user's `user_roles` row already returned zero rows
(blocked by `user_read_own_role`, which is self-only) — so the DELETE
matched nothing even though its `USING` clause was true in isolation when
checked directly. Verified by reproducing the row-visibility gap directly
against the local Postgres instance before adding the SELECT policy, and by
integration tests before/after.

Both policies are scoped to `role = 'official'` only, so a tenant_admin can
never see or delete a `tenant_admin`/`system_admin` row through them — a
dedicated integration test in `sec03-write-migration.test.ts` (`tenant_admin
cannot delete a tenant_admin or system_admin user_roles row`) guards that.

**Migrated 2026-08-19:** `remove_official` (migration `0025`) now wraps
#17's three writes (`assignments` delete, `officials` update, `user_roles`
delete) in a single transaction, closing F-REL-04 for this route alongside
the RLS/client migration — `src/app/api/officials/[id]/route.ts` calls the
RPC via `createSupabaseServerClient()` rather than performing the three
writes itself. See `supabase/migrations/0025_remove_official_rpc.sql`.

3. ~~**Test coverage column** — rows #3–14 had no test files at all (not just
   "unverified" — genuinely nonexistent), and rows #15–20 needed verification
   that their existing `.test.ts` files exercised the service-role path itself
   rather than just the response shape.~~ **Fixed 2026-08-12**: added
   `page.test.tsx`/`layout.test.tsx` for rows #3–14 (auth-gate branches, query
   scoping assertions, prop passthrough); verified rows #15–20's existing tests
   do exercise the scoped queries. Full suite: 27 files, 210 tests, all green;
   `tsc --noEmit` clean.
4. `announcements/route.ts` writes `sms_sent: false` and never updates it — known
   issue, tracked separately as F-SEC-04 in `docs/quality-requirements.md`, not a
   SEC-03 finding.

## Maintenance rule

Any PR that adds, removes, or moves a `createSupabaseServiceClient()` call site
must update this table in the same PR. A code-review checklist item, not just a
convention: reviewers should reject a PR that touches this call and doesn't touch
this file.
