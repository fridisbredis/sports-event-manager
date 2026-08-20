# ADR-0001: When service-role access is permitted, despite C4 saying it never is

- **Status:** Accepted
- **Date:** 2026-08-19
- **Driver:** MNT-04 (`docs/quality-requirements.md`), which requires this
  disagreement to be recorded as an ADR once F-SEC-03's investigation and
  migration made a decision possible
- **Input:** `docs/security/service-role-audit.md` (the full call-site
  inventory this decision is based on)

## Context

`docs/c4/level2-container.mermaid` states, as part of the Next.js app
container's description:

> All data access goes through the server using the authenticated user's
> token per request, so Row Level Security applies; the Supabase service
> role is never used for user-scoped tenant data.

At the time F-SEC-03 was opened, this was false in the code: 48 call sites
across 20 files used `createSupabaseServiceClient()`, which bypasses RLS
entirely. The documentation and the implementation disagreed, and neither
had been reconciled — the C4 diagram was aspirational, not descriptive, and
nothing in the codebase recorded that gap as a deliberate exception versus
an oversight still pending a fix.

Two questions needed answering before this could be closed:

1. Which of the 20 files' service-role use is a genuine constraint (RLS
   mechanically cannot express the check), and which is convenience that
   RLS could replace outright?
2. For the genuine constraints, is C4's blanket statement simply wrong, or
   does it need a narrower, accurate replacement?

## Decision

**C4's statement is corrected, not overruled.** Service role is not "never"
used for user-scoped tenant data — it is used only for four narrow,
named categories, and every other read or write goes through the
RLS-enforced session client (`createSupabaseServerClient()`). The four
categories, matching `docs/security/service-role-audit.md`'s justification
taxonomy:

1. **Bootstrap lookup** — the query determines what role the caller has, so
   RLS (which depends on that same role) cannot gate it. Example: `getUserRoles`/`hasAdminAccessToTenant`/`canViewOfficialSurfaces` in
   `src/lib/auth/tenant.ts`.
2. **Public token-gated flow** — no authenticated session exists yet; the
   security boundary is a single-use, expiring token instead of a session.
   Examples: `src/app/invite/[token]/page.tsx`, the confirm-invite RPCs
   (`0017`/`0018`).
3. **Auth-admin API** — calls into `service.auth.admin.*` (create/delete/
   update a Supabase Auth user), which has no RLS-based equivalent at all.
   Example: the `auth.admin.createUser`/`deleteUser` calls in
   `src/app/api/officials/route.ts`.
4. **Auth-admin-adjacent RPC** — a database function whose whole purpose is
   resolving an identity the auth-admin API doesn't expose a lookup for
   (`get_user_id_by_phone`), called only from the same auth-admin code path
   as category 3.

Everything else — every read of tenant-scoped data once the caller's role
is already established, and every write an already-verified `tenant_admin`/
`system_admin` performs within their own authorized scope — uses the
session client. Where RLS did not yet have a policy to make that possible
(`user_roles`, for the `tenant_admin` official-removal case), the policy was
added (migration `0024`) rather than falling back to the service client.

Corrected C4 language (to be applied to
`docs/c4/level2-container.mermaid` in a follow-up doc change):

> All data access goes through the server using the authenticated user's
> token per request, so Row Level Security applies to nearly all reads and
> writes. The Supabase service role is reserved for four narrow cases where
> RLS cannot apply: role-bootstrap lookups, public token-gated flows with no
> session yet, the Supabase Auth admin API, and RPCs that exist only to
> support that admin API. See `docs/security/service-role-audit.md` for the
> exhaustive, file-by-file list.

## Consequences

**What this fixes:** the 15 call sites (10 reads, 5 writes) that were
service-role for convenience, not necessity, now go through RLS. A missed
application-level check on any of those 15 is no longer, by itself, a
tenant-data exposure — RLS is a second, independent gate.

**What this does not fix, and isn't meant to:** the remaining 5 call sites
(`docs/security/service-role-audit.md`'s "Current service-role call sites"
table — rows #1, #8, #9→#1, #16, #20) still use the service client, by this
decision, permanently. That is not a residual violation to keep chipping
away at; it is the corrected policy. Reviewers should reject a PR that
removes the service client from one of these four categories without also
either adding the RLS/RPC machinery to make it safe (as `0024`/`0025` did
for row #17) or explaining why the category doesn't apply.

**Ongoing obligation:** `docs/security/service-role-audit.md`'s existing
maintenance rule — any PR that adds, removes, or moves a
`createSupabaseServiceClient()` call site must update that table in the
same PR — is how this ADR stays true over time. A new service-role call
site that doesn't fit one of the four categories above is the signal that
either the code is wrong or this ADR needs a follow-up.

## Alternatives considered

- **Migrate all 20 rows, including the cross-tenant/admin-write rows that
  already had an explicit `requireTenantAdmin`/`assertSystemAdmin` check.**
  Rejected as the default posture: category 3 (auth-admin API) has no RLS
  equivalent by construction, so at least one file (`officials/route.ts`)
  was always going to end up split between two clients regardless. The
  four categories reflect where that split genuinely has to happen, not an
  arbitrary stopping point.
- **Leave C4's statement as literally true by migrating everything or
  deleting the service client's remaining callers into a single
  quarantined module.** Rejected: category 3 needs the admin API by
  definition, and forcing category 1 (bootstrap lookups) through RLS is
  circular — the policy that would gate the read depends on the role the
  read exists to determine.
- **Rewrite C4 to drop the RLS claim entirely, rather than narrowing it.**
  Rejected: the current, corrected statement is still materially true and
  useful — it tells a future reader that reaching for the service client
  should be the rare exception, not the default, and names exactly which
  four situations justify it.
