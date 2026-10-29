-- ============================================================================
-- Migration 20261029090324: officials read only the events they are in (N23,
-- 6c-2)
-- ============================================================================
--
-- Peter, 2026-10-28: an official must not reach the data of an event in the
-- same tenant that they are not invited to. Since N23's routing PR the app
-- only ever asks for the caller's own events, but the read policies still
-- followed the 0004 convention — tenant_member_read_<table>, "any role in the
-- tenant" — so an official's session could read every event's stages, work
-- areas and announcements, and the whole roster with phone numbers, straight
-- through PostgREST. This moves the isolation into the database.
--
-- THE RULE, as can_read_event(tenant_id, event_id):
--   system admins and the tenant's admins read every event, as before;
--   anyone else with a role in the tenant (an official) reads an event only
--   if they are a member of it (official_events, via is_event_member).
--
-- WHICH TABLES. Every member-read policy on an event-scoped table:
--   events, event_stages, event_distances, event_facilities, workstations,
--   announcements                                — by event_id (events: id)
--   workstation_operating_windows, workstation_todos,
--   checklist_item_checks, checklist_item_events — through the work area
-- Each tenant_member_read_<table> is dropped and event_member_read_<table>
-- takes its place. Unchanged: the tenant_admin_manage_* policies, the
-- cache_rpc_reader_* policies (the cached RPCs run server-side and the app
-- checks membership before calling them), and the tables whose official reads
-- were already narrower — assignments (own shifts and shift partners),
-- official_unavailability (own), official_events (own), participants (own).
--
-- OFFICIALS, the roster: an official reads their own row and the rows of
-- officials who share at least one event with them (shares_event_with_caller)
-- — the colleagues the official screens name, e.g. who ticked a checklist
-- item. Not the tenant's whole roster.
--
-- A row with a NULL event_id (announcements, until N23's NOT NULL step) is
-- readable by admins only: no official is a member of "no event".
--
-- THE CONVENTION in .claude/CLAUDE.md is updated alongside: event-scoped
-- tables use event_member_read_<table> with can_read_event.
--
-- Helpers are SECURITY DEFINER, like get_user_role and is_event_member, so a
-- policy calling them does not recurse into the tables' own RLS.
--
-- The policies are TO authenticated, unlike the tenant_member_read_* ones
-- (TO public). Only a signed-in session can be a member of anything, and the
-- helpers are executable by authenticated only: a policy for every role made
-- anon and cache_rpc_reader (the cached RPCs' role, 0052) evaluate it and
-- fail on the function's permission instead of reading nothing.
--
-- Forward-fix: replace (RLS policies replaced; helper functions added)
--   Rollback: for each table above, drop policy if exists
--             event_member_read_<table> and recreate tenant_member_read_<table>
--             from migration 0004_fix_rls_policies.sql (officials: the same
--             expression), then drop function if exists
--             public.can_read_event(uuid, uuid),
--             public.shares_event_with_caller(uuid).
--   Data:     no data loss. Writes no rows.
--   Blast:    if a policy were too narrow, an official would see an empty
--             screen (no stages, no work areas) for an event they ARE in, or
--             a missing colleague name. Admin screens are unaffected (the
--             admin branch of can_read_event, and tenant_admin_manage_*).
--   Window:   compatible. Deployed code reads an official's own events only;
--             the routing PR already checks membership in the app.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helpers
-- ----------------------------------------------------------------------------

create or replace function public.can_read_event(p_tenant_id uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin()
      or public.get_user_role(p_tenant_id) = 'tenant_admin'
      or (
        public.get_user_role(p_tenant_id) is not null
        and p_event_id is not null
        and public.is_event_member(p_event_id)
      );
$$;

comment on function public.can_read_event(uuid, uuid) is
  'N23: system and tenant admins read every event of the tenant; anyone else '
  'with a role in it only the events they are a member of.';

create or replace function public.shares_event_with_caller(p_official_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.official_events theirs
    join public.official_events mine on mine.event_id = theirs.event_id
    join public.officials me on me.id = mine.official_id
    where theirs.official_id = p_official_id
      and me.user_id = auth.uid()
  );
$$;

comment on function public.shares_event_with_caller(uuid) is
  'N23: whether the given official is in at least one event with the caller.';

revoke all on function public.can_read_event(uuid, uuid) from public, anon;
revoke all on function public.shares_event_with_caller(uuid) from public, anon;
grant execute on function public.can_read_event(uuid, uuid) to authenticated;
grant execute on function public.shares_event_with_caller(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Tables keyed by event_id
-- ----------------------------------------------------------------------------

drop policy if exists tenant_member_read_events on public.events;
drop policy if exists event_member_read_events on public.events;
create policy event_member_read_events on public.events
  for select to authenticated using (public.can_read_event(tenant_id, id));

drop policy if exists tenant_member_read_event_stages on public.event_stages;
drop policy if exists event_member_read_event_stages on public.event_stages;
create policy event_member_read_event_stages on public.event_stages
  for select to authenticated using (public.can_read_event(tenant_id, event_id));

drop policy if exists tenant_member_read_event_distances on public.event_distances;
drop policy if exists event_member_read_event_distances on public.event_distances;
create policy event_member_read_event_distances on public.event_distances
  for select to authenticated using (public.can_read_event(tenant_id, event_id));

drop policy if exists tenant_member_read_event_facilities on public.event_facilities;
drop policy if exists event_member_read_event_facilities on public.event_facilities;
create policy event_member_read_event_facilities on public.event_facilities
  for select to authenticated using (public.can_read_event(tenant_id, event_id));

drop policy if exists tenant_member_read_workstations on public.workstations;
drop policy if exists event_member_read_workstations on public.workstations;
create policy event_member_read_workstations on public.workstations
  for select to authenticated using (public.can_read_event(tenant_id, event_id));

drop policy if exists tenant_member_read_announcements on public.announcements;
drop policy if exists event_member_read_announcements on public.announcements;
create policy event_member_read_announcements on public.announcements
  for select to authenticated using (public.can_read_event(tenant_id, event_id));

-- ----------------------------------------------------------------------------
-- 3. Tables that reach their event through a work area
-- ----------------------------------------------------------------------------

drop policy if exists tenant_member_read_workstation_op_windows on public.workstation_operating_windows;
drop policy if exists event_member_read_workstation_op_windows on public.workstation_operating_windows;
create policy event_member_read_workstation_op_windows on public.workstation_operating_windows
  for select to authenticated using (exists (
    select 1 from public.workstations w
    where w.id = workstation_operating_windows.workstation_id
      and public.can_read_event(w.tenant_id, w.event_id)
  ));

drop policy if exists tenant_member_read_workstation_todos on public.workstation_todos;
drop policy if exists event_member_read_workstation_todos on public.workstation_todos;
create policy event_member_read_workstation_todos on public.workstation_todos
  for select to authenticated using (exists (
    select 1 from public.workstations w
    where w.id = workstation_todos.workstation_id
      and public.can_read_event(w.tenant_id, w.event_id)
  ));

drop policy if exists tenant_member_read_checklist_item_checks on public.checklist_item_checks;
drop policy if exists event_member_read_checklist_item_checks on public.checklist_item_checks;
create policy event_member_read_checklist_item_checks on public.checklist_item_checks
  for select to authenticated using (exists (
    select 1 from public.workstations w
    where w.id = checklist_item_checks.workstation_id
      and public.can_read_event(w.tenant_id, w.event_id)
  ));

drop policy if exists tenant_member_read_checklist_item_events on public.checklist_item_events;
drop policy if exists event_member_read_checklist_item_events on public.checklist_item_events;
create policy event_member_read_checklist_item_events on public.checklist_item_events
  for select to authenticated using (exists (
    select 1 from public.workstations w
    where w.id = checklist_item_events.workstation_id
      and public.can_read_event(w.tenant_id, w.event_id)
  ));

-- ----------------------------------------------------------------------------
-- 4. The roster
-- ----------------------------------------------------------------------------

drop policy if exists tenant_member_read_officials on public.officials;
drop policy if exists event_member_read_officials on public.officials;
create policy event_member_read_officials on public.officials
  for select to authenticated using (
    public.is_system_admin()
    or public.get_user_role(tenant_id) = 'tenant_admin'
    or user_id = auth.uid()
    or (
      public.get_user_role(tenant_id) is not null
      and public.shares_event_with_caller(id)
    )
  );

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select polrelid::regclass, polname from pg_policy
--   where polname like 'tenant_member_read_%' or polname like 'event_member_read_%'
--   order by 1, 2;
