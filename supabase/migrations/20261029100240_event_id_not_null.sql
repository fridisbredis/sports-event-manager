-- ============================================================================
-- Migration 20261029100240: event_id NOT NULL on assignments, announcements and
-- participants (N23, contract step)
-- ============================================================================
--
-- 20261028100019 added event_id to these three tables as nullable, backfilled
-- it, and installed fill_event_id triggers to keep it filled "until the app
-- writes it itself". The app now does:
--   - participants: the PART-01 action and import_participants write it;
--   - announcements: POST /api/announcements writes it;
--   - assignments: save_assignments_batch does not, and does not need to — an
--     assignment's event IS its work area's event, so the trigger that
--     derives it is kept as the permanent rule, not a stopgap.
-- So: the columns become NOT NULL, and the participants and announcements
-- fill triggers are dropped.
--
-- ROWS STILL NULL. First the 20261028100019 backfill is repeated (sole event
-- per tenant; an assignment's work area). Then:
--   - a NULL row in a tenant WITH events is a bug this migration will not
--     guess about: it raises and nothing is changed;
--   - a NULL row in a tenant with NO events belongs to no event any screen
--     can reach (every admin and official screen is under an event since
--     N23's routing) and is deleted. Dev has one: a test announcement on the
--     event-less "Viadal 2026" copy (verified 2026-10-29). Prod has none to
--     delete (3 tenants, 1 event each, verified 2026-10-15; re-check with the
--     snapshot at release).
--
-- Forward-fix: destructive (deletes rows of event-less tenants; tightens
--   three columns to NOT NULL; drops two triggers)
--   Rollback: alter table public.assignments alter column event_id drop not null;
--             alter table public.announcements alter column event_id drop not null;
--             alter table public.participants alter column event_id drop not null;
--             then recreate announcements_fill_event_id and
--             participants_fill_event_id from migration
--             20261028100019_event_id_on_tenant_scoped_tables.sql.
--   Data:     deleted rows are only those of tenants without events (none
--             expected on prod). Restore from the release snapshot:
--             <SNAPSHOT FILE — fill in at prod release>
--   Blast:    if a writer still omitted event_id, its insert would fail with
--             23502 (not-null): an announcement or a participant could not
--             be saved. Covered by the integration tests of both paths.
--   Window:   compatible. The deployed code writes event_id on both paths.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Last backfill, then refuse or clear what is left
-- ----------------------------------------------------------------------------

do $$
declare
  v_unexpected integer;
  v_deleted    integer;
begin
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
  update public.assignments t set event_id = s.event_id
  from sole_event s where t.event_id is null and t.tenant_id = s.tenant_id;

  with sole_event as (
    select tenant_id, (array_agg(id))[1] as event_id
    from public.events
    group by tenant_id
    having count(*) = 1
  )
  update public.announcements t set event_id = s.event_id
  from sole_event s where t.event_id is null and t.tenant_id = s.tenant_id;

  with sole_event as (
    select tenant_id, (array_agg(id))[1] as event_id
    from public.events
    group by tenant_id
    having count(*) = 1
  )
  update public.participants t set event_id = s.event_id
  from sole_event s where t.event_id is null and t.tenant_id = s.tenant_id;

  select count(*) into v_unexpected
  from (
    select tenant_id from public.assignments where event_id is null
    union all
    select tenant_id from public.announcements where event_id is null
    union all
    select tenant_id from public.participants where event_id is null
  ) x
  where exists (select 1 from public.events e where e.tenant_id = x.tenant_id);

  if v_unexpected > 0 then
    raise exception
      'N23 NOT NULL: % row(s) without event_id in tenants that have events; assign them before re-running',
      v_unexpected;
  end if;

  -- Only rows of tenants without any event are left.
  delete from public.assignments where event_id is null;
  get diagnostics v_deleted = row_count;
  raise notice 'N23 NOT NULL: deleted % event-less assignment(s)', v_deleted;

  delete from public.announcements where event_id is null;
  get diagnostics v_deleted = row_count;
  raise notice 'N23 NOT NULL: deleted % event-less announcement(s)', v_deleted;

  delete from public.participants where event_id is null;
  get diagnostics v_deleted = row_count;
  raise notice 'N23 NOT NULL: deleted % event-less participant(s)', v_deleted;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. NOT NULL, and the stopgap triggers go
-- ----------------------------------------------------------------------------

alter table public.assignments alter column event_id set not null;
alter table public.announcements alter column event_id set not null;
alter table public.participants alter column event_id set not null;

drop trigger if exists announcements_fill_event_id on public.announcements;
drop trigger if exists participants_fill_event_id on public.participants;

-- assignments_fill_event_id stays: it derives the event from the work area,
-- which is what an assignment's event is.
comment on trigger assignments_fill_event_id on public.assignments is
  'N23: an assignment''s event is its work area''s. Fills event_id when the '
  'writer leaves it NULL (save_assignments_batch does).';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select table_name, is_nullable from information_schema.columns
--   where table_schema = 'public' and column_name = 'event_id'
--     and table_name in ('assignments', 'announcements', 'participants');
