# Migrations & data model reference

> Read this before writing, reviewing, or reasoning about any migration or RPC change. Not loaded into every session by default — see the pointer in the core `CLAUDE.md`.

---

## Data model (Supabase Postgres)

All tables have RLS enabled. Tenant isolation is enforced via RLS policies that check `tenant_id` against the requesting user's `user_roles` rows.

```
tenants
  id (uuid, PK)
  name (text)
  slug (text) — used in URL paths like /[tenantSlug]/dashboard
  is_active (boolean)
  tier (text) — likely 'free', 'paid', etc., used with feature_flags
  feature_flags (jsonb)
  created_at (timestamptz)

user_roles  — join table connecting Supabase Auth users to tenants
  id (uuid, PK)
  user_id (uuid) — references auth.users(id)
  tenant_id (uuid, nullable) — references tenants(id); null only for system_admin rows
  role (text) — 'system_admin' | 'tenant_admin' | 'official' | 'participant'

events
  id, tenant_id, name, event_type, start_date, end_date,
  location, description, logo_url, created_at

officials
  id, tenant_id,
  user_id (nullable — null until they sign up via SMS invite),
  name, phone, invite_status, created_at

participants
  id, tenant_id,
  user_id (nullable — same pattern as officials),
  name, phone, bib, category, race_results_url, created_at

assignments
  id, tenant_id, official_id, workstation,
  timeslot_start, timeslot_end, todo, created_at

announcements
  id, tenant_id, channel ('officials' | 'participants'),
  body, sms_sent, published_at, created_at
```

**Resolved (migration 0021):** `system_admin` is a global role — `tenant_id` is nullable and set to `null` for `system_admin` rows. A check constraint requires `tenant_id` for every other role. `is_system_admin()` and the app-level auth helpers in `src/lib/auth/tenant.ts` already ignored `tenant_id` for this role, so no RLS or app-code behavior changed.

(For the RLS policy convention itself — the mandatory `is_system_admin()` OR clause pattern — see the core `CLAUDE.md`; it applies broadly enough to stay there rather than here.)

---

## Migration naming (changed 2026-09-08)

