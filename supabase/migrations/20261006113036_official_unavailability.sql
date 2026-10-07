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
-- WARN, DO NOT BLOCK — the decision this migration deliberately does NOT encode.
-- Nothing here prevents an admin assigning someone over a declared period, and
-- no constraint or trigger references `assignments`. That follows the capacity
-- rule the project already settled on: over the ceiling warns, only outside a
-- workstation's operating window is hard-blocked. A self-reported absence is
-- softer data than a station's opening hours — it is a request, not a fact —
-- and on event day an admin must be able to call someone in regardless of what
-- they ticked three weeks earlier. The admin grid shows it; the database does
-- not enforce it.
--
-- VISIBILITY. Reads are admins-only, NOT the tenant_member_read_* half of the
-- 0004 convention. Officials do not see each other's absences (decided
-- 2026-10-06); an official reads only their own rows, via the self policy.
-- This is narrower than the convention on purpose and the narrowness is the
-- requirement — widening it later is a product decision about personal data,
-- adjacent to the open question about colleague name visibility.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.official_unavailability;
--             drop function if exists public.is_own_official_row(uuid);
--   Data:     Dropping the table loses every declared period outright, with no
--             copy elsewhere — recoverable only from a backup. Nothing that
--             exists before this migration is read, rewritten or referenced,
--             so no pre-existing data is at risk either way.
--   Blast:    None on deploy. The table starts empty and no existing query
--             joins it; currently deployed code cannot observe it. The grid
--             renders exactly as it does today until this PR's app code ships,
--             and then renders an empty overlay until officials declare
--             something.
--   Window:   Compatible in both directions. Schema-before-code leaves the
--             table unused. Code-before-schema fails the MYSCH-01 declaration
--             form closed (42P01) and leaves the admin grid's overlay empty,
--             without touching the schedule read or the assignment writes —
--             neither depends on this table to render.
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

-- ADMIN: full management. The is_system_admin() clause is mandatory per the
-- project's RLS convention — without it a system_admin cannot reach a tenant
-- where they hold no explicit user_roles row.
drop policy if exists tenant_admin_manage_official_unavailability
  on public.official_unavailability;
create policy tenant_admin_manage_official_unavailability
  on public.official_unavailability for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  )
  with check (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

-- OFFICIAL READ: own rows only. This is the narrow half — there is no
-- tenant_member_read_* policy here, so one official's absences are invisible
-- to another official.
drop policy if exists official_read_own_unavailability on public.official_unavailability;
create policy official_read_own_unavailability
  on public.official_unavailability for select
  using (public.is_own_official_row(official_id));

drop policy if exists official_insert_own_unavailability on public.official_unavailability;
create policy official_insert_own_unavailability
  on public.official_unavailability for insert
  with check (public.is_own_official_row(official_id));

-- UPDATE needs both halves: USING gates which existing rows are updatable,
-- WITH CHECK gates what they may become. Without WITH CHECK an official could
-- reassign their own row to a colleague's official_id.
drop policy if exists official_update_own_unavailability on public.official_unavailability;
create policy official_update_own_unavailability
  on public.official_unavailability for update
  using (public.is_own_official_row(official_id))
  with check (public.is_own_official_row(official_id));

-- Withdrawing a declared period. The SELECT policy above is what makes the row
-- visible to this DELETE in the first place — a DELETE policy alone silently
-- removes zero rows if nothing can see the row (the lesson from migration
-- 0024).
drop policy if exists official_delete_own_unavailability on public.official_unavailability;
create policy official_delete_own_unavailability
  on public.official_unavailability for delete
  using (public.is_own_official_row(official_id));


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename = 'official_unavailability' ORDER BY policyname;
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.official_unavailability'::regclass;
