-- ============================================================================
-- Migration 20261006113036: official self-reported unavailability
-- ============================================================================
--
-- MYSCH-01 / SCHED-01. Lets a confirmed official declare periods they are not
-- available to be scheduled, and surfaces that to the admin grid as a warning.
--
-- WHY A NEW TABLE RATHER THAN assignments.status = 'blocked'
-- Migration 0003 already defines a person-timeslot status enum
-- (assigned | available | on_break | blocked) and 'blocked' reads like the
-- obvious home for this. It is the wrong home, for three reasons:
--
--   1. Inverted vocabulary. In 0003 'available' means "free / on call", set by
--      an admin. This feature is the official asserting the opposite. Putting
--      both in one column guarantees the two senses get confused.
--   2. Ownership. `assignments` is the admin's working surface — every row on
--      SCHED-01 is written by a tenant_admin. Admitting official writes there
--      would mean an INSERT/UPDATE policy on the admin's own table, narrowed
--      to one status value and one official_id. Narrow write policies on a
--      shared table are exactly what migration 0024 showed is easy to get
--      subtly wrong.
--   3. Granularity. `assignments` is one row per timeslot (it carries
--      slot_index). Unavailability is naturally an interval — "all of
--      Saturday" is one statement, not twelve rows that must be kept in sync.
--      Storing the interval keeps "all of Saturday" a single row, and the
--      grid expands it to slots at render time.
--
-- BLOCKING, NOT ADVISORY — and why that is enforced in the app, not here.
-- Peter's call of 2026-10-07: an admin must not be able to assign someone over
-- a period marked as time off. That is a change from this feature's first
-- shape, which only warned.
--
-- The block lives in the scheduling server action and the grid UI rather than
-- in a constraint or trigger on `assignments`, for two reasons. First, rows
-- that already sit on a declared period must survive: time off can be recorded
-- after the shift was assigned, and a database-level constraint would make
-- every later write to such a row fail — including the admin's attempt to
-- remove it. Those rows stay, and the grid's warning banner is what surfaces
-- them. Second, a trigger would also fire for the GDPR anonymisation job and
-- the cache RPCs, neither of which should be refused on a scheduling rule.
--
-- So: no new assignment may be created over time off (checked in
-- saveAssignments, which is the only path that writes them), and existing
-- overlaps are reported rather than erased.
--
-- VISIBILITY. An official reads their own periods only — admin-recorded ones
-- included, since being marked off is something they must be able to see — but
-- never a colleague's. There is deliberately no tenant_member_read_* policy on
-- this table. Note this is narrower than `assignments`, where officials DO see
-- who shares their shift (Peter, 2026-10-07): a name on a shared shift is
-- roster information, while a reason for being away is not.
--
-- OWNERSHIP. Whoever declared a period owns it: an admin may edit and withdraw
-- the ones they recorded, an official the ones they declared, and neither may
-- touch the other's. `created_by_role` carries that, and the write policies
-- below enforce it rather than leaving it to the UI.
--
-- Forward-fix: additive, plus one policy replacement
--   Rollback: drop table if exists public.official_unavailability;
--             drop function if exists public.is_own_official_row(uuid);
--             drop function if exists public.shares_shift_with_caller(uuid, timestamptz, timestamptz);
--             -- and restore the own-rows-only read this migration replaces:
--             drop policy if exists official_read_own_assignments on public.assignments;
--             create policy official_read_own_assignments on public.assignments
--               for select using (exists (select 1 from public.officials o
--                 where o.id = assignments.official_id and o.user_id = auth.uid()));
--   Data:     Dropping the table loses every declared period outright, with no
--             copy elsewhere — recoverable only from a backup. No pre-existing
--             data is read or rewritten, and `assignments` rows are untouched:
--             the policy change alters who may SELECT them, never their content.
--   Blast:    The new table starts empty. The assignments policy change is the
--             one externally visible effect — from the moment it applies, a
--             confirmed official can read colleagues' rows for shifts they
--             share, whether or not this PR's UI has shipped. That is the
--             intended product change (Peter, 2026-10-07) and the reason this
--             migration must not be applied ahead of that decision.
--   Window:   Compatible in both directions. Schema-before-code leaves the
--             table unused and the wider read unexercised by any UI.
--             Code-before-schema fails the declaration form closed (42P01) and
--             renders an empty shift-peer list, without touching the schedule
--             read or the assignment writes.
-- ============================================================================


