-- ============================================================================
-- Migration 20261029081215: create_event — a new event, blank or copied from
-- another of the tenant's events, in one transaction (N23, TEN-01)
-- ============================================================================
--
-- TEN-01's "Create event". A tenant like Viadal runs the same race every
-- year, so the point is not re-typing last year's setup: the admin picks a
-- source event and ticks what to carry over. Without a source the event gets
-- the same three default stages create_tenant_with_defaults gives a new
-- tenant's first event.
--
-- WHAT CAN BE COPIED (p_copy, a jsonb of booleans; a missing key is false):
--   details     event_type, description, location. (event_type and the
--               scheduling granularity are always taken from the source, as
--               the event needs them anyway.) The logo is never copied:
--               removeEventLogo deletes the old file from Storage, so two
--               events sharing one path would lose it together.
--   stages      the stages, with new dates (below). results_url is left out:
--               it points at last year's Race Results page.
--   distances   needs stages — distances hang on a stage.
--   facilities  the event-level facility labels.
--   work_areas  needs stages, with their operating windows moved by their
--               stage's date shift.
--   checklists  needs work_areas — checklist items hang on a work area.
-- A dependency left unticked is refused with 22023 rather than silently
-- dropping rows the admin asked for.
--
-- DATES. A stage's start_time and end_time are wall-clock UTC
-- (project_timestamp_convention). p_stage_dates maps each SOURCE stage id
-- that has a start_time to the new stage's date ('YYYY-MM-DD'); the stage
-- keeps its time of day and moves by whole days, so a stage that ran past
-- midnight still does. A dated stage with no date given is refused (22023):
-- copying last year's date would put the new event in the past. Undated
-- stages are copied undated. A work area's operating windows move by the
-- same number of days as its stage; a work area on an undated stage, or on
-- none, is copied without windows, for the same reason.
--
-- The event starts as a DRAFT: nothing is visible to officials until it is
-- published. events.start_date and end_date are derived from the Race stages
-- the way saveEvent does.
--
-- MEMBERSHIP. The tenant's admins are schedulable in every event (CLAUDE.md:
-- "Admin is always schedulable"), and scheduling lists an event's members
-- (official_events), so each admin's confirmed roster row joins the new
-- event. The caller's own membership is marked seen, so the creator gets no
-- "added to a new event" notice for the event they just made. Other
-- officials are added from OFF-01 (N23 7c).
--
-- SECURITY INVOKER: the caller's RLS decides, the tenant_admin_manage_*
-- policies on every table written here, so a non-admin or another tenant's
-- admin can neither read the source nor write the copy. The event cap is
-- enforced by events_enforce_cap (20261028103213), which raises P0001.
--
-- Returns { event_id }. Asserted in tests/integration/create-event.test.ts.
--
-- Forward-fix: additive (new function)
--   Rollback: drop function if exists public.create_event(uuid, text, uuid, jsonb, jsonb);
--   Data:     no data loss.
--   Blast:    if the function were wrong, creating an event fails and
--             nothing is written (one transaction). No other path calls it.
--   Window:   compatible. Deployed code does not call it.
-- ============================================================================

