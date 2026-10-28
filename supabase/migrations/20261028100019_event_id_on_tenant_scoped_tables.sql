-- ============================================================================
-- Migration 20261028100019: event_id on assignments, announcements and
-- participants (N23, expand step)
-- ============================================================================
--
-- N23 makes a tenant an organizer with several events. Stages, distances,
-- facilities and workstations already carry event_id; these three tables
-- only knew their tenant, which was the same thing while every tenant had one
-- event. This adds the column, backfills it, and keeps it filled until the
-- app writes it itself.
--
-- WHICH TABLES. assignments, announcements and participants belong to one
-- event. Left out on purpose:
--   - official_unavailability: says when a PERSON cannot work, which holds
--     whatever event they are scheduled in. Only the official and tenant
--     admins read it.
--   - officials: one row per person per tenant; event membership comes as a
--     separate table in a later N23 PR.
--   - participant_stages, checklist_item_*, sms_queue: already reach an
--     event through stage_id, workstation_id or announcement_id.
--
-- THE COLUMN is nullable here and becomes NOT NULL in a later N23 PR (the
-- contract step), once the app writes it everywhere. tenant_id stays: RLS
-- keys on it. The FK is composite, (event_id, tenant_id) -> events(id,
-- tenant_id), the same pattern as workstations and event_stages, so a row can
-- never point at another tenant's event.
--
-- THE BACKFILL: assignments take their workstation's event; everything else
-- takes the tenant's only event. A tenant with zero or several events is left
-- NULL rather than guessed. Prod has 3 tenants with 1 event each (verified
-- 2026-10-15), so nothing should be left NULL there.
--
-- THE TRIGGER fills event_id on INSERT when the writer left it NULL, by the
-- same rule. Deployed code knows nothing about event_id, so without it every
-- row written between this migration and the routing PR would arrive NULL and
-- need a second backfill. It never overrides a value the writer supplied. It
-- runs as the caller, so RLS decides which events it can see; a caller who
-- cannot see the event leaves the column NULL, which the composite FK and the
-- later NOT NULL step both tolerate until then.
--
-- Forward-fix: destructive (backfills existing rows; columns, indexes, FKs
--   and trigger are additive)
--   Rollback: drop trigger if exists assignments_fill_event_id on public.assignments;
--             drop trigger if exists announcements_fill_event_id on public.announcements;
--             drop trigger if exists participants_fill_event_id on public.participants;
--             drop function if exists public.fill_event_id();
--             alter table public.assignments drop column if exists event_id;
--             alter table public.announcements drop column if exists event_id;
--             alter table public.participants drop column if exists event_id;
--   Data:     no data loss. The backfill writes only the new columns, so
--             dropping them returns every row to its prior state.
--   Blast:    if the fill trigger raised, inserts into the three tables
--             would fail (scheduling saves, announcements, participant
--             import). It only reads events and never raises itself; the
--             composite FK cannot fail on a value it derived from the same
--             tenant.
--   Window:   compatible. New nullable columns; deployed code selects named
--             columns and never event_id. The trigger only fills a NULL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns, composite FKs, indexes
-- ----------------------------------------------------------------------------

alter table public.assignments
  add column if not exists event_id uuid;
alter table public.announcements
  add column if not exists event_id uuid;
alter table public.participants
  add column if not exists event_id uuid;

alter table public.assignments
  drop constraint if exists assignments_event_tenant_fkey;
alter table public.assignments
  add constraint assignments_event_tenant_fkey
  foreign key (event_id, tenant_id) references public.events (id, tenant_id)
  on delete cascade;

alter table public.announcements
  drop constraint if exists announcements_event_tenant_fkey;
alter table public.announcements
  add constraint announcements_event_tenant_fkey
  foreign key (event_id, tenant_id) references public.events (id, tenant_id)
  on delete cascade;

alter table public.participants
  drop constraint if exists participants_event_tenant_fkey;
alter table public.participants
  add constraint participants_event_tenant_fkey
  foreign key (event_id, tenant_id) references public.events (id, tenant_id)
  on delete cascade;

create index if not exists assignments_event_id_idx on public.assignments (event_id);
create index if not exists announcements_event_id_idx on public.announcements (event_id);
create index if not exists participants_event_id_idx on public.participants (event_id);

-- ----------------------------------------------------------------------------
-- 2. Backfill
-- ----------------------------------------------------------------------------

update public.assignments a
set event_id = w.event_id
from public.workstations w
where a.event_id is null
  and w.id = a.workstation_id;

with sole_event as (
  select tenant_id, (array_agg(id))[1] as event_id
  from public.events
  group by tenant_id
  having count(*) = 1
)
update public.assignments t
set event_id = s.event_id
from sole_event s
where t.event_id is null and t.tenant_id = s.tenant_id;

with sole_event as (
  select tenant_id, (array_agg(id))[1] as event_id
  from public.events
  group by tenant_id
  having count(*) = 1
)
update public.announcements t
set event_id = s.event_id
from sole_event s
where t.event_id is null and t.tenant_id = s.tenant_id;

with sole_event as (
  select tenant_id, (array_agg(id))[1] as event_id
  from public.events
  group by tenant_id
  having count(*) = 1
)
update public.participants t
set event_id = s.event_id
from sole_event s
where t.event_id is null and t.tenant_id = s.tenant_id;

-- ----------------------------------------------------------------------------
-- 3. Fill trigger (until the app writes event_id itself)
-- ----------------------------------------------------------------------------

create or replace function public.fill_event_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_workstation_id uuid;
  v_event_ids uuid[];
begin
  if new.event_id is not null then
    return new;
  end if;

  -- assignments: the workstation knows its event. to_jsonb keeps this one
  -- function usable on tables without a workstation_id column.
  v_workstation_id := (to_jsonb(new) ->> 'workstation_id')::uuid;
  if v_workstation_id is not null then
    select w.event_id into new.event_id
    from public.workstations w
    where w.id = v_workstation_id and w.tenant_id = new.tenant_id;

    if new.event_id is not null then
      return new;
    end if;
  end if;

  select array_agg(e.id) into v_event_ids
  from public.events e
  where e.tenant_id = new.tenant_id and e.status <> 'archived';

  if cardinality(v_event_ids) = 1 then
    new.event_id := v_event_ids[1];
  end if;

  return new;
end;
$$;

comment on function public.fill_event_id() is
  'N23 expand step: fills a NULL event_id on insert from the workstation, '
  'else from the tenant''s only non-archived event. Dropped once the app '
  'writes event_id everywhere.';

drop trigger if exists assignments_fill_event_id on public.assignments;
create trigger assignments_fill_event_id
  before insert on public.assignments
  for each row execute function public.fill_event_id();

drop trigger if exists announcements_fill_event_id on public.announcements;
create trigger announcements_fill_event_id
  before insert on public.announcements
  for each row execute function public.fill_event_id();

drop trigger if exists participants_fill_event_id on public.participants;
create trigger participants_fill_event_id
  before insert on public.participants
  for each row execute function public.fill_event_id();

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (expect 0 everywhere while every tenant has one event):
--   select 'assignments', count(*) from public.assignments where event_id is null
--   union all select 'announcements', count(*) from public.announcements where event_id is null
--   union all select 'participants', count(*) from public.participants where event_id is null;
