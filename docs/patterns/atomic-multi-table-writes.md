# Atomic multi-table writes

Trello: [REL-01] Enforce atomicity in multi-step flows.
Quality register: REL-01 (`docs/quality-requirements.md`) — "multi-step
operations must be atomic or explicitly compensated."

This document generalizes a pattern that was fixed ad-hoc five separate
times before being written down: `confirm_official_invite_by_phone`
(migration 0018), `create_workstation` (0031, hardened 0059),
`save_assignments_batch` (0033), `remove_official` (0025), and
`sync_event_stages` (0005). REL-01 found three more live instances of the
same defect — `createTenant`, `updateWorkstation`, `saveEvent`'s facilities
block — fixed the same way in migrations `20260908130253`,
`20260908130927`, and `20260908131614`. The rule below is what all eight
have in common, so the ninth doesn't have to be independently discovered.

## When this applies

A server action or route handler makes **two or more separate**
`.insert()` / `.update()` / `.delete()` calls against Postgres, where:

- a later call can fail after an earlier one has already committed, and
- the intermediate state (only some of the writes applied) is either
  visible to a reader (RLS lets some other query see it) or referenced by
  a foreign key another table depends on.

If both are true, a failure between steps leaves the database in a state
no code path ever intended to produce — not the old data, not the new
data, something in between. This is not hypothetical: it is the literal
bug fixed in F-REL-04, F-SEC-03 (row #17), and the three REL-01 fixes
above, each discovered by actually reproducing the partial-failure
sequence against a real local Postgres instance, not by inspection.

**Does not apply** to:

- A single statement (one `.insert()`, one `.update()`) — already atomic.
- Independent writes to genuinely unrelated resources where a partial
  result is acceptable and does not corrupt anything (e.g. a best-effort
  audit log write after the real write already succeeded — see "Known
  exceptions" below).
- Writes already going through PostgREST's own single-request semantics
  (a single `.insert()` of an array is one statement, one transaction).

## The rule

> A multi-step write that can leave inconsistent state on partial failure
> MUST run inside a single Postgres transaction — a `plpgsql` RPC, not a
> sequence of separate client calls with individual `if (error) return`
> checks.

Checking and propagating every write's `error` (F-REL-01) is necessary but
not sufficient: it stops the code from claiming success on a partial
failure, but it does nothing to undo the writes that already landed. Only
wrapping the sequence in one function body — where Postgres's own implicit
transaction rolls back every statement together — actually prevents the
partial state from existing.

## Checklist

When writing the RPC:

- [ ] **One `plpgsql` function, one transaction.** All the writes that must
      succeed or fail together go in one function body. No `commit`/`begin`
      needed — a single top-level function call is already one transaction.
- [ ] **`SELECT ... FOR UPDATE` + re-check when a race is possible.** If two
      concurrent callers could both pass an initial check before either
      writes (e.g. confirming the same invite twice), lock the row first and
      re-check the condition in the `UPDATE ... WHERE` clause itself — see
      `confirm_official_invite_by_phone` (0018) and `save_assignments_batch`
      (0033).
- [ ] **`ON CONFLICT` for idempotency**, not a separate existence check, when
      the operation is naturally "insert or no-op" (e.g. granting a role).
- [ ] **Tenant-consistency checks on every foreign-key parameter**, not just
      the primary `tenant_id`. RLS only gates the tenant_id column being
      written — it does not verify that a foreign `event_id`/`stage_id`/etc.
      you're pointing at actually belongs to that tenant. See the
      `create_workstation` gap closed by migration 0059, and the composite
      FK backstop added in 0060. Prefer both: an explicit `not exists` check
      for a clear error message, plus a DB-level composite FK where the
      relationship is a good fit for one.
- [ ] **SECURITY INVOKER by default.** Every RPC in this document's example
      list uses `SECURITY INVOKER` except `confirm_official_invite_by_phone`
      and `confirm_official_invite`, which run as an anonymous/newly-OTP'd
      caller with no role yet (`SECURITY DEFINER`, gated by a token instead
      of RLS — see ADR-0001). Default to invoker so RLS inside the function
      body stays the real gate, not "can call the function at all."
- [ ] **Explicit grant, not the default PUBLIC execute.** `revoke all on
function ... from public` then `grant execute ... to authenticated`
      (or `service_role` for the rare pre-auth case). F-SEC-13 tracks the
      one existing RPC (`create_workstation`) that still relies on the
      default grant — don't repeat that gap in a new one.
- [ ] **Forward-fix header**, per `.claude/CLAUDE.md` — a brand-new RPC is
      `additive` (rollback is `drop function if exists`); a `replace` of an
      existing RPC's body needs the return-shape contract check below.
- [ ] **An integration test that proves atomicity**, not just success. Seed
      a partial-failure condition (a real constraint violation — a check
      constraint, a unique violation, a bad cast — not a client-side
      validation the RPC would filter before it reaches SQL), call the RPC,
      and assert via `serviceClient()` that **none** of the tables changed.
      Follow `docs/testing/integration-test-patterns.md`'s file shape; don't
      invent a new harness. See
      `tests/integration/create-tenant-atomicity.test.ts`,
      `update-workstation-atomicity.test.ts`, and
      `sync-event-facilities-atomicity.test.ts` for the pattern: one test
      that reproduces the _old_ uncoordinated sequence directly (documents
      the bug, still passes today since it's just proving current behavior),
      and one that exercises the new RPC and asserts rollback.

When **replacing** an existing RPC's body (`replace`-class migration),
there's a second, separate hazard on top of atomicity — see
`.claude/CLAUDE.md`'s "RPC return-shape contracts" section: grep every
`.rpc('function_name'` call site for how the response is destructured, and
add a shape-assertion integration test (`remove-official-rpc-shape.test.ts`
is the template) before changing the function body. A migration that fixes
atomicity but silently drops a key the caller reads is the same class of
incident as F-REL-16 (migration 0045's `role_granted` regression), just
introduced from a different direction.

## Known exceptions

- **Best-effort side effects that don't gate correctness.** `logAuditEvent`
  calls after a successful RPC (e.g. in `createTenant`, `remove_official`'s
  caller) are deliberately outside the transaction — the audit row failing
  to write does not corrupt tenant data, and audit writes already tolerate
  being best-effort elsewhere in this codebase. Don't pull these into the
  RPC just for symmetry.
- **Storage operations.** File uploads/deletes (e.g. `uploadEventLogo`'s
  Supabase Storage calls) can't participate in a Postgres transaction at
  all — they're a different system. These need their own compensating
  logic if attempted, not this pattern.
- **A single logical write that happens to touch one table.** Nothing here
  applies to a plain `.update()` — this document is about _sequences_.
