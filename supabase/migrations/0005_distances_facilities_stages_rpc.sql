-- ============================================================================
-- Migration 0005: event_distances, event_facilities, and sync_event_stages RPC
-- ============================================================================
--
-- Adds:
--   - event_distances: distance options offered at an event (in-scope MVP item 1)
--   - event_facilities: facilities available at an event (in-scope MVP item 1)
--   - sync_event_stages RPC: atomically replaces all stages for one event
--     so the application never ends up with a partial stage list
--
-- See: docs/problem-statement-mvp-scope.md §"MVP scope (in)" item 1
-- UI for distances and facilities is NOT yet built in EVT-02; see TODO in
-- src/app/(tenant)/[tenantSlug]/event/_components/event-config-form.tsx
--
-- RLS policy pattern (mandatory — see CLAUDE.md §"When writing new RLS policies"):
--   tenant_admin_manage_<table>: get_user_role(tenant_id) = 'tenant_admin' OR is_system_admin()
--   tenant_member_read_<table>:  get_user_role(tenant_id) IS NOT NULL    OR is_system_admin()
-- Direct subqueries on user_roles (the 0003 style) are obsolete. Do not use them.
--
-- Defensive: uses DROP POLICY IF EXISTS so this can be re-run.
-- ============================================================================


-- ============================================================================
-- 1. EVENT_DISTANCES
-- ============================================================================
-- Simple list of distances offered at the event (e.g. "5 km", "50 km", "100 km").
-- Event-neutral: label is free text so any sport can use it.

create table if not exists event_distances (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  label       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists event_distances_event_id_idx  on event_distances(event_id);
create index if not exists event_distances_tenant_id_idx on event_distances(tenant_id);

comment on table event_distances is
  'Distances offered at an event (free-text, event-neutral). MVP scope item 1.';

alter table event_distances enable row level security;

drop policy if exists "tenant_admin_manage_event_distances" on public.event_distances;
create policy "tenant_admin_manage_event_distances"
  on public.event_distances for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

drop policy if exists "tenant_member_read_event_distances" on public.event_distances;
create policy "tenant_member_read_event_distances"
  on public.event_distances for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );


-- ============================================================================
-- 2. EVENT_FACILITIES
-- ============================================================================
-- Facilities visible to officials and participants (e.g. "Showers", "Parking",
-- "Medical tent"). Event-neutral: label is free text.

create table if not exists event_facilities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  label       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists event_facilities_event_id_idx  on event_facilities(event_id);
create index if not exists event_facilities_tenant_id_idx on event_facilities(tenant_id);

comment on table event_facilities is
  'Facilities at an event (free-text, event-neutral). MVP scope item 1.';

alter table event_facilities enable row level security;

drop policy if exists "tenant_admin_manage_event_facilities" on public.event_facilities;
create policy "tenant_admin_manage_event_facilities"
  on public.event_facilities for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

drop policy if exists "tenant_member_read_event_facilities" on public.event_facilities;
create policy "tenant_member_read_event_facilities"
  on public.event_facilities for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );


-- ============================================================================
-- 3. sync_event_stages RPC
-- ============================================================================
-- Atomically replaces all stages for one event within a single transaction.
-- Prevents partial stage lists if a multi-step delete+insert were interrupted.
--
-- Runs as SECURITY INVOKER (default) so the caller's RLS context applies.
-- The application layer (saveEvent server action) verifies tenant_admin role
-- before calling this function; RLS on event_stages provides a second layer.
--
-- Parameters:
--   p_event_id  — the event whose stages are being replaced
--   p_tenant_id — used in the DELETE filter and INSERT rows
--   p_stages    — JSON array: [{name, stage_date, venue, position}, ...]
--                 Rows with missing name or stage_date are silently skipped.

create or replace function public.sync_event_stages(
  p_event_id  uuid,
  p_tenant_id uuid,
  p_stages    jsonb
)
returns void
language plpgsql
as $$
begin
  delete from event_stages
  where event_id = p_event_id and tenant_id = p_tenant_id;

  insert into event_stages (event_id, tenant_id, name, stage_date, venue, position)
  select
    p_event_id,
    p_tenant_id,
    (s->>'name')::text,
    (s->>'stage_date')::date,
    nullif(trim((s->>'venue')::text), ''),
    coalesce((s->>'position')::integer, 0)
  from jsonb_array_elements(p_stages) as s
  where
    trim((s->>'name')::text)       <> '' and (s->>'name')       is not null
    and trim((s->>'stage_date')::text) <> '' and (s->>'stage_date') is not null;
end;
$$;

comment on function public.sync_event_stages is
  'Atomically replaces all stages for p_event_id within one transaction. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS).';


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify tables with:
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('event_distances', 'event_facilities');
--
-- Verify policies with:
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('event_distances', 'event_facilities')
--   order by tablename, policyname;
--
-- Verify RPC with:
--   select proname from pg_proc where proname = 'sync_event_stages';
