# ADR-0002: `anon` holds default DML grants on nearly every table — is that intentional?

- **Status:** Proposed (open question, not yet a decision)
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

## The question this ADR needs to answer

Is "no grant-level backstop for `anon`, RLS as the sole boundary" the
project's **intentional, reviewed** security posture, or should `anon` be
revoked down to nothing on tenant-scoped tables (the same treatment
`rate_limit_hits` and `sms_queue` already got), leaving RLS to do the same
job it already does but with a second, independent layer behind it that
fails closed instead of relying on every future migration remembering the
`0004` policy convention?

Revoking `anon`'s grants outright looks, from the code alone, close to
free: no policy anywhere targets `anon`, so no legitimate anonymous read or
write path exists to break. The cost is not technical risk so much as
verification effort — confirming that claim holds for every current table
before revoking, and re-litigating the two existing carve-outs' migrations
to make sure a blanket revoke doesn't collide with them.

## Status

This document records the question and the evidence, per the audit that
raised it. It intentionally stops short of a Decision section — that
requires the same kind of file-by-file review `docs/security/service-role-audit.md`
did for the service-role question, which has not been done yet for the
`anon`-grant question. Recommended next step: an audit pass equivalent to
`service-role-audit.md`, scoped to `anon`'s table grants, before deciding
between "leave as platform default, RLS-only" and "revoke to match
`rate_limit_hits`/`sms_queue`."
