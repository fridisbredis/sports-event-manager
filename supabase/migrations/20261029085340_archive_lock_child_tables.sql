-- ============================================================================
-- Migration 20261029085340: the archive lock reaches an event's stages, work
-- areas and schedule (N23)
-- ============================================================================
--
-- 20261028103213 locked an archived event's own row and left the rest for
-- later: "Locking the event's stages, work areas and schedule comes with the
-- routing PR". The routing has landed, so archiving now freezes the event's
-- setup as well. Un-archiving (status back to draft) lifts it.
--
-- WHAT IS LOCKED, by table and by write:
--   event_stages, event_distances, event_facilities, workstations,
--   workstation_operating_windows, workstation_todos
--       insert, update, delete — the event's setup.
--   assignments, announcements, participants, checklist_item_checks,
--   checklist_item_events
--       insert and update only (participants and announcements: insert
--       only). Deletes stay open, because removing a person reaches into
--       every event: remove_official and remove_official_from_event free the
--       official's shifts, and anonymize_inactive_users (0029) rewrites
--       participants. Those must keep working for an archived event; a lock
--       there would make a GDPR erasure fail. participants and announcements
--       updates stay open for the same reason and for the SMS worker, which
--       moves a queued announcement's status.
--
-- The event is found through event_id, or through the work area for the
-- tables that hang on one (and for an assignment the event_id fill trigger
-- has not reached yet). An UPDATE checks the row before and after, so a row
-- cannot be moved into or out of an archived event.
--
-- DELETING AN EVENT still cascades: by the time the cascade reaches a child
-- row the event row is gone, the lookup finds nothing, and the lock lets the
-- row go. Only a missing-or-archived lookup of an EXISTING archived event
-- refuses.
--
-- TRIGGER ORDER. Postgres fires same-timing row triggers in name order. The
-- lock is named z_archive_lock so it runs after the *_fill_event_id triggers
-- (20261028100019) and sees the event_id they fill.
--
-- THE ERROR. P0004, new and custom, so the app can say "this event is
-- archived" instead of a generic failure (DB_ERROR_KEYS in
-- src/lib/actions/db-error-message.ts). The event row's own lock raised
-- 42501, which the logs read as an RLS refusal; it is replaced here to raise
-- P0004 too, with its rule unchanged.
--
-- SECURITY DEFINER for the status lookup only: an official ticking a
-- checklist item may not be able to read the events row through RLS, and the
-- lock must not depend on who is asking. It reads one column and writes
-- nothing.
--
-- Forward-fix: replace (enforce_event_archive_lock body replaced; new
--   function and triggers added)
--   Rollback: drop function if exists public.enforce_child_archive_lock() cascade;
--             (drops every z_archive_lock trigger with it), then restore
--             enforce_event_archive_lock from migration
--             20261028103213_event_cap_archive_lock_rr_identity_per_event.sql.
--   Data:     no data loss. Writes no rows.
--   Blast:    if the lock were wrong, edits to an event's stages, work areas,
--             schedule, participants or announcements would be refused —
--             for archived events by design, for active ones only through a
--             bug in the lookup, which the integration tests cover.
--   Window:   compatible. Deployed code never writes to an archived event's
--             setup on purpose; if it tries, it now gets P0004 where it got
--             success, and shows its generic error until the new image adds
--             the message.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The event row's own lock: same rule, P0004
-- ----------------------------------------------------------------------------

create or replace function public.enforce_event_archive_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'archived'
     and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Event % is archived; un-archive it before editing', old.id
      using errcode = 'P0004';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. The child tables
-- ----------------------------------------------------------------------------

-- The event a row belongs to: its event_id, else its work area's event.
create or replace function public.archive_lock_event_of(p_row jsonb)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (p_row ->> 'event_id')::uuid,
    (select w.event_id from public.workstations w
     where w.id = (p_row ->> 'workstation_id')::uuid)
  );
$$;

create or replace function public.enforce_child_archive_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
begin
  foreach v_event in array array[
    case when tg_op in ('UPDATE', 'DELETE') then public.archive_lock_event_of(to_jsonb(old)) end,
    case when tg_op in ('INSERT', 'UPDATE') then public.archive_lock_event_of(to_jsonb(new)) end
  ]
  loop
    if v_event is not null and exists (
      select 1 from public.events where id = v_event and status = 'archived'
    ) then
      raise exception 'Event % is archived; un-archive it before editing', v_event
        using errcode = 'P0004';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.enforce_child_archive_lock() is
  'N23: refuses writes to an archived event''s setup and schedule. Raises P0004.';

revoke all on function public.archive_lock_event_of(jsonb) from public, anon, authenticated;
revoke all on function public.enforce_child_archive_lock() from public, anon, authenticated;

-- Setup: every write.
drop trigger if exists z_archive_lock on public.event_stages;
create trigger z_archive_lock before insert or update or delete on public.event_stages
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.event_distances;
create trigger z_archive_lock before insert or update or delete on public.event_distances
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.event_facilities;
create trigger z_archive_lock before insert or update or delete on public.event_facilities
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.workstations;
create trigger z_archive_lock before insert or update or delete on public.workstations
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.workstation_operating_windows;
create trigger z_archive_lock before insert or update or delete on public.workstation_operating_windows
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.workstation_todos;
create trigger z_archive_lock before insert or update or delete on public.workstation_todos
  for each row execute function public.enforce_child_archive_lock();

-- Schedule and check-offs: new rows and changes, not deletes.
drop trigger if exists z_archive_lock on public.assignments;
create trigger z_archive_lock before insert or update on public.assignments
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.checklist_item_checks;
create trigger z_archive_lock before insert or update on public.checklist_item_checks
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.checklist_item_events;
create trigger z_archive_lock before insert or update on public.checklist_item_events
  for each row execute function public.enforce_child_archive_lock();

-- Announcements and participants: new rows only.
drop trigger if exists z_archive_lock on public.announcements;
create trigger z_archive_lock before insert on public.announcements
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.participants;
create trigger z_archive_lock before insert on public.participants
  for each row execute function public.enforce_child_archive_lock();

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select tgrelid::regclass from pg_trigger where tgname = 'z_archive_lock' order by 1;
