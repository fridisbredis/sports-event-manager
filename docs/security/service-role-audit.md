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

- **Bootstrap lookup** — the query determines *what role the user has*, so RLS
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

| # | File | Call site(s) | What it does | Auth check before use | Justification | Test coverage |
|---|------|--------------|---------------|------------------------|----------------|----------------|
| 1 | `src/lib/auth/tenant.ts` | `getUserRoles`, `hasAdminAccessToTenant`, `requireSystemAdmin`, `requireTenantAdmin` | Reads `user_roles` to determine the caller's role(s) | N/A — these functions *are* the auth check; callers use verified `user.id` from session | Bootstrap lookup | `src/lib/auth/tenant.test.ts` |
| 2 | `src/app/(system)/admin/actions.ts` | `assertSystemAdmin()` (internal), then insert `tenants`/`events`/`event_stages`; update `tenants` (active/tier) | Create tenant + default event/stages; toggle tenant active/tier | `assertSystemAdmin()` at top of every exported action, **plus Zod validation (`createTenantSchema`, `setTenantActiveSchema`, `setTenantTierSchema`) added 2026-08-12** | Cross-tenant / admin write | `actions.test.ts` added 2026-08-12 — covers the auth gate (no session, non-admin), Zod rejection paths, and the success/failure paths for all three actions |
| 3 | `src/app/(system)/admin/page.tsx` | select `tenants` (list) | List all tenants for system admin dashboard | None on the page itself — relies on `(system)/layout.tsx` ambient `system_admin` check | Cross-tenant / admin write, but **not contained at the data-access boundary** (SEC-02 overlap) | `page.test.tsx` added 2026-08-12 — covers the query shape and the empty-data fallback (does not add its own auth check; that's the tracked SEC-02 gap below) |
| 4 | `src/app/(system)/admin/[tenantId]/page.tsx` | select `tenants` by id | Load one tenant's detail view | Same as above — ambient layout check only | Same gap as #3 | `page.test.tsx` added 2026-08-12 — covers `notFound()` on missing tenant and correct prop passthrough |
| 5 | `src/app/(tenant)/[tenantSlug]/admin/officials/page.tsx` | select `officials` by `tenant_id` | List officials for a tenant's admin screen | `hasAdminAccessToTenant(user.id, tenant.id)` before the service call | Bootstrap-adjacent: role check already done; list read then uses service client for convenience — could use RLS-enforced client instead since caller is already confirmed tenant_admin | `page.test.tsx` added 2026-08-12 — covers no-session redirect, denied-access `notFound()`, and the query scoping |
| 6 | `src/app/(tenant)/[tenantSlug]/admin/communication/page.tsx` | select `announcements` by `tenant_id` | List announcements for admin screen | `hasAdminAccessToTenant(user.id, tenant.id)` before the service call | Same as #5 | `page.test.tsx` added 2026-08-12 — same coverage shape as #5 |
| 7 | `src/app/(tenant)/[tenantSlug]/admin/account/page.tsx` | select `tenants`, `officials`, count `assignments` | Tenant admin's own account page | `getUserRoles` + explicit `tenantRole \|\| isSystemAdmin` check | Bootstrap-adjacent, same as #5 | `page.test.tsx` added 2026-08-12 — covers the no-role `notFound()`, the system_admin-without-tenant-role branch, and both the pre-official and post-official-row render branches |
| 8 | `src/app/invite/[token]/page.tsx` | select `officials` by `invite_token` | Render invite confirmation form | None — no session exists yet | Public token-gated flow (token is the boundary, checked for `invited` status + expiry) | `page.test.tsx` added 2026-08-12 — covers the lookup-by-token, already-confirmed redirect, expired/wrong-status/missing-official cases, and the valid-invite render |
| 9 | `src/app/(official)/[tenantSlug]/layout.tsx` | select `user_roles` by `user_id`+`tenant_id` | Gate all official-area pages on tenant membership | User session verified; this call *is* the membership check | Bootstrap lookup | `layout.test.tsx` added 2026-08-12 — covers no-session redirect, unresolved-tenant `notFound()`, missing-role-row `notFound()`, and the pass-through render |
| 10 | `src/app/(official)/[tenantSlug]/schedule/page.tsx` | select `officials`, `assignments` | Load own schedule | Layout (#9) gates membership; query itself scoped by `.eq('user_id', user.id)` | Bootstrap-adjacent — scoping makes this safe without a separate admin check | `page.test.tsx` added 2026-08-12 — covers the `user_id`/`tenant_id`/`invite_status` scoping on the officials lookup and the official-id/tenant-id scoping on the assignments query |
| 11 | `src/app/(official)/[tenantSlug]/home/page.tsx` | select `officials`, `events` | Home screen greeting + event name | Layout (#9); `officials` query scoped by `user_id` | Same as #10 | `page.test.tsx` added 2026-08-12 — covers the scoping on both queries |
| 12 | `src/app/(official)/[tenantSlug]/event-info/page.tsx` | select `events`, `event_stages`, `event_facilities` by `tenant_id` | Public-to-tenant event info | Layout (#9) gates tenant membership; data itself is tenant-wide by design (all officials see the same event info) | Bootstrap-adjacent | `page.test.tsx` added 2026-08-12 — covers the `tenant_id` scoping on all three queries |
| 13 | `src/app/(official)/[tenantSlug]/announcements/page.tsx` | select `announcements` by `tenant_id`+`channel` | List announcements for officials | Layout (#9); tenant-wide by design | Bootstrap-adjacent | `page.test.tsx` added 2026-08-12 — covers the `tenant_id`+`channel` scoping and the empty/non-empty render branches |
| 14 | `src/app/(official)/[tenantSlug]/account/page.tsx` | select `tenants`, `officials`, count `assignments` | Own account page | Layout (#9); `officials` query scoped by `user_id` | Bootstrap-adjacent | `page.test.tsx` added 2026-08-12 — covers the `user_id`/`tenant_id` scoping and the null-count fallback |
| 15 | `src/app/api/officials/route.ts` (`POST`) | insert `officials`, select `tenants` (name for SMS) | Invite a new official | `requireTenantAdmin(tenantId)` after Zod validation | Cross-tenant / admin write | `route.test.ts` — verified 2026-08-12: exercises the insert payload, the auth-error short-circuit, and the SMS send, not just the 200 shape |
| 16 | `src/app/api/officials/confirm/route.ts` (`POST`) | select/update `officials`, select `tenants`, upsert `user_roles` | Confirm invite after OTP verification | Session required (Bearer or cookie); token re-validated server-side (status + expiry) against DB | Public token-gated flow — session exists but caller has no tenant role yet, so RLS can't apply | `route.test.ts` — verified 2026-08-12: 10 cases |
| 17 | `src/app/api/officials/[id]/route.ts` (`DELETE`) | select/update `officials`, delete `assignments` | Remove an official | `requireTenantAdmin(tenantId)`; every subsequent query re-scoped by `tenantId` | Cross-tenant / admin write | `route.test.ts` — verified 2026-08-12: explicitly asserts the lookup is scoped to both `id` and `tenantId` (not just `id`) |
| 18 | `src/app/api/officials/[id]/resend/route.ts` (`POST`) | select/update `officials`, select `tenants` | Regenerate invite token + resend SMS | `requireTenantAdmin(tenantId)` | Cross-tenant / admin write | `route.test.ts` — verified 2026-08-12: 7 cases |
| 19 | `src/app/api/announcements/route.ts` (`POST`) | select `officials`/`participants` (recipients), insert `announcements` | Publish announcement + send SMS | `requireTenantAdmin(tenantId)` after Zod validation | Cross-tenant / admin write | `route.test.ts` — verified 2026-08-12: 10 cases |
| 20 | `src/app/api/account/route.ts` (`PATCH`) | `service.auth.admin.updateUserById` (admin mode); update `officials` by `user_id`+`tenant_id` (official mode) | Update display name (admin) or own official row | Session required; official-mode update is double-scoped (`user_id` AND `tenant_id`), so a forged `tenantId` just yields zero rows, not a cross-tenant write | Auth-admin API (admin mode) / bootstrap-adjacent (official mode) | `route.test.ts` — verified 2026-08-12: 10 cases |

## Open items (tracked, not yet fixed)

0. ~~`admin/actions.ts` had no runtime input validation — `tenantId`, `tier`, and
   `name` were trusted at the TypeScript-type level only, with no Zod schema
   like every other mutating route in this codebase.~~ **Fixed 2026-08-12**: added
   `createTenantSchema`, `setTenantActiveSchema`, `setTenantTierSchema` with
   `safeParse` before any service-role write, matching the pattern in
   `api/officials/route.ts` etc.
1. **Rows #3–4** (`(system)/admin/page.tsx`, `(system)/admin/[tenantId]/page.tsx`) have
   no explicit auth check of their own — they rely entirely on the ambient
   `(system)/layout.tsx` check. Not exploitable today, but it violates the "contained
   at the data-access boundary, independent of route position" bar SEC-03/SEC-02 set.
   **Owner: SEC-02 workstream (layout/route-position fix).**
2. **Rows #5–7, #10–14** use the service client for reads that are already gated
   by an explicit role check or ambient layout check just above them. They're not
   unsafe, but they're broader than necessary — the RLS-enforced
   `createSupabaseServerClient()` would work identically once the caller's role is
   confirmed, and would shrink the audit surface for this file over time. Left
   as-is for now; revisit if this list grows.
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
