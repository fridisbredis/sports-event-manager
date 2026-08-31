# ADR-0002: `anon` holds default DML grants on nearly every table — is that intentional?

- **Status:** Accepted
- **Date:** 2026-08-28
- **Driver:** Trello backlog audit of medium/low priority labels, which
  flagged "Verifiera att anons DML-rättigheter är avsiktliga (SEC-03/ADR-0001)"
  as possibly under-prioritized
- **Input:** F-REL-09 (`docs/quality-requirements.md`), finding 3 in
  `docs/testing/rollback-rehearsal.md` (Del 3), `supabase/seed.sql`

## Context

The first rollback-rehearsal run (2026-08-26) surfaced, as a lower-severity
side finding while investigating the `events.category_type` drift (F-REL-09):

> 164 grant rows for `anon`/`authenticated`/`service_role` on almost every
> table. Supabase's automatic default grants, which the migration files
> never declare — expected noise, not drift. Worth knowing anyway: `anon`
> holds `insert`/`update`/`delete` on nearly everything, so **RLS is the
> only thing protecting these tables**, never grants. Compare SEC-03/ADR-0001.

This was filed as "expected noise, not drift" and left there. But **"not
drift" and "reviewed and intentional" are not the same claim.** Nobody
before the rehearsal had looked at this table-privilege surface at all —
it was found by accident while chasing an unrelated column-drop bug, not
by a deliberate audit. F-REL-09's own recommendation column only asks to
(a) move `pg_net` out of `public` and (b) filter `^grant` lines out of
future `db diff` output — it does not ask anyone to actually decide
whether `anon` should hold `insert`/`update`/`delete` at the grant level.

The Trello card citing "SEC-03/ADR-0001" as if that ADR already covers this
is the specific thing this document corrects: **it does not.**
[ADR-0001](0001-service-role-vs-session-client.md) is entirely about when
server-side code is allowed to use the service-role client instead of the
session-scoped one. It never discusses the `anon` Postgres role's
table-level grants, and searching it for "anon" turns up nothing. The
"RLS gates rows, never grants" line that both `seed.sql:72` and the
rehearsal doc use to justify leaving `anon`'s grants alone is a correct
general principle, but citing ADR-0001 for it borrows authority the ADR
never actually established for this specific question.

### What is confirmed true in the code today

- `supabase/seed.sql:83-97` grants `select, insert, update, delete` on 13
  of the 15 tables in `public` to `anon, authenticated, service_role`,
  explicitly **to mirror what the hosted platform already grants on dev
  and prod** — this is not a local-only quirk, it is a local reproduction
  of a real prod state.
- `rate_limit_hits` (migration `0026`) and `sms_queue` (migrations `0030`,
  `0032`) are the only two tables where `anon` has been deliberately
  revoked and denied by policy — these are the two carve-outs referenced
  in `seed.sql:77-81` and asserted by
  `tests/integration/rate-limit.test.ts`.