create or replace function public.create_event(
  p_tenant_id       uuid,
  p_name            text,
  p_source_event_id uuid,
  p_copy            jsonb,
  p_stage_dates     jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source      public.events;
  v_event_id    uuid;
  v_copy        jsonb := coalesce(p_copy, '{}'::jsonb);
  v_dates       jsonb := coalesce(p_stage_dates, '{}'::jsonb);
  v_details     boolean := coalesce((v_copy ->> 'details')::boolean, false);
  v_stages      boolean := coalesce((v_copy ->> 'stages')::boolean, false);
  v_distances   boolean := coalesce((v_copy ->> 'distances')::boolean, false);
  v_facilities  boolean := coalesce((v_copy ->> 'facilities')::boolean, false);
  v_work_areas  boolean := coalesce((v_copy ->> 'work_areas')::boolean, false);
  v_checklists  boolean := coalesce((v_copy ->> 'checklists')::boolean, false);
  -- source stage id -> new stage id, and source stage id -> day shift
  v_stage_map   jsonb := '{}'::jsonb;
  v_stage_shift jsonb := '{}'::jsonb;
  v_stage       record;
  v_ws          record;
  v_new_id      uuid;
  v_new_date    date;
  v_shift       integer;
begin
  if p_tenant_id is null or coalesce(trim(p_name), '') = '' then
    raise exception 'create_event requires a tenant and a name'
      using errcode = '22023';
  end if;

  if p_source_event_id is null then
    if v_details or v_stages or v_distances or v_facilities or v_work_areas or v_checklists then
      raise exception 'create_event: nothing can be copied without a source event'
        using errcode = '22023';
    end if;
  else
    -- Through RLS: an event the caller cannot read is reported as missing.
    select * into v_source
    from public.events
    where id = p_source_event_id
      and tenant_id = p_tenant_id;

    if not found then
      raise exception 'create_event: source event % not found', p_source_event_id
        using errcode = 'P0002';
    end if;
  end if;

  if (v_distances and not v_stages)
     or (v_work_areas and not v_stages)
     or (v_checklists and not v_work_areas) then
    raise exception 'create_event: distances and work areas need stages, checklists need work areas'
      using errcode = '22023';
  end if;

  -- The cap trigger runs on this insert.
  insert into public.events (
    tenant_id, name, event_type, status, scheduling_granularity_min,
    description, location
  )
  values (
    p_tenant_id,
    trim(p_name),
    coalesce(v_source.event_type, 'Event'),
    'draft',
    coalesce(v_source.scheduling_granularity_min, 60),
    case when v_details then v_source.description end,
    case when v_details then v_source.location end
  )
  returning id into v_event_id;

  -- --------------------------------------------------------------------------
  -- Stages
  -- --------------------------------------------------------------------------
  if v_stages then
    for v_stage in
      select *
      from public.event_stages
      where event_id = p_source_event_id
      order by position, created_at
    loop
      v_shift := null;
      if v_stage.start_time is not null then
        v_new_date := nullif(v_dates ->> v_stage.id::text, '')::date;
        if v_new_date is null then
          raise exception 'create_event: stage % needs a date', v_stage.id
            using errcode = '22023';
        end if;
        v_shift := v_new_date - (v_stage.start_time at time zone 'UTC')::date;
      end if;

      insert into public.event_stages (
        tenant_id, event_id, name, stage_type, race_type, venue, position,
        start_time, end_time
      )
      values (
        p_tenant_id, v_event_id, v_stage.name, v_stage.stage_type,
        v_stage.race_type, v_stage.venue, v_stage.position,
        v_stage.start_time + make_interval(days => v_shift),
        v_stage.end_time + make_interval(days => v_shift)
      )
      returning id into v_new_id;

      v_stage_map := v_stage_map || jsonb_build_object(v_stage.id::text, v_new_id);
      if v_shift is not null then
        v_stage_shift := v_stage_shift || jsonb_build_object(v_stage.id::text, v_shift);
      end if;
    end loop;
  else
    insert into public.event_stages (event_id, tenant_id, name, stage_type, race_type, position)
    values
      (v_event_id, p_tenant_id, 'Setup',    'non_race', 'distance', 0),
      (v_event_id, p_tenant_id, 'Race',     'race',     'distance', 1),
      (v_event_id, p_tenant_id, 'Teardown', 'non_race', 'distance', 2);
  end if;

  -- --------------------------------------------------------------------------
  -- Distances and facilities
  -- --------------------------------------------------------------------------
  if v_distances then
    insert into public.event_distances (tenant_id, event_id, stage_id, label, position)
    select p_tenant_id, v_event_id,
           (v_stage_map ->> d.stage_id::text)::uuid,
           d.label, d.position
    from public.event_distances d
    where d.event_id = p_source_event_id;
  end if;

  if v_facilities then
    insert into public.event_facilities (tenant_id, event_id, label, position)
    select p_tenant_id, v_event_id, f.label, f.position
    from public.event_facilities f
    where f.event_id = p_source_event_id;
  end if;

  -- --------------------------------------------------------------------------
  -- Work areas, their operating windows, and their checklists
  -- --------------------------------------------------------------------------
  if v_work_areas then
    for v_ws in
      select *
      from public.workstations
      where event_id = p_source_event_id
      order by created_at
    loop
      insert into public.workstations (
        tenant_id, event_id, stage_id, name, description, capacity_ceiling,
        recurring, color
      )
      values (
        p_tenant_id, v_event_id,
        (v_stage_map ->> v_ws.stage_id::text)::uuid,
        v_ws.name, v_ws.description, v_ws.capacity_ceiling,
        v_ws.recurring, v_ws.color
      )
      returning id into v_new_id;

      v_shift := (v_stage_shift ->> v_ws.stage_id::text)::integer;
      if v_shift is not null then
        insert into public.workstation_operating_windows (workstation_id, window_start, window_end)
        select v_new_id,
               w.window_start + make_interval(days => v_shift),
               w.window_end + make_interval(days => v_shift)
        from public.workstation_operating_windows w
        where w.workstation_id = v_ws.id;
      end if;

      if v_checklists then
        insert into public.workstation_todos (workstation_id, instruction_text, position, item_type)
        select v_new_id, t.instruction_text, t.position, t.item_type
        from public.workstation_todos t
        where t.workstation_id = v_ws.id;
      end if;
    end loop;
  end if;

  -- --------------------------------------------------------------------------
  -- Derived dates, as saveEvent derives them
  -- --------------------------------------------------------------------------
  update public.events e
  set start_date = d.first_day,
      end_date   = d.last_day
  from (
    select min((start_time at time zone 'UTC')::date) as first_day,
           max((coalesce(end_time, start_time) at time zone 'UTC')::date) as last_day
    from public.event_stages
    where event_id = v_event_id
      and stage_type = 'race'
      and start_time is not null
  ) d
  where e.id = v_event_id;

  -- --------------------------------------------------------------------------
  -- The tenant's admins join the event
  -- --------------------------------------------------------------------------
  insert into public.official_events (official_id, event_id, tenant_id, seen_at)
  select o.id, v_event_id, p_tenant_id,
         case when o.user_id = auth.uid() then now() end
  from public.officials o
  where o.tenant_id = p_tenant_id
    and o.invite_status = 'confirmed'
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = o.user_id
        and ur.tenant_id = p_tenant_id
        and ur.role = 'tenant_admin'
    )
  on conflict (official_id, event_id) do nothing;

  return jsonb_build_object('event_id', v_event_id);
end;
$$;

comment on function public.create_event(uuid, text, uuid, jsonb, jsonb) is
  'N23 / TEN-01: creates a draft event, blank or copied from another of the '
  'tenant''s events (stages with new dates, distances, facilities, work areas, '
  'checklists), in one transaction. SECURITY INVOKER. Returns { event_id }.';

revoke all on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select p.oid::regprocedure from pg_proc p where p.proname = 'create_event';
