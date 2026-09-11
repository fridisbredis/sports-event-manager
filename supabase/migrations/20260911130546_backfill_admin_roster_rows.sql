-- ============================================================================
-- Migration 20260911130546: backfill admin roster rows
-- ============================================================================
--
-- F-MNT-20, second half. 20260911130436 added ensure_admin_roster_row but
-- called it from nowhere; this calls it once for every tenant_admin that
-- currently lacks a roster row, so existing admins get the row Peter's
-- 2026-06-24 decision says they should always have had.
--
-- Scope, measured on prod 2026-09-11 rather than assumed. The F-MNT-20
-- ticket says "backfill the 5 prod tenants", which overstates it: of the 5
-- tenants only viadal-2026 has any tenant_admin at all (the other four have
-- zero), and 2 of its 3 admins — Peter Thörn and Lotta Thörn — already hold
-- confirmed officials rows created through the normal invite flow on
-- 2026-07-07, having worked around this bug by hand. So exactly ONE row is
-- inserted on prod today (Frida Bredberg on viadal-2026). The statement is
-- written as a set-based loop rather than a hardcoded insert because dev,
-- perf and local stacks each have a different set of admins, and because
-- the count changes as soon as anyone grants a new tenant_admin.
--
-- Delegating to the RPC rather than inlining an INSERT is deliberate: the
-- reuse-first and phone-claiming logic that keeps this off the partial
-- unique index on (tenant_id, phone) lives in one place, so the backfill
-- and the future SYS-02 call site cannot drift apart.
--
-- Admins whose auth.users row carries no phone are skipped with a notice
-- instead of failing the migration: the RPC raises 22023 for them, and one
-- unusable account must not block the backfill for everyone else. None
-- exist on prod today (all 25 auth.users rows have phones) — this is for
-- dev and local stacks, where partially provisioned users are common.
-- 22023 is the ONLY tolerated failure; every other SQLSTATE aborts the
-- migration, so a real bug in the RPC cannot masquerade as a clean run.
--
-- Forward-fix: destructive (inserts rows; no existing row is updated or
--              deleted by the backfill itself, but the RPC it calls may
--              link a pre-existing phone-matched row to the admin's user_id)
--   Rollback: the inserted rows are identifiable as the admin's own roster
--             rows. Recover the pre-migration state with, per affected
--             tenant:
--               delete from officials o
--               using user_roles ur
--               where ur.user_id = o.user_id and ur.tenant_id = o.tenant_id
--                 and ur.role = 'tenant_admin'
--                 and o.created_at >= '<this migration's run time>';
--             The created_at bound is what protects Peter's and Lotta's
--             2026-07-07 rows, which this migration must not touch.
--   Data:     no data loss. Only inserts. The snapshot of what existed
--             before is the query recorded below, run on prod
--             2026-09-11: exactly one admin (c68f9235-1469-42b5-bbb7-f52ad81b256c,
--             viadal-2026) lacked a row; the other two already had one.
--               select ur.user_id, ur.tenant_id from user_roles ur
--               where ur.role='tenant_admin' and not exists (
--                 select 1 from officials o where o.tenant_id=ur.tenant_id
--                   and o.user_id=ur.user_id and o.invite_status <> 'removed');
--   Blast:    an admin newly appears on OFF-01 and in SCHED-01's pool, and
--             stops 404ing on /{slug}/account. That is the intended fix, but
--             note it lands the moment this migration runs, before any app
--             change — the three read paths need no code change to show it,
--             since they read officials directly. Nothing breaks if the app
--             image is older.
--   Window:   compatible — no schema change; the currently deployed code
--             reads these rows correctly as ordinary confirmed officials.
-- ============================================================================

do $$
declare
  r        record;
  v_result jsonb;
  v_total  int := 0;
  v_made   int := 0;
begin
  for r in
    select ur.user_id, ur.tenant_id
    from user_roles ur
    where ur.role = 'tenant_admin'
      and ur.tenant_id is not null
      and not exists (
        select 1 from officials o
        where o.tenant_id = ur.tenant_id
          and o.user_id = ur.user_id
          and o.invite_status <> 'removed'
      )
  loop
    v_total := v_total + 1;
    begin
      v_result := public.ensure_admin_roster_row(r.tenant_id, r.user_id);
      if (v_result ->> 'created')::boolean then
        v_made := v_made + 1;
      end if;
    exception when sqlstate '22023' then
      -- The one tolerated failure: an admin account with no phone on
      -- auth.users, which ensure_admin_roster_row raises 22023 for. Skip it
      -- rather than abort the backfill for everyone else.
      --
      -- Deliberately NOT `when others` (Eduardo, review of PR #187): that
      -- swallows a genuine RPC bug — a bad predicate, a constraint violation,
      -- a permission error — as a notice, and the migration would report
      -- success having backfilled nothing. Anything but 22023 must fail loudly.
      raise notice 'Skipped admin % on tenant % (no phone on auth.users): %',
        r.user_id, r.tenant_id, sqlerrm;
    end;
  end loop;

  raise notice 'Admin roster backfill: % admin(s) without a row, % new row(s) inserted',
    v_total, v_made;
end $$;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with — expect zero rows:
--   select ur.user_id, ur.tenant_id from user_roles ur
--   where ur.role = 'tenant_admin' and ur.tenant_id is not null
--     and not exists (select 1 from officials o
--                     where o.tenant_id = ur.tenant_id and o.user_id = ur.user_id
--                       and o.invite_status <> 'removed');