- Zero RLS policies in any migration target `anon` specifically (`seed.sql`
  states this was verified: "zero `to anon` occurrences across all
  migrations"). Every policy checks `get_user_role(tenant_id)` or
  `is_system_admin()`, both of which require an authenticated `user_roles`
  row — an anonymous request produces no such row, so every policy
  evaluates to `false` for `anon` today, on every table.
- Net effect right now: **`anon` can attempt `insert`/`update`/`delete` on
  12 tenant-scoped tables (all except the two carve-outs), and RLS silently
  discards the attempt** — Postgres returns success with zero rows affected
  for `UPDATE`/`DELETE`, and `INSERT ... RETURNING` returns nothing, rather
  than a permission error. There is no grant-level backstop; RLS is
  carrying the entire weight of this boundary, on every one of those 12
  tables, for every future migration that adds a table.

### Why this is not purely theoretical

- This project is explicitly working through a service-role → RLS
  hardening pass (SEC-03, ADR-0001, `docs/security/service-role-audit.md`)
  and a separate stricter-RLS-writes audit, both driven by preparing for
  more concurrent users/customers. The stated posture project-wide is "RLS
  is the enforced boundary, defense in depth on top of it" — see CLAUDE.md's
  Security section: "RLS protects the database; route handlers ALSO
  validate tenant_id... Don't rely on one alone." The `anon` grants are the
  one place today where the second layer (grants) has never been
  deliberately set — it is a platform default nobody chose.
- A future migration for a new tenant-scoped table that forgets to add a
  `tenant_member_read_<table>` / `tenant_admin_manage_<table>` policy pair
  (the mandatory convention from migration `0004`, restated in CLAUDE.md)
  would, under today's grant posture, be silently writable by an anonymous
  request with no session at all — not just misreadable by the wrong
  tenant, which is the failure mode the existing RLS conventions are
  written to prevent, but writable by literally anyone holding the public
  anon key. The anon key is, by design, shipped to every browser
  (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- This is exactly the scenario the project's own "SELECT required before
  DELETE" lesson (migration `0024`) and the RLS-policy-convention section
  of CLAUDE.md exist to prevent for authenticated roles. The `anon` case is
  the same risk shape, one level further out, and it has never been
  reviewed as its own question.

## Decision

**Revoke `anon`'s `insert`/`update`/`delete` grants on all 13 currently-ungoverned
tables in `public`**, matching the treatment `rate_limit_hits` (0026) and
`sms_queue` (0030/0032) already received. `anon` keeps `select` — that grant
is equally unused today (no policy targets `anon` for reads either) but is
left alone because revoking it changes nothing observable and this decision
is scoped to the write-side risk the audit actually raised. Implemented in
migration `0035_revoke_anon_table_dml.sql`; `supabase/seed.sql` updated in
the same PR so local dev keeps matching dev/prod after a reset.

**Verification done before revoking (2026-08-28):** every call site of
`createSupabaseBrowserClient()` (the only client configured with the public
anon key) was audited. There are two: the login page and the invite-accept
form. Both call only `supabase.auth.signInWithOtp`/`verifyOtp` — Auth API
calls, unaffected by table-level grants — never a `.from(...)` table write.
Every Server Action and API route that performs a table write uses the
session-cookie client (`createSupabaseServerClient()`) or the service-role
client, never the anon key directly. No RLS policy anywhere targets `anon`,
confirming the revoke removes a grant nothing legitimate depends on.

This was close to a free decision once verified: the grant was defended by
nothing (no policy, no code path), so revoking it costs nothing functional
and closes the "one future migration forgets the `0004` policy convention"
exposure described above. The verification step — not the revoke itself —
was the part worth doing carefully, which is why it's recorded in the
migration header rather than asserted from the code alone.

**Status when PR #89 was opened (2026-08-31): neither `0035` nor `0036` had
been applied to dev or prod — verified directly, not assumed.** Ran, against
both linked projects via `supabase db query --linked`:

```sql
select defaclrole::regrole, defaclobjtype, defaclacl
from pg_default_acl
where defaclnamespace::regnamespace::text = 'public';
```

Both dev (`lhflutwvwvzawzbcuwup`) and prod (`rauvaxuypujbeintnnoe`) show the
same row for `defaclrole = postgres, defaclobjtype = 'r'`:
`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
— `anon` still carries the full `arwdDxtm` default (including `a`=insert,
`w`=update, `d`=delete), meaning `0036`'s `ALTER DEFAULT PRIVILEGES` revoke
has not run there. This settles the question raised in review: the
"Ongoing obligation" below describes what `0035`+`0036` will do once
merged and pushed, not a state already live anywhere. `supabase db push`
after merge (per CLAUDE.md's migration routine) is what applies both.

## Consequences

**What this fixes:** the 12 tenant-scoped tables that previously relied on
RLS alone against `anon` now also fail closed at the grant level. A future
migration that adds a table and forgets its `0004`-convention RLS policies
is unwritable by an anonymous request holding only the public anon key,
rather than silently writable pending someone noticing the missing policy.

**What this does not change:** `authenticated` and `service_role` grants,
and every existing RLS policy — none of those were in question. `select` for
`anon` is also untouched, for the reason given above.

**Ongoing obligation:** a new table added to `public` gets `anon` `select`
only in both a migration and `supabase/seed.sql`, never
`insert`/`update`/`delete`, unless a future ADR reverses this one. The
`seed.sql` "KEEP IN SYNC" note reflects this.

This obligation is now enforced at the grant level, not just by convention.
Migration `0036_revoke_anon_default_privileges.sql` runs
`alter default privileges for role postgres in schema public revoke insert,
update, delete on tables from anon` — since `supabase db push` creates
tables as `postgres`, every table created by a migration after `0036` no
longer receives `anon` `insert`/`update`/`delete` automatically. Without
`0036`, `0035`'s revoke would only have covered the 13 tables that existed
on 2026-08-28; the very next migration that creates a table would have
gotten the platform default back, silently reopening the exposure this ADR
describes. (A concrete instance of exactly that surfaced in this PR's
review: a sibling branch's `audit_events` migration creates a table whose
RLS policies never target `anon`, which — before `0036` — would have left
it `anon`-writable by default.) `0036` does not touch grants on tables that
already exist; per-table revokes (`0035`, and any future table's own
migration) remain how the deny-list is declared for already-created tables.

**What `0036` does not cover: tables created outside the migration path.**
`alter default privileges` is scoped to the role that creates the object, and
`0036` names `postgres` because that is who `supabase db push` connects as.
A table created any other way keeps the platform default.

**Measured on dev 2026-08-31, after #89 merged (`a91004e`) and its deploy
applied both migrations** — i.e. after the status block above, which recorded
the state at the moment #89 was opened. `pg_default_acl`, `defaclobjtype = 'r'`,
schema `public`:

| Default privileges for role | `anon` gets                                       |
| --------------------------- | ------------------------------------------------- |
| `postgres`                  | `SELECT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` |
| `supabase_admin`            | the same **plus `INSERT`, `UPDATE`, `DELETE`**    |

Raw, so the reading is checkable rather than paraphrased — `defaclacl` for the
two rows, where `r`/`w`/`a`/`d` are select/update/insert/delete:

```
postgres        {postgres=arwdDxtm/postgres,anon=rDxtm/postgres,
                 authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
supabase_admin  {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,
                 authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
```

`anon=rDxtm` on the `postgres` row is `0036` having taken effect: `a`, `w` and
`d` are gone. The `supabase_admin` row still reads `anon=arwdDxtm`.

**Which client creates tables as `supabase_admin` is not verified here.** What
is measured is that a second default-privilege row exists for that role and
still carries anon DML, so any path creating tables as `supabase_admin` bypasses
`0036`. The Supabase dashboard's table editor is the obvious candidate and the
reason this matters in practice, but confirming it would mean creating a table
through the dashboard on a real project — not worth doing to settle a footnote.
Treat the role as the fact and the client as the likely explanation.

So a table created by any path that runs as `supabase_admin` still lands
`anon`-writable, exactly as every table did before `0035`.

**Prod is a different state again, measured the same day:** neither role has
been revoked there — both `postgres` and `supabase_admin` still carry the full
`INSERT, UPDATE, DELETE` default for `anon`, because `0035`/`0036` have not
been deployed to prod. Everything above describes dev. Prod inherits the same
posture when the next prod release carries these migrations, at which point
the `postgres` row closes and the `supabase_admin` row does not.

This is a discipline gap rather than a live hole: CLAUDE.md is emphatic that
schema reaches dev and prod only through numbered migrations, and Del 1 of
`docs/testing/rollback-rehearsal.md` exists specifically to detect schema that
arrived any other way. It is recorded here because the paragraph above could
otherwise be read as "`0036` closes this at the grant level, full stop" — it
closes it for the path this project actually uses, which is not the same claim.

Two narrower scoping notes, for completeness: `0036` covers `IN SCHEMA public`
only, which is where every tenant-scoped table lives; and it covers tables,
not sequences or functions.

The function surface is **not assessed here** — see F-SEC-14. It is not the
consistent omission an earlier draft of this paragraph claimed: Postgres grants
`EXECUTE` to `PUBLIC` on every new function, and `PUBLIC` includes `anon`, so
declaring a grant in a migration restricts nothing by itself. Ten of the
fourteen functions the migrations create declare one — the four without are
`get_user_role`, `is_system_admin`, `sync_event_stages` and
`create_workstation`. Twelve `revoke ... from public` statements do exist,
across 10 distinct functions, which is why the exposure is narrower than the
table case was — but the shape of the question is the same one this ADR exists
to close, one role further out, and it deserves its own answer rather than a
footnote in this one.

## Alternatives considered

- **Widen `0036` to cover `supabase_admin` as well.** Rejected: that role owns
  Supabase's own managed objects, and revoking defaults out from under it to
  protect a path this project does not use is the worse trade. Schema reaches
  dev and prod through numbered migrations only, so the `postgres` scoping
  covers every table this project actually creates. Revisit if
  dashboard-created tables ever become part of the workflow — this is a
  decision with a trigger, not a permanent answer.

- **Leave the platform default as-is, treat RLS as sufficient on its own.**
  Rejected: this is exactly the posture CLAUDE.md's "defense in depth"
  section argues against for every other role in the system (route handlers
  validate tenant_id in addition to RLS; RLS is never trusted alone). No
  reason to treat `anon` as the one exception, especially given it is the
  role reachable from a key shipped to every browser.
- **Wait for a dedicated file-by-file audit like
  `docs/security/service-role-audit.md` before deciding.** Considered, but
  that audit's cost is proportional to ambiguity, and there wasn't much
  here: unlike the service-role question (four genuinely different
  categories of legitimate use), the anon-grant question reduces to "does
  any code path write via anon" — a single, answerable, already-answered
  question. Revoking now and documenting the verification inline captures
  the same rigor without deferring a low-risk, low-cost fix.
