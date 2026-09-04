# ADR-0003: Caching position for read-heavy pages (PERF-06)

- **Status:** Proposed — draft for discussion, not yet accepted
- **Date:** 2026-09-04
- **Driver:** Trello card PERF-06. Split into three PRs: #106 (bound the
  admin reads that grow with usage), #112 (paginate officials/announcement
  timelines), and this one — the pure decision Trello asked for: a
  documented caching position per read-heavy page.
- **Input:** F-PERF-04 (`docs/quality-requirements.md`) — "no caching of
  any kind — 18 caching matches, all `revalidatePath` after writes, no
  stored caching, no revalidation intervals, no `force-dynamic`. Every
  page renders per request."
- **Citations verified (2026-09-04), against source rather than taken on
  faith:** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md:29`
  confirms the `cookies`/`headers` restriction used at lines 41-44 and
  153; `docs/adr/0001-service-role-vs-session-client.md:38-41` confirms
  the "four narrow, named categories" claim at line ~177;
  `docs/adr/0002-anon-role-default-dml-grants.md:16` confirms the "164
  grant rows" figure at lines ~330 and 409; the F-PERF-04 row in
  `docs/quality-requirements.md` (line 431) matches the quote used above
  near-verbatim; and `tests/integration/rate-limit.test.ts` and
  `tests/integration/perf02-save-assignments-batch.test.ts` both exist as
  cited at line ~413. Re-check only if any of those source files change
  before this ADR moves to Accepted.

## Context

Nobody has decided anything about caching in this app yet. Every one of
the 17 pages that reads tenant- or event-scoped domain data from Supabase
re-fetches on every request, with no exceptions. (This count excludes the
auth/redirect/static pages — `login`, `confirm-invite`, the bare
`dashboard` redirect, the root marketing page, `privacy`, and the
tenant-admin index redirect — and excludes `(system)/admin/health`, whose
one Supabase call is a connectivity probe feeding a status card, not a
domain-data read this ADR's caching model is about.) This ADR is the
first time that gets a documented answer, per page, instead of staying
an unexamined default.

This is being tracked as a security question as much as a performance
one. **A cache sitting in front of Supabase does not inherit RLS.** RLS
enforces row-level tenant isolation on the query Supabase runs; a cache
sits between the request and that query and returns whatever was stored
under the matching key, without re-running the query or its RLS check at
all. If the key used to store or look up a cached result doesn't include
`tenant_id`, two different tenants hitting the same code path can be
served each other's data — a real cross-tenant leak, and one that would
show *no* trace in RLS policy logic, because RLS is never consulted on a
cache hit. So the mechanism decision and the key-shape decision are the
same decision, not two.

**This is worse than "pick a good key" once you look at the actual
constraint — but it is not quite the binary it first looks like.**
Verified against `node_modules/next/dist/docs` (this app is on Next.js
16, per AGENTS.md's warning to check the bundled docs rather than
assume): both `unstable_cache` and its Next 16 replacement, `use cache`,
explicitly forbid reading `cookies()`/`headers()` inside the cached
scope. This project's session-scoped Supabase client
(`createSupabaseServerClient()`) reads the session cookie internally to
authenticate as the calling user, which is what makes RLS evaluate
`get_user_role(tenant_id)` correctly for them. **That client cannot be
called from inside a cached function at all** — that part is a hard
constraint from the framework, not a choice.

What *is* a choice is what runs instead, and there are two materially
different answers, not one:

1. **Service-role client, manual `.eq('tenant_id', ...)` filter, no RLS
   involved.** Simplest to write. If a future edit to the cached
   function forgets the filter, nothing catches it — the read succeeds,
   unrestricted, and the only backstop is a human noticing in review.
   Fail-open.
2. **RLS stays enabled and Postgres-enforced, keyed on an explicitly
   passed tenant context instead of the JWT claim.** Define the Group 1
   tables' policies against `current_setting('app.tenant_id')` (in
   addition to the existing JWT-claim policies), and have the cached
   function call a Postgres RPC that does `SET LOCAL app.tenant_id = $1`
   and queries within that same transaction. If a future edit forgets
   the filter, RLS still blocks the cross-tenant read — the database
   catches it, not a reviewer. Fail-closed. Costs more to build: new
   policies, a transaction-scoped RPC rather than a plain `.from()`
   call through supabase-js.

Either way, the trust boundary moves from "cookie verified by Supabase
auth" to "argument trusted by server code" — that shift is unavoidable
and true under both options, since neither can read the cookie inside
the cache. What differs is only whether a mistake in the calling code
fails open or fails closed. This ADR is explicit about which of the two
it picks and why, rather than defaulting to the simpler one silently.

### The 17 pages, grouped by what actually matters for caching

Grouping by table name doesn't tell you anything useful here — grouping
by **how often the data changes vs. how often it's read**, and **what it
costs to show a stale result**, does:

**Group 1 — stable data, read constantly.** Event setup, once published,
barely changes: `admin/event`, the `admin/workstations` list page, the
official-facing `event-info` page (which every official loads, repeatedly,
especially on event day), and official `home` (HOME-01) — every official
lands here on login and bounces back to it constantly through the day,
the same read-frequency pattern as `event-info`, and its own reads (the
official's confirmed name, the event's name) are exactly as stable. This
is the strong candidate set: high read volume, low write frequency, and a
stale read costs nothing worse than a UI showing last week's venue note
for a few extra minutes.

`admin/workstations/[workstationId]` and `admin/workstations/new` are
excluded from this group despite living under the same route family as
the list page above: they're single-admin write forms — pages that exist
to produce a write, not to be read repeatedly — the same reasoning this
ADR already applies below to exclude pre-publish `admin/dashboard`.
They're placed in Group 3 instead.

**Group 2 — correctness-sensitive, must not go stale carelessly.**
`admin/scheduling` and both announcement pages (`admin/communication`,
official `announcements`), `schedule` (MYSCH-01), and `admin/officials`
(OFF-01). A stale schedule read can put an official at the wrong
workstation. A stale announcement read can mean a real-time message never
reaches someone. A stale `admin/officials` read can mean an admin acts on
an out-of-date invite/confirm status — messaging someone who already
confirmed, or scheduling someone who hasn't — and that page is written to
on every invite, edit, and confirmation (including the SMS-fallback
invite-confirm flow), so its write frequency doesn't fit Group 1's
"barely changes" profile either. These already got throughput work in
#106/#112 (bounded per-day reads, pagination) — that work stands on its
own and isn't superseded by this ADR. The question here is caching
specifically, and the answer for this group is different from Group 1
because the cost of being wrong is different in kind, not just degree.

**Group 3 — low traffic, not worth the complexity.** System admin pages
(`(system)/admin`, `(system)/admin/[tenantId]`), `account` pages (both
official and admin), `invite/[token]`, and the two workstation write
forms excluded from Group 1 above (`admin/workstations/[workstationId]`,
`admin/workstations/new`). Single-digit users hit most of these, or hit
them once; the workstation forms are single-admin-at-a-time and read once
per edit session. Caching buys nothing measurable here. (Whether
system_admin's cross-tenant `tenants` list page needs a different
tenant-scoping story is a question about that page's own row-level
access model, not a caching one — a page this ADR never caches has no
cache-key tenant-scoping question to resolve, so it's out of scope here.)

`admin/dashboard` sits between groups: already got the auth-memoization
fix (F-PERF-07), reads `events`/`officials`/`event_stages` per render,
and gets refreshed often by admins during setup. Treated as Group 1 once
an event is published (its own reads are the same setup-phase data), but
not before — during active setup, admins expect their own edits to show
up on the next load, so the cache would need write-triggered invalidation
from day one, not a time-based revalidation window.

## Decision

**Group 1 pages get cached; Group 2 and Group 3 pages do not, and the
"do not" is a decision, not an oversight — written here so nobody
"fixes" the gap later without re-reading why.** `admin/dashboard` joins
Group 1's cached set only once its event is published; pre-publish it is
not cached, per the write-triggered-invalidation reasoning in Context —
an implementer reading only this Decision section should not cache it
unconditionally.

**Mechanism: Next.js `unstable_cache`, wrapping a Postgres RPC that
enforces RLS via an explicitly-set session variable, invoked with the
service-role client but designed so that client's `BYPASSRLS` never
takes effect — despite `unstable_cache` itself being deprecated.**
`unstable_cache` is officially superseded by the `use cache` directive in
Next 16, per the version note in `node_modules/next/dist/docs`. We are
deliberately not adopting `use cache` for this decision: it requires
setting `cacheComponents: true` in `next.config.ts`, which is not a
per-page opt-in — it changes rendering behavior for the entire app
(Partial Prerendering becomes the default, dynamic APIs are restricted
outside explicit boundaries, client-side navigation switches to React's
`<Activity>` model). **We will not turn on `cacheComponents` — that would
affect the whole app**, and it is far outside what Trello scoped as
PERF-06. `unstable_cache` still works, unremoved, on plain Next 16 with
no config change. Migrating to Cache Components is left as a separate,
future decision, not bundled here — if it happens, this ADR's per-page
caching positions are what carry over, just on a different primitive.

Not the `fetch` cache either (Supabase's JS client doesn't route through
`fetch` in a way Next.js's cache can key on), and not React's `cache()`
(that's per-request de-duplication only — F-PERF-07 already uses it for
auth, but it never persists across requests, so it can't reduce database
load the way this ADR needs).

**On the RLS posture: fail-closed, not fail-open.** The service-role
client is the only one that can run inside a cached function without
touching `cookies()` (the anon client would work too, but it can't be
granted `EXECUTE` on the RPC without also opening it to every browser —
see below), and it carries `BYPASSRLS` at the Postgres role level, which
is exactly the property ADR-0001 spent an audit narrowing to four named,
genuinely-necessary categories. Using it as a plain client — a `.from()`
call, or an RPC that runs as whatever role invoked it — for caching
convenience rather than a genuine constraint, is the kind of case
ADR-0001's own framework ("is this a real constraint or something RLS
could replace?") would reject. So this ADR does not let `service_role`'s
privileges reach the query at all: Group 1 reads instead go through:

- A new RLS policy per Group 1 table, additive to the existing
  `0004`-convention policies, scoped `TO <definer_role>` — the RPC's
  dedicated definer role, not `PUBLIC` — permitting `SELECT` when
  `current_setting('app.tenant_id', true) = tenant_id::text`. The
  `true` second argument makes `current_setting` return `NULL` instead
  of erroring when unset — which fails the comparison and denies by
  default, rather than erroring open. This is the first RLS policy in
  the schema whose `USING` clause never references the JWT, so it
  doesn't get the implicit narrowing a JWT-scoped policy gets "for
  free" from `auth.uid()`/`auth.role()` — without an explicit `TO`
  clause it defaults to `PUBLIC` and would also be evaluated for
  `anon`, which holds direct `SELECT` grants on these tables per
  `supabase/seed.sql`.
- A Postgres RPC (matching this project's existing RPC-based-write
  convention) that runs
  `perform set_config('app.tenant_id', p_tenant_id::text, true)` — with
  `p_tenant_id` declared `uuid`, not `text` — and the read, inside the
  one transaction PostgREST already wraps every RPC call in, then
  returns `jsonb` per this project's RPC return-shape convention. The
  third argument to `set_config` **must** be `true` (transaction-local,
  `is_local`): `SET app.tenant_id = $1` isn't valid plpgsql for a bound
  parameter in the first place, and even a correct `set_config` call
  with `false` (or omitted) makes the GUC session-scoped instead — on a
  pooled PostgREST/Supavisor connection that means it survives into
  later, unrelated requests on the same connection and misapplies
  tenant scoping there. The function is `SECURITY DEFINER`, owned by a
  dedicated role with `NOBYPASSRLS` — never the table owner — so that
  RLS is evaluated against that low-privilege owner regardless of which
  client (here, `service_role`) actually calls it. It must also set
  `search_path = ''` with every object reference schema-qualified,
  matching migration 0040's pattern — every other `SECURITY DEFINER`
  function in this project's migrations (0017, 0018, 0022, 0026-0030,
  0043, 0045, 0046) pins `search_path`, and an unpinned one on a
  `SECURITY DEFINER` function is a privilege-escalation vector via
  object shadowing. (0033 is `SECURITY INVOKER`, not `DEFINER` — it does
  not belong in this list; an earlier draft miscited it.) See the
  verification below for why this step is load-bearing, not optional.
- The cached function calls this RPC, explicitly through the
  service-role client, with the explicit `tenantId` argument — same
  `unstable_cache` shape as before, different backing call:

```ts
unstable_cache(
  async (tenantId: string) => {
    // Must be the service-role client: the anon client can't reach this
    // RPC (grant excludes it, see below), and the session-cookie client
    // can't run inside unstable_cache at all (see Context above).
    // Safe here only because the RPC is SECURITY DEFINER owned by a
    // NOBYPASSRLS role — service_role's own BYPASSRLS never applies.
    // .rpc() resolves { data, error }, not the row data itself — every
    // other .rpc() call site in this project destructures and checks
    // error (see src/lib/auth/tenant.ts, src/lib/rate-limit.ts). Skipping
    // that here would let a Postgres-level error get cached as a
    // "successful" result for the full revalidate window below.
    const { data, error } = await supabaseServiceRole.rpc('get_event_info_cached', { tenant_id: tenantId })
    if (error) throw error
    return data
  },
  ['event-info'],           // cache namespace, data-shape only — NOT
                            // tenant-scoped; tenant scoping here comes
                            // entirely from the `tenantId` closure
                            // argument reaching both the RPC call above
                            // and the `tags` array below
  {
    tags: [`tenant-${tenantId}-event-info`], // scoped per tenant AND per
                            // data shape — a write to a different Group 1
                            // table (e.g. workstations) must not flush
                            // this entry; see Invalidation below
    revalidate: 60,         // required, not tuning left open: bounds
                            // staleness at 60s on a replica that a
                            // write's revalidateTag didn't reach (see
                            // Consequences and Alternatives — Redis),
                            // without meaningfully increasing DB load
                            // for data that changes on the order of
                            // minutes, not seconds
  }
)(tenantId)
```

**This only stays fail-closed if the RPC itself cannot be called
directly by an arbitrary client, and if the role that *does* call it
still gets RLS enforced against it.** The whole mechanism trusts the
`tenant_id` argument — that's unavoidable, per the Context discussion
above — but that trust is only sound when the argument comes from this
project's own server code, never from a request the RPC can't
independently verify. Supabase RPCs are callable over PostgREST by
whichever Postgres role can `EXECUTE` them, and the anon key is public
(shipped to every browser) — so if this RPC is left callable by `anon`
or `authenticated`, anyone holding that key could call it with any
`tenant_id` and read another tenant's Group 1 data with no session at
all, RLS notwithstanding, because the policy would then judge the
attacker's own supplied value as legitimate. Per this project's own
"Supabase RPC guard conventions" (grants control callability; a Zod
guard in application code doesn't stop a direct call), **the RPC's
`EXECUTE` grant must exclude `anon` and `authenticated`.** Two weaker
patterns already exist elsewhere in this repo's migrations and neither
is sufficient alone: `revoke ... from anon, authenticated` alone leaves
the default `PUBLIC` grant that `CREATE FUNCTION` issues in place, and
`revoke ... from public` alone leaves Supabase's automatic per-role
grants in place — this already re-exposed `check_rate_limit`,
`get_last_sign_in_at`, `anonymize_inactive_users`, and
`claim_sms_queue_batch` to `anon` once, per `supabase/seed.sql`. The
mandated form, matching migration 0026's reference pattern, is both
statements together:

```sql
revoke all on function public.get_event_info_cached(uuid) from public, anon, authenticated;
grant execute on function public.get_event_info_cached(uuid) to service_role;
```

That alone isn't sufficient, and an earlier draft of this ADR missed why:
the cached function can't use the session-cookie client (see Context
above), so it has to reach this RPC through the **service-role client**
instead — anon can't call it once the grant above is in place, so no
other client is available from inside `unstable_cache`. But `service_role`
carries `BYPASSRLS` by default in Supabase (`rolbypassrls = true`,
confirmed by direct query against the local instance — see below), which
means a plain `set_config('app.tenant_id', ..., true)` + `SELECT`
invoked as `service_role` would skip the new RLS policy entirely: the policy would
never even be evaluated, and the "fail-closed" design would silently
degrade into the fail-open one this ADR explicitly rejected.

**Fix: the RPC must be `SECURITY DEFINER`, owned by a dedicated role that
has `NOBYPASSRLS`.** `SECURITY DEFINER` on its own does nothing — it only
matters *combined with* the owner's role attributes, since Postgres runs
the function's RLS checks as `current_user`, which becomes the owner for
the duration of the call. Owning it by a role that still has `BYPASSRLS`
(the obvious mistake: `postgres` is the default local-dev connection role
and it has `BYPASSRLS = true` too) reproduces the exact leak this design
exists to close — see the empirical proof below. `EXECUTE` is then
granted to `service_role` only (still excluding `anon`/`authenticated`),
and the definer role needs an explicit `GRANT SELECT` on the table —
`SECURITY DEFINER` changes whose *identity* a check runs as, it does not
grant privileges by itself.

`FORCE ROW LEVEL SECURITY` on the table stays **mandatory**, but not for
the reason an earlier draft of this section gave. It is not "load-bearing
for correctness today" — the definer role never owns the table under
this design, so the flag changes nothing while that invariant holds, and
disabling it in testing proved exactly that and nothing more. Its real
job is to be **the backstop that turns a future ownership mistake into
an ordinary RLS-enforced no-op instead of a silent cross-tenant leak.**
Nothing in Postgres enforces "the definer role must never also own this
table" — that's an assumption a later migration could break without
anyone noticing (e.g. reassigning the RPC to a role that provisioning
convenience later makes the table owner too). Without `FORCE ROW LEVEL
SECURITY`, that mistake fails open. With it, the same mistake still gets
caught by RLS. Keep it in the reviewable checklist as required, not as
optional hardening — "not required today" is exactly the framing that
gets a checklist item quietly stopped being enforced.

**Verified empirically against the local stack (2026-09-04), including
attempts to disprove it, not just the version that was expected to
work** — matching ADR-0002's "direct SQL query, not an assertion" style:

- `select rolname, rolbypassrls from pg_roles where rolname in
  ('anon','authenticated','service_role','postgres')` confirms
  `service_role` has `rolbypassrls = true`; so does `postgres`, the
  default local-dev connection role — a fact that matters below.
  `anon`/`authenticated` do not.
- Built a throwaway table (two tenants, one row each) and the RLS policy
  from this ADR, then tested three RPC variants over the real REST
  endpoint (`/rest/v1/rpc/...`, not a local `psql` shortcut — the same
  path the app's client uses), all called with the service-role key
  requesting tenant A only:
  1. **Plain RPC, no `SECURITY DEFINER`** — leaked both tenants' rows.
     Confirms the danger is real, not hypothetical: `service_role`'s
     `BYPASSRLS` really does skip the policy entirely when nothing
     changes the executing role.
  2. **`SECURITY DEFINER`, owned by `postgres`** (which also has
     `BYPASSRLS`) — **also leaked both tenants' rows.** This disproves a
     weaker version of the fix: `SECURITY DEFINER` alone accomplishes
     nothing. It only removes the leak when the owner specifically lacks
     `BYPASSRLS`, and `postgres` — the connection role most people reach
     for by default — does not qualify. Note also that `postgres` is
     neither `service_role` nor the table's owner, so "not `service_role`"
     and "not the table owner" are not, by themselves, sufficient checks
     either — see rule 2 below.
  3. **`SECURITY DEFINER`, owned by a dedicated `NOBYPASSRLS` role** —
     returned only tenant A's row. This is the design this ADR requires.
  - Also tested: disabling `FORCE ROW LEVEL SECURITY` on the table and
    re-running variant 3 — no change, still correctly scoped while the
    non-ownership invariant holds. This confirms the flag isn't
    compensating for an existing bug today; it says nothing about
    whether it's needed as a backstop against a future one, which is why
    it stays mandatory above rather than becoming optional.
  - **Anon key tested against all three variants, not just the fix** —
    identical `42501 permission denied for function` (HTTP 401) on the
    plain RPC, the `postgres`-owned definer, and the fixed variant alike.
    This confirms the `EXECUTE`-grant check and the RLS-posture check are
    genuinely independent controls: a broken RLS posture (variants 1 and
    2) does not also weaken the grant exclusion, and a correct posture
    doesn't mask a grant mistake either. Both must be checked; neither
    stands in for the other.
  - One real mistake the test itself surfaced along the way: the first
    run of variant 3 failed with `permission denied for table` because
    the definer role had no `SELECT` grant on the table yet — `SECURITY
    DEFINER` changes whose identity a check runs as, it does not supply
    privileges. Confirms the grant must be explicit, not implied.

The rule a reviewer can actually check, either way:

0. The `tenantId` passed into any cached Group 1 function must be the
   return value of an authorization-checked resolver — this project's
   `getAdminTenant`/`getOfficialTenant` pattern in
   `src/lib/auth/tenant.ts` — never an unauthenticated slug lookup
   (`resolveTenantBySlug`) and never a raw `params.tenantSlug` taken
   straight from the URL. Once the value reaches the RPC, RLS only
   checks that the value is internally consistent — it has no way to
   check *who* supplied it. Group 1 reads therefore depend on two
   enforcement layers, this caller-side check and the RLS policy above,
   not on RLS alone; that's worth stating explicitly rather than
   leaving implicit.
1. `tenant_id` must be a literal argument passed into the cached
   function and the RPC — never read from a cookie, session, or ambient
   context *inside* either (it can't be, inside the cached function —
   see Context above — and the RPC has no session to read from
   regardless). This prohibition is scoped to inside the cached
   function and the RPC themselves; it does not prohibit, and in fact
   presumes, the caller-side authorization check in rule 0 above that
   produces the argument in the first place.
2. **Check the definer role's `rolbypassrls` directly — do not infer
   safety from `SECURITY DEFINER`'s presence, from the owner not being
   `service_role`, or from the owner not being the table owner.** All
   three are proxies that the `postgres`-owned variant above satisfies
   while still leaking. The actual check:
   `select rolbypassrls from pg_roles where rolname = '<definer_role>'`
   — must return `false`, full stop.
3. The underlying table must have `FORCE ROW LEVEL SECURITY` set. Not
   optional: see above for why this is a backstop against a future
   mistake, not a fix for a bug in the current design.
4. The RPC's grants must be checked directly with SQL (`\df+` /
   `information_schema.routine_privileges`, matching ADR-0002's
   verification style) to confirm `anon`/`authenticated` cannot execute
   it and `service_role` can, and an integration test (per this
   project's convention for exactly this class of risk — see the
   `perf02` batch tests and `rate-limit.test.ts`) should assert three
   things, not two: calling it with the anon key returns a permission
   error; calling it with the service-role key and one tenant's id never
   returns another tenant's rows; and that second assertion specifically
   must run against the RPC as actually deployed (owner and all), not a
   mocked or simplified stand-in — the `postgres`-owned variant above
   would pass a naive version of this test that only checks "did it
   error," since it returns `200` with data, just the wrong data. The
   verification set must also include three tests a single isolated
   call cannot surface:
   a. a **sequential** test — call the RPC for tenant A, then issue a
      second, unrelated request on a connection likely to be reused
      from the pool, asserting no leakage of tenant A's
      `app.tenant_id` setting into that second request (the primary
      failure mode if the GUC is ever set session-scoped instead of
      transaction-local, see rule 5);
   b. an **anon-key `SELECT` directly against the Group 1 table** while
      `app.tenant_id` is set on that same connection, asserting zero
      rows returned — the anon-key test above only proves the
      function-grant path denies `anon`, not that `anon` is denied
      direct table access while the GUC happens to be set;
   c. the "as actually deployed" requirement extended beyond the
      definer's ownership to also cover the grants, the policy's `TO`
      clause, and `search_path` — model all three tests on the existing
      `tests/integration/tenant-isolation-*.test.ts` suite.
5. The GUC must be set transaction-locally, not session-scoped —
   verified by reading the function body for
   `set_config('app.tenant_id', p_tenant_id::text, true)` with the
   third argument literally `true`. A bare `SET app.tenant_id = ...` or
   a `false` third argument survives past the transaction on a pooled
   connection and misapplies tenant scoping to a later, unrelated
   request.
6. The function must set `search_path = ''` with every object
   reference schema-qualified, matching migration 0040 — not left
   unpinned, which on a `SECURITY DEFINER` function is a
   privilege-escalation vector via object shadowing.
7. `tenantId` must participate in both the `unstable_cache` key (as a
   serialized argument or an explicit `keyParts` entry) and the
   `revalidateTag` tag, verified at the call site — so a future
   refactor that moves `tenantId` out of the arguments doesn't silently
   collapse the cache to one shared entry across all tenants.

Invalidation: `revalidateTag` scoped per tenant **and** per data shape —
never a bare `revalidatePath` or an untagged `revalidateTag` that would
cross tenants, cross data shapes, or force-refresh data this ADR didn't
ask for. Concretely: a write to `events`, `event_stages`, or
`event_facilities` invalidates `tenant-${tenantId}-event-info` only; a
write to `workstations` invalidates that page's own
`tenant-${tenantId}-workstations` tag only. A workstation edit does not
flush the cached event-info entry, and vice versa — each Group 1 data
shape gets its own tag precisely so one table's write frequency can't
degrade another table's cache hit rate.

**Revalidation window is a required parameter of this decision, not an
implementation detail:** every Group 1 cache entry also carries
`revalidate: 60` (see code sample above). This sets the maximum
staleness this ADR accepts for a Group 1 read served from a replica that
a write's `revalidateTag` call didn't reach — see Consequences and
Alternatives (Redis) for why that gap exists on the current stack, and
Not yet decided for the deploy-window edge case it interacts with.

Group 2 and Group 3 pages: no caching. Group 2's existing per-request
render is the correct behavior, not a gap — restated here so this ADR is
the answer if the question comes up again. Group 3 is simply not worth
building the invalidation wiring for.

## Consequences

**What this fixes:** removes the "every page hits the database, always,
forever" default for the pages where that default was pure waste — data
that barely changes, requested over and over by every official during an
event.

**What this doesn't change:** Group 2's request-per-load behavior stays
exactly as #106/#112 left it. Nothing about this ADR requires touching
`admin/scheduling` or the announcement pages again.

**What this costs:** every Group 1 read moves from the session-scoped
client to a dedicated RPC, plus a new RLS policy per table, plus the
grant-isolation verification described above. This is more setup than
reaching for the service-role client would have been — that's the
trade this ADR makes deliberately: RLS stays the Postgres-enforced
backstop for Group 1 reads exactly as it is for every other read in the
app, rather than becoming a category this ADR carves an exception into.
The cost is paid once per data shape — four shapes for the four Group 1
pages (`admin/event`, the `admin/workstations` list, `event-info`,
`home`), plus a fifth for `admin/dashboard` once it's published — not
once per call site. None of the four collapse into a shared shape:
`admin/event` is the only one that joins `event_distances` and reads the
admin-editable `events` columns (`status`, `scheduling_granularity_min`,
`logo_url`); `admin/workstations` is the only one that touches
`workstations`/`workstation_operating_windows` at all; `event-info` reads
a read-only subset of `events` plus `event_facilities` but neither
`event_distances` nor `workstations`; and `home` doesn't query
`event_stages`, `event_distances`, `event_facilities`, or `workstations`
at all — it reads the `officials` table (filtered to the caller's own
confirmed row) and only the event's `name`.

**Precondition for implementation, not for accepting this ADR:**
measured 2026-09-04 against the local stack — `supabase start`,
`npm run build && npm start` (not `next dev`, whose on-demand compilation
would land in the p95), `npm run seed:perf` (5 tenants), then
`npm run perf:measure -- --baseline` (90 signed-in sessions, 30 serial
samples per path). Unloaded baseline for `event-info` — the reference
case named above — is p50 70.8 ms, p95 112.4 ms.
`admin/dashboard` was measured incidentally by the same harness run: p50
85.2 ms, p95 136.1 ms. (The harness's other two paths, `scheduling` and
`own-schedule`, are Group 2, not additional Group 1 data.)

Read this result with the same caveats the harness prints: it's a local
stack, unloaded number, not a prod figure, and no loaded/300%-ceiling
comparison was run — that needs the dedicated perf environment, which
this precondition doesn't require. It also doesn't cover `admin/event`
or the `admin/workstations` list, which aren't in the harness's
`READ_PATHS` at all, nor `home` (HOME-01). No "isn't repaid" threshold
was ever stated for this check, and 112 ms unloaded on a page every
official loads repeatedly through an event day doesn't read as a page
that belongs in Group 3 instead. So this result is taken as confirming
the Group 1 candidate set as specified above, not as grounds to move
anything out of it. If a future measurement (e.g. once `admin/event` or
`admin/workstations` exist in the harness, or a loaded run against the
perf environment) shows read volume or latency low enough that the RPC +
RLS-policy + cache-invalidation build cost above isn't repaid for a given
page, that page should move to Group 3 instead — this is the same escape
hatch already stated under Ongoing obligation below, not a new one.

**Ongoing obligation:** any new page added to Group 1 in the future (or
any existing page whose data changes from "stable" to "changes often")
follows the same `unstable_cache` + session-variable-RLS RPC + tagged-
`revalidateTag` contract above — never a plain service-role `.from()`
call that lets `BYPASSRLS` reach the query directly, per the ADR-0001
reasoning above. A cached read wrapping a `tenant_id` argument without a
corresponding `current_setting`-based RLS policy on the underlying
table, a table missing `FORCE ROW LEVEL SECURITY`, an RPC that isn't
`SECURITY DEFINER` owned by a role verified (by direct SQL query against
`pg_roles.rolbypassrls`, not inference) to have `NOBYPASSRLS`, or an RPC
whose `EXECUTE` grant hasn't been verified to exclude
`anon`/`authenticated`, is a defect, full stop — this ADR is the
reference for why. Before adding a new Group 1 page, weigh whether
its data is sensitive enough that the extra setup isn't worth it for
that page's traffic — if the RPC/policy overhead doesn't pay for itself,
the page may belong in Group 3 instead of Group 1.

This obligation also covers *replacing* the RPC, not just adding a new
page. `create or replace function` preserves existing grants, but a
migration that instead does `drop function` + `create function` does
not — it silently restores the default `PUBLIC` execute grant plus
Supabase's automatic per-role grants, re-opening the RPC to `anon` with
no error at migration time. Any migration that drops and recreates this
RPC must re-issue the exact revoke/grant pair above, and the grant
assertion from the verification above must run in CI on every migration
that touches this function — not only when a new Group 1 page is added.

**The integration test's assertion shape is part of this obligation, not
an implementation detail left to whoever writes it:** it must assert
that another tenant's data is *absent* from the response, not merely
that the call succeeded or returned no error. "Calling it with the
anon key returns a permission error" is a valid no-error-shaped
assertion because denial *is* the correct behavior there — but for the
service-role/cross-tenant case, "no error" is not evidence of anything:
a `SECURITY DEFINER` RPC owned by a role that still has `BYPASSRLS`
returns `200` with a real payload, just one containing every tenant's
rows instead of one. A test that only checks the call didn't throw would
pass against that broken RPC. The test must fetch as tenant A and assert
tenant B's row is not present in the result — not just that a row for
tenant A is.

**Known limitation of the chosen resolution — same-tenant staleness, not
a cross-tenant leak:** because there's no shared `cacheHandler` (see
Alternatives — Redis), `revalidateTag` only clears the replica that
served the triggering write; the other replicas keep their existing
entry until it naturally expires. This interacts with deploy mechanics
too: during a prod deploy's single-revision overlap window — several
minutes, not seconds, per this project's documented deploy-window
ordering guarantee — a withdrawn or corrected Group 1 edit can keep
being served from another replica, or from the outgoing revision, until
the bounded `revalidate: 60` window expires. This is bounded and
same-tenant only, but it is a real, named gap in the chosen resolution,
not an oversight.

**Not yet decided / open for the follow-up conversation:** whether
`admin/dashboard` needs a setup-phase/published-phase split in code or
just documentation.

## Alternatives considered

- **Cache everything, including Group 2, with a very short TTL.**
  Rejected: a short TTL doesn't remove the correctness risk, it just
  narrows the window an official could see a stale schedule or miss an
  announcement. The failure mode is binary (wrong workstation / missed
  message), not something a shorter window makes proportionally safer.

- **Use the `fetch` cache Next.js provides natively.** Rejected: only
  applies to calls that go through the global `fetch` Next.js patches at
  build/runtime. Supabase's JS client does use `fetch` under the hood,
  but not in a way this project can reliably attach cache tags or
  tenant-scoped keys to without reaching into client internals — more
  fragile than an explicit `unstable_cache` wrapper at the call site.

- **An external cache (Redis) instead of Next.js's built-in Data
  Cache.** Prod actually runs 2–3 replicas (`deploy-prod.yml`'s
  `--min-replicas 2 --max-replicas 3`), and `next.config.ts` sets
  `output: 'standalone'` with no `cacheHandler` configured — so
  `unstable_cache`'s Data Cache is per-replica, in-process, not shared.
  Two consequences follow directly: (a) each Group 1 cache entry is
  populated independently per replica the first time that replica
  handles a request for it, so the DB-load reduction this ADR delivers
  is smaller than "removes the every-page-hits-the-database default"
  implies — the RPC still runs once per replica per data shape, not once
  total; (b) `revalidateTag()` on a write only clears the replica that
  handled that write, so the other 1–2 replicas keep serving the
  pre-write entry until it naturally expires or that replica happens to
  handle a future write to the same tag (see Not yet decided for the
  deploy-window version of this gap). **Resolution for now: accept
  per-replica caching, bounded by the explicit `revalidate: 60` window
  on every Group 1 entry (see code sample and Invalidation above),
  rather than adopting a shared `cacheHandler` or an external cache
  immediately.** This is a deliberate trade-off, not a measured one —
  it avoids taking on an infra dependency before Group 1's read volume
  is shown to justify it, consistent with this ADR's existing
  "revisit later" posture, and it remains open for sign-off since this
  ADR is Proposed, not Accepted. If the bounded staleness window proves
  unacceptable in practice, or Group 1's read volume outgrows what
  per-replica caching buys, the concrete revisit path is a shared
  `cacheHandler` (Next.js's supported mechanism for a cache shared
  across replicas) or an external cache such as Redis — not expected
  before the Viadal-scale baseline in `docs/quality-requirements.md`.

- **Do nothing — leave every page uncached, as today.** Rejected: this
  is what F-PERF-04 already flagged as an open gap. "No decision" is
  itself the decision this ADR replaces.

- **Service-role client with a manual `.eq('tenant_id', ...)` filter,
  no RLS involved (fail-open).** The initial draft of this ADR proposed
  exactly this, before the trade-off was named explicitly: simpler to
  build (no new policies, no RPC, a plain `.from()` call through
  supabase-js), but a missing filter in a future edit is a cross-tenant
  read that Postgres itself does nothing to stop — caught only by code
  review, if at all. Rejected in favor of session-variable RLS because
  this project already treats "RLS is the enforced boundary, defense in
  depth on top of it" as a project-wide posture (CLAUDE.md's Security
  section, ADR-0001), and because ADR-0001's own framework — is this a
  genuine constraint or something RLS could replace? — would not accept
  "caching convenience" as a reason to bypass RLS. Revisit only if the
  session-variable RPC approach turns out to be materially harder to
  implement safely than expected; if so, that should be its own
  follow-up decision; not a silent fallback.

- **Adopt Cache Components (`cacheComponents: true`) and use `use
  cache` instead of the deprecated `unstable_cache`.** Rejected for this
  ADR: the flag is app-wide, not per-page — it changes default rendering
  behavior (Partial Prerendering, dynamic-API restrictions, Activity-based
  navigation) for every route, not just the 17 pages this ADR assigns an
  explicit caching position to. That's a framework-migration-sized decision
  Trello never scoped into PERF-06. Explicitly deferred, not dismissed — if this project
  adopts Cache Components later for other reasons, this ADR's per-page
  grouping (Group 1/2/3) still applies; only the primitive changes.