`supabase/migrations/` currently holds 58 files numbered `0001`–`0060`
(there's a gap — `0056`/`0057` were never used) using sequential
`00NN_description.sql` names. **Starting with the next migration written
after this convention lands, migrations use the Supabase CLI's own
timestamp format instead: `YYYYMMDDHHMMSS_description.sql`.** This is a
forward-only change — the existing `00NN` files keep their names
permanently and are never renamed. (Deliberately not naming a specific next
number here — see the ordering rule below for why picking one in advance
doesn't work with two people merging in parallel.)

Renaming an already-applied migration file is not just a style change: the
CLI matches a file's version prefix against the rows already recorded in
`supabase_migrations.schema_migrations` on dev and prod. Renaming an
applied file makes the CLI treat it as a new, unapplied migration and try
to run it again. This is the same class of mismatch as the F-REL-09 schema
drift incident, so the old files are left alone rather than "cleaned up."

The reason for the switch: sequential integers collide when two people
create migrations in parallel — whoever merges second has had to manually
renumber past the other's file. Timestamps at second resolution don't
collide in practice, so `supabase migration new <name>` (used as-is, no
manual renumbering) is sufficient going forward.

**Ordering hazard this introduces — read before merging the first
timestamped migration.** `supabase db push` (invoked without
`--include-all` in both `deploy-dev.yml` and `deploy-prod.yml`) compares
each local migration's version string against the highest version already
recorded in that environment's `schema_migrations` and will not apply one
that sorts lower. Every `YYYYMMDDHHMMSS` prefix (starts with `2`) sorts
above every `00NN` prefix (starts with `0`). So: once the first timestamped
migration has been pushed to an environment, any `00NN` file merged after
that point is permanently stuck below the ceiling in that environment's
ledger — not a merge-order annoyance you retry past, since the filename
comparison never changes. The only ways out at that point are renumbering
the stranded file to sort above the ceiling (renaming a file not yet
applied anywhere is fine) or pushing with `--include-all`, which bypasses
the same ordering protection that exists to prevent F-REL-09-style
mistakes.

**The rule: land every `00NN` migration already written and merge-pending
before merging the first timestamped one.** In practice, since we're two
people, this means checking with each other before merging a
newly-timestamped migration if there's any open PR still carrying a `00NN`
file.

**This same class of hazard can recur going forward, not just during the
`00NN` → timestamp cutover** — any time two migrations are written in
parallel, whichever one _merges_ second can still land with a prefix that
sorts below one already recorded in an environment's ledger, because
`supabase db push`'s ceiling is set by merge order onto `main`, not by
when either migration was written. The `Migration number collision` CI job
(`quality.yml`) has a second step for this: it compares every newly added
migration file's prefix (`--diff-filter=A`, same as the forward-fix check)
against the highest prefix already present on the PR's base branch, and
fails the PR if a new file sorts at or below that floor. This only catches
a collision introduced by a merge that happened after the PR's branch was
last synced — it depends on branch protection's "require branches to be up
to date before merging" (`strict: true` on `main`'s required status
checks, already enabled) to force a re-run against current `main` before
merge. Without that setting, this check can go stale in exactly the same
way the PR it's meant to catch does.

**MNT-07 (2026-09): pushing an `additive` migration to dev at write-time
(instead of waiting for merge) is a proposed way to make dev's push order
follow write order instead of merge order**, which sidesteps this hazard
for dev specifically, and also removes the need to hand-apply a `gen types
--local` diff onto the dev-generated `database.ts` (see "The `--local` vs
dev types" note above) since the migration is already live on dev before
types are regenerated. Constraints on that proposal, if adopted:

- **Never early-push a `replace` migration.** `additive` is
  backward-compatible with already-running code by construction (that's
  what the risk class means); `replace` is not — replacing an RPC body
  hits deployed code immediately, and early-push would mean dev sits
  broken for the PR's entire review lifetime instead of one short deploy
  window. `replace` still only pushes at merge time.
- **Once a migration is pushed to dev, its SQL body can't be edited in
  place.** A changed body after push needs a new timestamped file — editing
  in place means dev has the old version recorded, so a later `db push`
  never reapplies the edit and dev silently diverges from what the file on
  disk says. Same shape as the F-REL-09 schema drift incident.
- **This only fixes dev's ordering, not prod's.** Prod is deployed via tag
  or manual `workflow_dispatch`, never at write-time, so prod's ceiling is
  still set by merge order onto `main` regardless of this proposal. A
  migration can still strand on prod even with early-push adopted for dev;
  merge sequencing for migrations still pending merge has to be decided by
  hand (see "The rule" above) — early-push does not remove that need.

This proposal is discussed but not yet adopted as policy — only the CI
ordering check above is implemented so far.

## How to apply migrations

1. `supabase migration new <descriptive_name>` — creates the file under `supabase/migrations/` with a timestamp prefix
2. Write the SQL, then test locally: `supabase db reset` (replays all migrations against the local Docker stack)
3. Apply to dev: `supabase link --project-ref lhflutwvwvzawzbcuwup` then `supabase db push`
4. Apply to prod: `supabase link --project-ref rauvaxuypujbeintnnoe` then `supabase db push`

**Don't use the MCP `apply_migration` tool for normal migrations.** It writes its own ledger row with a `YYYYMMDDHHMMSS` version instead of reusing the migration file's own prefix, which creates an invisible duplicate if the same file is later applied via `db push` (or vice versa) — this caused a multi-hour cleanup on 2026-08-25 (mismatched `schema_migrations` history broke `supabase db pull` on both dev and prod). MCP/manual SQL execution is still fine for one-off inspection, verification queries, and the intentionally-manual files in `supabase/prod-manual-migrations/` (see below) — just not for applying a numbered migration file.

If `supabase db pull` ever reports a migration history mismatch pointing at a version that doesn't correspond to a real file, don't guess — inspect `supabase_migrations.schema_migrations` directly (via SQL) to see what the row actually contains before repairing or deleting it. `migration repair --status reverted` and a direct `delete from supabase_migrations.schema_migrations where version = '...'` may both be needed; `supabase migrations fetch` can help resync the CLI's view but will overwrite local migration file formatting as a side effect — discard those file changes (`git checkout -- supabase/migrations/`) unless you actually intended to regenerate them from the remote schema.

---

## Forward-fix plan (mandatory for every new migration)

Migrations here are forward-only. There are no `down.sql` files and none
will be added — recovery from a bad migration always means writing a new
numbered migration that moves forward. To make that survivable during a
live incident, **every migration from 0033 onward must document its own
forward-fix plan in the SQL comment header.** The person paging through a
broken deploy at 22:00 should find the answer already written down, not
have to reverse-engineer the migration under pressure.

This is the forward-fix half of MNT-07 ("every migration has a tested
reverse or a documented forward-fix"). The 32 existing migrations
(0001–0032) are intentionally exempt: they are already applied and stable
on both dev and prod, and retrofitting plans onto them costs more than it
would ever return.

**Format** — extends the header convention already used in
`0026_rate_limit_officials_invite.sql` and `0031_create_workstation_rpc.sql`.
`<version>` in the template below is the file's own prefix — `00NN` for a
legacy file, or the full `YYYYMMDDHHMMSS` for a timestamped one — copied
verbatim from the filename, never invented or renumbered:

```sql
-- ============================================================================
-- Migration <version>: <title>
-- ============================================================================
--
-- <what it does and why — as today>
--
-- Forward-fix: <additive | destructive | replace>
--   Rollback: <the SQL, or the steps, for a new migration that undoes this>
--   Data:     <can the data be recovered, and from where — or "no data loss">
--   Blast:    <what breaks in the app between the bad deploy and the fix>
--   Window:   <what happens to the CURRENTLY DEPLOYED code while this schema
--             is live but the new image is not — "compatible", or the
--             expand/contract split this needs>
-- ============================================================================
```

**Risk classes** — pick exactly one; it sets the bar for the other lines:

| Class         | Typical changes                                                            | What `Rollback:` must say                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `additive`    | new table, new nullable/defaulted column, new index, new RPC               | A `drop ... if exists`. Safe by construction, so `Data:` is "no data loss".                                                                                                                                              |
| `destructive` | drop or rename a column, tighten a CHECK, backfill or UPDATE existing rows | Must name where the original data lives — the PITR window, an export file, or an explicit "not recoverable". Snapshot the affected rows with a `select` **before** pushing, or state outright that the loss is accepted. |
| `replace`     | changed RPC definition, changed RLS policy, changed trigger                | "Restore the definition from migration `<version>`", with the filename. Always cheap, because the `create or replace` / `drop policy if exists` pattern is already the norm here.                                        |

### RPC return-shape contracts (mandatory for `replace` on an RPC)

Every RPC here returns `jsonb`, and `supabase gen types` cannot see inside
that — the generated signature is always `Returns: Json`, never the actual
keys (F-REL-16). That means a `replace` migration can silently drop or
rename a key the app reads out of a `.rpc(...)` response, and nothing —
not TypeScript, not `db:types`, not a mocked unit test — will catch it.
This already happened once: migration 0045 rewrote
`confirm_official_invite_by_phone` to add consent enforcement, based the
new body on an older pre-0043 shape, and dropped the `role_granted` key
0043 had added. The SEC-07 audit write in `tenant.ts`/`route.ts` that
depended on it went silently dark — no error, no failed request, just a
quiet gap in the audit trail that shipped to dev undetected. Fixed by 0046
(PR #123).

**Before writing a `replace` migration for an RPC, grep the call sites**
(`.rpc('function_name'`) for how the response is destructured — the
pattern to look for is `data as unknown as { ... }` or similar. If any key
is read there, the new function body MUST still return that key, and the
migration needs an integration test (in `tests/integration/`, run against
real Postgres, not a mocked unit test) that asserts the exact keys in the
response — not just that the call succeeds. A unit test that mocks the RPC
result proves the _caller_ handles a given shape correctly; it proves
nothing about whether the real function still produces that shape. Only
an integration test running the actual SQL closes that gap.

## The ordering guarantee (why `Window:` exists)

**Schema goes first, and the app follows minutes later.** `deploy-prod.yml`
applies `supabase db push` as step 1 and only swaps the Container App
revision at step 4, after the type gate and the Docker build. Prod runs
`minReplicas: 1` in Single revision mode, so there is also a short overlap
where Azure has started the new revision and not yet drained the old one.
For that whole window — minutes, not seconds — **the new schema is live and
the previously deployed code is still serving traffic.**

Schema-first is the right order (the alternative, code-first, breaks the new
code instead and gives you no working version at all). But it obliges every
migration to satisfy one rule:

> **A migration must be backward-compatible with the code already running,
> for the length of one deploy window.**

What that permits and forbids:

| Change                                             | Safe in one release?                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| New nullable column, new index, new table, new RPC | **Yes.** Old code ignores what it does not select.                      |
| New mandatory column **with** a default            | **Yes.** Old code's `INSERT` omits the field; the default fills it.     |
| New mandatory column **without** a default         | **No.** Every `INSERT` from old code fails for the whole window.        |
| Renaming or dropping a column old code reads       | **No.** PostgREST returns `42703` to live users until step 4 completes. |
| Tightening a CHECK old code can still violate      | **No.** Old writes fail until the new image lands.                      |

**For anything in the "No" rows, split it across two releases** — the
expand/contract pattern:

1. **Expand.** Ship code that no longer depends on the old shape (stops
   reading the column, writes both old and new, tolerates either). Deploy it.
   The schema is untouched, so this release is safe in both directions.
2. **Contract.** Ship the migration that drops or renames. By now no running
   code reads the old shape, so the window is harmless.

A rename is two migrations under this pattern, not one: add the new column
and backfill (expand), then drop the old one in a later release (contract).
Never `ALTER TABLE ... RENAME COLUMN` on a column any deployed page selects
— that is exactly the break rehearsed in Del 3 of
`docs/testing/rollback-rehearsal.md`, and in a real deploy it would have hit
every user at once instead of one local test.

The `Window:` line in the header is where this is stated per migration. For
`additive` it is usually one word, "compatible". For `destructive` it must
name which release this is — expand or contract — or explain why the change
is safe against old code without a split. The `Migration forward-fix` job in
`quality.yml` requires it on every newly added migration and rejects an
unfilled `<placeholder>`; it only inspects files added in the diff, so
`0033` and `0034` — written before this line existed — are not retroactively
in breach, the same exemption 0001–0032 have.

**What has protected prod so far** is not this rule but two habits that
happen to imply it, and `docs/quality-requirements.md` says so outright: no
wildcard reads (all 78 database reads name their fields) and a default on
every mandatory column ever added. Habits do not survive two people
working in parallel, which is why the rule is written down here.

**The one hard rule:** a `destructive` migration does not get pushed to
prod until the `Data:` line says something verified rather than something
hoped. This is the same discipline that `docs/quality-requirements.md`
credits for prod not having had a schema incident yet — no wildcard reads,
a default on every mandatory column added. Keep it.

**Rehearse it:** `docs/testing/rollback-rehearsal.md` is the routine for
practising recovery before it is needed, and for verifying that the
migration suite still builds prod's schema exactly. Run it before any prod
release containing a migration. It runs against the local stack with
`npm run seed:dev` — never against a copy of prod data, which carries real
phone numbers under the SEC-09 retention decisions.

**Six migrations have no correct reverse** (`0003`, `0008`, `0009`, `0012`,
`0014`, `0015`) — retroactive downs for 0001–0032 were evaluated and
rejected in 2026-08-26; see F-REL-05 for the per-migration classification
and the rehearsal doc for the table. `0009` is the one to remember: a
naive reverse of its `invite_status` remap corrupts legitimate
confirmations, because it cannot tell them from the rows the migration
touched.

---

## After any DB migration

1. Run `npm run db:types` — regenerates `src/types/database.ts`
2. Update `src/types/app.ts` manually with aliases for any new tables
   (Row, Insert, Update types) and any new enum/status types matching
   CHECK constraints
3. Remove any temporary `any` casts that were placed pending types
4. Run the migration on **both dev and prod** Supabase projects

**`--local` vs dev types will never be byte-identical.** The local Docker
stack's PostgREST version isn't pinned to dev's, and dev's own version has
flipped on its own (14.5 ↔ 14.17) with no migration involved — the
`PostgrestVersion` field in `src/types/database.ts` is infrastructure, not
schema. The CI types gate (`scripts/check-db-types-current.sh`, from PR #93)
already masks that one field so it doesn't block deploys on a cosmetic diff.

That only fixes the gate, not pre-merge verification — nothing applies the
migration against dev from a PR, so there's no way to get a byte-identical
file before merge. **Workflow:** run `supabase gen types --local` to see what
the migration changes (new columns, nullability), then hand-apply that same
surgical change to the dev-generated `src/types/database.ts` rather than
committing the `--local` output wholesale. This is how the
`audit_events.actor_user_id` nullability bug (PR #90) should have been
caught — compare the two outputs manually, don't trust either one alone.
