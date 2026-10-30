# ADR-0004: System admins reach a tenant's admin pages only as tenant admin there (N33)

- **Status:** Accepted
- **Date:** 2026-10-30
- **Driver:** N29 (question to Peter), decided by Peter 2026-10-29; built as N33
- **Input:** `src/lib/auth/tenant.ts`, `src/lib/auth/tenant-admins.ts`,
  the RLS convention from migration 0004 (`.claude/CLAUDE.md`)

## Context

Until N33, `system_admin` was a global exception in the app's access checks.
`hasAdminAccessToTenant` and `requireTenantAdmin` returned early for any user
holding a `system_admin` row, before the tenant's `is_active` check and before
the N20 per-tier admin cap. A system admin could therefore open every
tenant's `/<tenantSlug>/admin/...` pages, and call every tenant-admin API
route, by typing the address. Suspended tenants were included, and no role in
the tenant was needed.

Nothing in the specification asked for this. The system admin flow in the
screen documentation ends at SYS-01 → SYS-02. The access came from the code,
as a support convenience, and it was invisible to the customer.

## Decision

A system admin reaches a tenant's admin pages and tenant-admin API routes
**only when they hold a `tenant_admin` row in that tenant**, exactly like any
other admin. The customer is not notified; appearing in their admin list is
enough (Peter, 2026-10-29).

**Support path.** In SYS-02 the system admin grants themselves `tenant_admin`
in the one tenant, does the work, and removes the role afterwards. The grant
is audited as `tenant_admin_granted` and the revoke as `tenant_admin_revoked`.
Post-login routing is unchanged: a user holding both roles still lands on
`/admin` (`ROLE_PRIORITY` puts `system_admin` first) and navigates to the
tenant from there.

The three questions left open on the N33 card were settled as follows.

### 1. App guards only; RLS keeps `is_system_admin()`

Only `hasAdminAccessToTenant` (and through it `resolveTenantForAdmin` and
`getAdminTenant`, which guard every tenant admin page) and
`requireTenantAdmin` (which guards the tenant-admin API routes) change. The
`is_system_admin()` OR clause in tenant-scoped RLS policies stays mandatory.

The SYS screens depend on it. `src/app/(system)/admin/actions.ts` writes
`tier`, `is_active` and `sms_sender_id` through the RLS client as a system
admin, and the SYS-02 tenant detail reads across tenants. Removing the clause
would break those screens, require a migration touching every tenant-scoped
policy, and protect against nothing the app guard does not already stop: a
system admin with direct database access (Frida, Peter) can read the data
regardless.

So this decision protects against mistakes and casual access in the app, not
against the people who run the platform.

### 2. A suspended tenant is closed to every admin

The early return also skipped the `is_active` check, so that a suspended
tenant "stays administrable by a global system_admin so it can be
reactivated". Reactivation never needed the tenant's admin pages: it is done
in SYS-02 (`setTenantActive`), which is gated by `requireSystemAdmin` and is
unaffected. A system admin who has granted themselves `tenant_admin` in a
suspended tenant is now locked out like every other admin. Support
reactivates first, which is itself audited (`tenant_activated`).

### 3. A self-granted system admin counts toward the tier's admin cap

The N20 cap (`MAX_TENANT_ADMINS`: standard 1, premium 3, professional 10)
counts every `tenant_admin` row in order of creation, and the grant RPC
refuses a grant past the cap. A system admin's own row is not exempt.

**Known limit:** on a Standard tenant that already has its one admin, support
cannot grant itself access until the customer's admin is removed. No tenant
in prod is affected today: all three are on Professional (2026-10-14).
Exempting system admins would need a replace migration of the grant RPC and
a change to `listTenantAdmins` (shared with SYS-02's admin list and OFF-01's
promote flow), and would reintroduce a narrow version of the exception this
ADR removes. Revisit with Peter when a tenant first moves to Standard.

## Out of scope: official surfaces

`resolveOfficialSurfaceAccess` (behind `canViewOfficialSurfaces` and the
MYSCH-01 / official screens) keeps its own `system_admin` exception, including
the `is_active` bypass. Peter's decision covers the admin pages. Whether a
system admin should see a tenant's official-facing screens without a role
there is a separate question and has not been asked.

## Consequences

- Typing `/<tenantSlug>/admin/...` as a bare system admin is a 404, and a
  tenant-admin API call is a 403. The e2e access-control spec asserts the 404
  for every admin screen.
- Access becomes a deliberate act, one tenant at a time, recorded in the audit
  log and visible to the customer in their admin list.
- Audit rows written by a system admin acting inside a tenant now carry
  `actor_role = 'tenant_admin'`, because that is the role they act under. The
  preceding `tenant_admin_granted` row ties the person to the support visit.
- Local development: Frida is a global `system_admin` in dev. Testing tenant
  admin pages locally now needs a `tenant_admin` row in the test tenant, or
  signing in as the seeded tenant admin.

## Alternatives considered

From N29, rejected by Peter:

- **A.** Keep today's access with no link from the system admin view.
- **C.** Keep the access, add a link with a "you are in <customer> as system
  admin" banner and an audit entry per visit.
- **D.** Keep the access and add a plain link.

**A standing support role** with access to every tenant and every view was
raised on 2026-10-30. As a permanent role it is the global exception this ADR
removes, under a new name. If the self-grant path turns out too slow in
practice, the shape to consider is time-limited access to one tenant: support
requests it, it expires by itself after a few hours, and it is audited and
shown in the customer's admin list. That would be a new decision for Peter,
not an extension of this one.