-- ============================================================================
-- 1. official_unavailability
-- ============================================================================
-- tenant_id is carried directly rather than reached through officials, so
-- every policy below stays a plain get_user_role(tenant_id) call with no join
-- to evaluate per row — the same reasoning as checklist_item_checks. The
-- tenant-consistency trigger further down is what keeps that copy honest.
--
-- Half-open interval [starts_at, ends_at): an absence ending 15:00 and a shift
-- starting 15:00 do not overlap. The app's overlap test uses the same
-- convention, and `timeslot_start < ends_at AND timeslot_end > starts_at` is
-- only correct if both sides agree on it.

create table if not exists public.official_unavailability (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  official_id  uuid not null references public.officials(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  -- Optional free text ("working", "away"). Shown to admins on the grid so a
  -- declined slot can be weighed rather than just seen. Length-capped because
  -- it renders in a tooltip, not a document.
  reason       text check (reason is null or char_length(reason) <= 200),
  -- Who declared this period, and therefore who may edit it. Both roles
  -- produce the same scheduling consequence — the grid blocks the slot either
  -- way — but each may only touch their own: an admin must not quietly rewrite
  -- what an official said about their own availability, and an official must
  -- not delete time off the organisers set for them. The RLS policies below
  -- are what enforce that; this column is what they read.
  --
  -- Also drives the grid's two hatch colours, so an admin can tell at a glance
  -- which absences came from the roster and which they set themselves.
  created_by_role text not null default 'official'
    check (created_by_role in ('official', 'tenant_admin')),
  -- The acting user, for display ("set by Frida") and for an audit trail that
  -- survives the roster row being removed. Nullable with on delete set null,
  -- following migration 0037's reasoning: keep the row, forget the actor,
  -- rather than having Postgres abort an auth.users delete with 23502.
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint official_unavailability_period_valid check (ends_at > starts_at)
);

-- The admin grid's read shape: every declared period for one tenant that
-- overlaps the day on screen. Leading tenant_id matches the equality filter,
-- then starts_at for the range half.
create index if not exists official_unavailability_tenant_period_idx
  on public.official_unavailability (tenant_id, starts_at, ends_at);

-- MYSCH-01's read shape: one official's own periods, soonest first.
create index if not exists official_unavailability_official_idx
  on public.official_unavailability (official_id, starts_at);


-- ============================================================================
-- 2. Tenant-consistency trigger
-- ============================================================================
-- tenant_id is denormalised onto the table purely so the RLS policies stay
-- single-table lookups. A row claiming tenant A while its official belongs to
-- tenant B would be visible to the wrong tenant's admins, since the policies
-- trust the column. A check constraint cannot express this (it cannot
-- subquery), so the invariant is enforced here — the same pattern as
-- validate_checklist_row_tenant.

create or replace function public.validate_official_unavailability_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_official_tenant uuid;
begin
  select tenant_id into v_official_tenant
  from public.officials
  where id = new.official_id;

  if v_official_tenant is null then
    raise exception 'Official % not found', new.official_id
      using errcode = '23503';
  end if;

  if v_official_tenant <> new.tenant_id then
    raise exception 'Official % does not belong to tenant %',
      new.official_id, new.tenant_id
      using errcode = '23514';
  end if;

  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists validate_tenant on public.official_unavailability;
create trigger validate_tenant
  before insert or update on public.official_unavailability
  for each row execute function public.validate_official_unavailability_tenant();


-- ============================================================================
-- 3. "Is this my own roster row?" helper
-- ============================================================================
-- The authorisation rule for every official write below: you may declare
-- absence only for yourself. security definer because the caller is an
-- official whose own RLS on `officials` is narrower than this question needs,
-- and because the answer must not depend on which roster rows the caller can
-- already see.
--
-- Unconfirmed officials are excluded, matching canViewOfficialSurfaces in the
-- app and is_on_workstation_shift in migration 20260930084957: an
-- invited-but-unconfirmed official is not schedulable, so declaring
-- availability is meaningless for them.
--
-- Deliberately NO admin short-circuit, unlike is_on_workstation_shift. This
-- function answers only "is this the caller's own row"; admin access is
-- granted by its own separate policy below. Folding the two together would
-- make the self policy silently admit admins and make the admin policy look
-- redundant, which is how a later edit removes the wrong one.

create or replace function public.is_own_official_row(p_official_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.officials o
    where o.id = p_official_id
      and o.user_id = auth.uid()
      and o.invite_status = 'confirmed'
  );
$$;

comment on function public.is_own_official_row is
  'True when the given officials row belongs to the calling user and is '
  'confirmed. Gates every official-written row on official_unavailability.';


-- ============================================================================
-- 4. RLS
-- ============================================================================
-- Deliberately not the tenant_admin_manage_* / tenant_member_read_* pair from
-- migration 0004. That convention is for admin-managed tenant data, where
-- every member reads and only admins write. This table inverts both halves:
-- officials are the intended writers, and the read side is narrower than
-- "every member" because officials must not see each other's absences.

alter table public.official_unavailability enable row level security;

-- Same grant reasoning as migrations 0037 and 20260930084957: a table created
-- by a migration has no base grants for `authenticated` locally, and a missing
-- grant fails with 42501 before RLS is ever evaluated.
grant select, insert, update, delete on public.official_unavailability to authenticated;
revoke insert, update, delete on public.official_unavailability from anon;

-- ADMIN READ: every period in the tenant. An admin building the schedule has
-- to see all of them — that is the whole point of the grid overlay — so the
-- read half is deliberately wide where the write half below is narrow.
drop policy if exists tenant_admin_read_official_unavailability
  on public.official_unavailability;
create policy tenant_admin_read_official_unavailability
  on public.official_unavailability for select
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

-- ADMIN WRITE: only the rows an admin set themselves.
--
-- This is the ownership rule, and it is deliberately NOT the
-- tenant_admin_manage_* FOR ALL policy the 0004 convention would give. Whoever
-- declared a period owns it: an admin may set, edit and withdraw absences they
-- recorded for someone, but must not rewrite what an official said about their
-- own availability — that statement belongs to the person who made it, and
-- silently editing it would leave the official believing something the
-- schedule no longer reflects.
--
-- Enforced here rather than only in the UI because RLS is the layer that
-- actually holds: the API is reachable without the app.
drop policy if exists tenant_admin_insert_official_unavailability
  on public.official_unavailability;
create policy tenant_admin_insert_official_unavailability
  on public.official_unavailability for insert
  with check (
    created_by_role = 'tenant_admin'
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

-- USING gates which existing rows may be updated; WITH CHECK gates what they
-- may become. Without the second half an admin could flip created_by_role on
-- an official's row and then edit it freely.
drop policy if exists tenant_admin_update_official_unavailability
  on public.official_unavailability;
create policy tenant_admin_update_official_unavailability
  on public.official_unavailability for update
  using (
    created_by_role = 'tenant_admin'
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  )
  with check (
    created_by_role = 'tenant_admin'
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

drop policy if exists tenant_admin_delete_official_unavailability
  on public.official_unavailability;
create policy tenant_admin_delete_official_unavailability
  on public.official_unavailability for delete
  using (
    created_by_role = 'tenant_admin'
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

-- OFFICIAL READ: own rows only, whoever recorded them. An official sees time
-- off an admin set for them — they need to know they have been marked off —
-- but never a colleague's. There is deliberately no tenant_member_read_*
-- policy here: that is what keeps one official's absences invisible to
-- another.
drop policy if exists official_read_own_unavailability on public.official_unavailability;
create policy official_read_own_unavailability
  on public.official_unavailability for select
  using (public.is_own_official_row(official_id));

-- OFFICIAL WRITE: own rows, and only ones they declared themselves. The
-- created_by_role half is the mirror of the admin policies above — an official
-- may not withdraw or rewrite time off the organisers recorded for them, the
-- same way an admin may not rewrite theirs.
drop policy if exists official_insert_own_unavailability on public.official_unavailability;
create policy official_insert_own_unavailability
  on public.official_unavailability for insert
  with check (
    created_by_role = 'official'
    and public.is_own_official_row(official_id)
  );

-- UPDATE needs both halves: USING gates which existing rows are updatable,
-- WITH CHECK gates what they may become. Without WITH CHECK an official could
-- reassign their own row to a colleague's official_id.
drop policy if exists official_update_own_unavailability on public.official_unavailability;
create policy official_update_own_unavailability
  on public.official_unavailability for update
  using (
    created_by_role = 'official'
    and public.is_own_official_row(official_id)
  )
  with check (
    created_by_role = 'official'
    and public.is_own_official_row(official_id)
  );

-- Withdrawing a declared period. The SELECT policy above is what makes the row
-- visible to this DELETE in the first place — a DELETE policy alone silently
-- removes zero rows if nothing can see the row (the lesson from migration
-- 0024).
drop policy if exists official_delete_own_unavailability on public.official_unavailability;
create policy official_delete_own_unavailability
  on public.official_unavailability for delete
  using (
    created_by_role = 'official'
    and public.is_own_official_row(official_id)
  );


-- ============================================================================
-- 5. Officials see who shares their shift
-- ============================================================================
-- Peter's call of 2026-10-07, and the answer to a question this project has
-- deliberately held open since 2026-08-05: officials may see the names of
-- colleagues allocated to the same workstation over the same timeslot, on
-- MYSCH-01. Full names, not initials.
--
-- Until now `official_read_own_assignments` admitted only an official's own
-- rows, so the shift-peer list had no way to read a colleague's assignment.
-- This widens that read by exactly one step: a row is visible when the caller
-- holds a row on the SAME workstation and the SAME timeslot. It does not open
-- the tenant's roster — an official still cannot enumerate who works where in
-- general, only who stands next to them.
--
-- Note what is NOT widened: official_unavailability keeps its own-rows-only
-- read. A colleague's name on a shared shift is roster information; a reason
-- for being away is not.
--
-- security definer, same reasoning as is_on_workstation_shift in migration
-- 20260930084957: the question must be answerable about a shift generally, not
-- only about rows the caller can already see, and the caller's own RLS on
-- `assignments` is narrower than that.

create or replace function public.shares_shift_with_caller(
  p_workstation_id uuid,
  p_timeslot_start timestamptz,
  p_timeslot_end   timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_workstation_id is not null
    and exists (
      select 1
      from public.assignments a
      join public.officials o on o.id = a.official_id
      where a.workstation_id = p_workstation_id
        and a.timeslot_start = p_timeslot_start
        and a.timeslot_end   = p_timeslot_end
        and a.status = 'assigned'
        and o.user_id = auth.uid()
        -- An invited-but-unconfirmed official is not schedulable and must not
        -- gain visibility of a roster, matching canViewOfficialSurfaces.
        and o.invite_status = 'confirmed'
    );
$$;

comment on function public.shares_shift_with_caller is
  'True when the calling user is a confirmed official assigned to the given '
  'workstation over exactly the given timeslot. Widens the official read on '
  'assignments to colleagues on the same shift, and nothing wider.';

-- Replaces the own-rows-only policy. Kept as one policy rather than adding a
-- second: two permissive SELECT policies OR together, which would work, but
-- leaves two places to read when asking "what can an official see here".
drop policy if exists official_read_own_assignments on public.assignments;
create policy official_read_own_assignments
  on public.assignments for select
  using (
    exists (
      select 1
      from public.officials o
      where o.id = assignments.official_id
        and o.user_id = auth.uid()
    )
    or public.shares_shift_with_caller(workstation_id, timeslot_start, timeslot_end)
  );


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('official_unavailability', 'assignments')
--    ORDER BY tablename, policyname;
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.official_unavailability'::regclass;
