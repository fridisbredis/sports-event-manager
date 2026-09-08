# Integration test patterns

Trello: [MNT-03] Definiera integrationstest-mönster.

> **Naming note:** the Trello card for this work was originally created as
> "MNT-04". `docs/quality-requirements.md` already uses `MNT-04` for a
> different, already-closed requirement ("data access and authorization
> follow one documented pattern", closed via ADR-0001) — the two are
> unrelated. This document instead maps to `MNT-03` in the quality register
> ("Critical business rules have layered test coverage... at unit and
> integration levels"), which is the actual requirement this pattern serves.
> Rename the Trello card to MNT-03 to match.

This document formalizes the pattern already used by the 24 files in
`tests/integration/` (5,676 lines as of 2026-09-08). It doesn't introduce a
new convention — it writes down the one the suite already converged on, so
the next new test (and the next new contributor) follows it on purpose
instead of by copying whichever neighboring file happens to be open.

## Why integration tests exist alongside unit tests

A unit test that mocks a Supabase client or an RPC result proves the
**call site** handles a given shape correctly. It proves nothing about
whether Postgres actually produces that shape, or actually enforces the RLS
policy the code is relying on. Three concrete incidents in this codebase
were only catchable this way:

- **RPC return-shape drift** — migration 0045 rewrote
  `confirm_official_invite_by_phone` and silently dropped the `role_granted`
  key a caller destructured (`SEC-07`, fixed by 0046/PR #123).
  `remove-official-rpc-shape.test.ts` is the pattern this produced: assert
  the literal shape of a real RPC response, not just that the call succeeds.
- **RLS SELECT-before-DELETE gap** — a DELETE policy alone did nothing
  because Postgres never evaluates it if no SELECT policy makes the row
  visible first (`SEC-03`, migration 0024). Only a real DELETE against real
  RLS surfaces this; `information_schema` inspection does not.
- **PostgREST's 1000-row default limit** silently truncating a real result
  set — invisible to any test using a small fixture count.

**Rule of thumb:** if a test's confidence depends on Postgres/PostgREST/RLS
actually doing something — not just on the JS/TS code being called
correctly — it belongs in `tests/integration/`, against a real local
Supabase stack, not mocked.

## Where things live

- `tests/integration/*.test.ts` — the tests themselves
- `tests/integration/helpers.ts` — shared fixture factories (see below)
- `tests/integration/setup-env.ts` — env loading + safety interlocks, runs
  once via `vitest.integration.config.mts`'s `setupFiles`
- `vitest.integration.config.mts` — separate Vitest project from the unit
  suite; `fileParallelism: false` (see "Why serial" below)

Run with the local stack up (`supabase start`):

```bash
supabase status -o env \
  --override-name api.url=SUPABASE_URL \
  --override-name auth.anon_key=SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  > .env.test.local

npx vitest run --config vitest.integration.config.mts
```

## The shape of a test file

Every file follows the same four-part structure. Use an existing file as
the template for the category you're adding — don't write one from scratch:

| You're testing...                                                                                 | Copy the shape of...                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| A new tenant-scoped table's RLS policies                                                          | `tenant-isolation-workstations.test.ts` |
| An RPC's `jsonb` return shape (mandatory per the `replace`-migration rule in `.claude/CLAUDE.md`) | `remove-official-rpc-shape.test.ts`     |
| A cached read helper (`get_*_cached`)                                                             | `get-admin-dashboard-cached.test.ts`    |
| A rate limit or other Postgres-side guard                                                         | `rate-limit.test.ts`                    |
| A cross-cutting service-role→session-client migration                                             | `sec03-write-migration.test.ts`         |

### 1. Arrange — real fixtures, not mocks

Use the factories in `helpers.ts`, never hand-roll auth or tenant setup:

- `createTenant(name)` — inserts a real row via `serviceClient()`
- `createUserWithRole(tenantId, role)` — creates a real `auth.users` row via
  a fixed test-OTP phone number, plus the matching `user_roles` row (and,
  for `'official'`, a `confirmed` `officials` row — required by
  `canViewOfficialSurfaces`, see `.claude/CLAUDE.md`'s official-role memory)
- `createSystemAdmin()` — separate from `createUserWithRole` because
  `system_admin` requires a `null` `tenant_id` (migration 0021's CHECK
  constraint), which the tenant-keyed factory can't produce
- `signInAsClient(phone, '000000')` — signs in via the local
  `[auth.sms.test_otp]` config and returns an anon-key client carrying a
  **real session**. This is the client whose queries RLS actually evaluates
  — never assert against `serviceClient()` when the point is to prove RLS
  behavior, since service-role bypasses RLS entirely.
- `createOfficialLinkedToUser` / `createParticipantLinkedToUser` — for
  policies keyed on `officials.user_id = auth.uid()` /
  `participants.user_id = auth.uid()`

When a test needs tenant-isolation coverage, create **two** tenants (A and
B) and assert both directions: A cannot see/write B's data, and A can still
see/write its own. See `tenant-isolation-workstations.test.ts` for the
canonical two-tenant, two-role (admin + official) fixture layout — it also
covers the "indirection" case where a child table has no `tenant_id` column
of its own and isolation depends entirely on an `EXISTS` join back to a
parent that does.

### 2. Act — call the real thing

Call `.rpc(...)` or `.from(...)` on the **session client** returned by
`signInAsClient`, exactly as the application code under test does. If the
test is verifying an RPC contract, grep the app for `.rpc('function_name'`
first and match how the response is destructured
(`data as unknown as { ... }`) — the test must assert every key the app
reads, not just the keys that happen to be convenient.

### 3. Assert — literal shape, not just success

`expect(error).toBeNull()` alone is not sufficient for an RPC-shape test —
it doesn't fail if a key silently disappears. Assert the full literal shape:

```ts
expect(data).toEqual({ ok: true, user_id: official.userId })
```

For RLS-denial cases, the query still succeeds (RLS filters rows, it
doesn't error) — assert `error` is `null` **and** `data` is `[]`:

```ts
const { data, error } = await clientAdminA
  .from('workstations')
  .select('*')
  .eq('tenant_id', tenantB.id)
expect(error).toBeNull()
expect(data).toEqual([])
```

For a blocked write, also read back through `serviceClient()` to prove the
row is genuinely unchanged, not just that the mutating call returned no rows:

```ts
const { data: unchanged } = await admin.from(...).select(...).eq('id', targetId).single()
expect(unchanged?.field).toBe(originalValue)
```

### 4. Cleanup — always `afterAll`

`cleanupTenant(tenantId)` deletes the tenant row (cascades) and every user
created via `createUserWithRole` for that tenant, freeing their claimed test
phone number. A `system_admin` created via `createSystemAdmin()` belongs to
no tenant, so clean it up explicitly with `deleteAuthUser(userId)` instead.

## Why serial (`fileParallelism: false`)

All test files share one local Supabase/GoTrue instance and a **fixed pool
of 10 test-OTP phone numbers** (`+46700000001`–`...010`, from
`supabase/config.toml`'s `[auth.sms.test_otp]`). Running files in parallel
causes phone-claim collisions. `claimTestPhone` in `helpers.ts` already
handles the harder case — reclaiming a number when the pool is exhausted —
but the pool must stay larger than the max number of distinct users alive
at once across the _whole_ suite, not just one file, since module state
(the `claimedOrder` array) persists across files in the same worker.

## Safety interlocks (don't work around these)

`setup-env.ts` enforces, before any test runs:

- `SUPABASE_URL` must resolve to a loopback hostname
  (`127.0.0.1`/`localhost`/`::1`), refusing to run against dev or prod
  unless `ALLOW_NON_LOCAL_SUPABASE=1` is set explicitly. The suite performs
  destructive, RLS-bypassing service-role deletes (tenant cascades, auth
  user deletes) — this is not a check to bypass casually.
- `NEXT_PUBLIC_SUPABASE_URL` (read by app code under test) must equal
  `SUPABASE_URL` (read by `serviceClient()`), so the fixture client and the
  client under test can never silently address different projects.

If you hit either error, regenerate `.env.test.local` per the command above
rather than hand-editing it.

## Adding a new integration test

1. Confirm it needs Postgres/RLS/PostgREST to be real — if a mock would give
   equal confidence, it's a unit test instead.
2. Pick the closest existing file from the table above and copy its
   structure, not just its imports.
3. Reuse `helpers.ts` factories; add a new one there only if no existing
   factory covers the fixture shape, and document _why_ inline (see
   `createSystemAdmin`'s comment for the level of detail expected).
4. Assert literal shapes and both directions of any allow/deny check.
5. Run the full suite locally (`supabase db reset` first if the change
   touches schema) before opening a PR — not just the new file.
