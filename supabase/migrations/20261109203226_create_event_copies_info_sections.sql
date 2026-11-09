-- ============================================================================
-- Migration 20261109203226: create_event copies info sections (N38)
-- ============================================================================
--
-- Info sections replace facilities (L24), so "copy from last year's event"
-- carries the sections over: a new copy key, info_sections, copies every
-- section of the source with its title, text, image, link and position.
--
-- Images ARE copied, unlike the logo (20261029081215 explains why the logo
-- is not: two events sharing one path lost it together on removal). A depot
-- map or a parking sketch is exactly what a yearly race reuses, so instead
-- the app's cleanup is reference-counted: saveInfoSection and
-- deleteInfoSection remove a storage object only when no section in the
-- tenant still points at it.
--
-- The `facilities` key keeps working: the image deployed while this schema
-- goes live still sends it. It goes with event_facilities in the contract
-- migration. Everything else is 20261029081215's body unchanged; new lines
-- are marked N38.
--
-- Forward-fix: replace (create_event body)
--   Rollback: restore create_event from migration 20261029081215_create_event.sql.
--   Data:     prod snapshot: NOT YET TAKEN — run scripts/ops/snapshot-prod-db.sh 20261109203226
--             right before the prod push and put the filename here.
--             no data loss. Writes only into the event being created.
--   Blast:    if the new insert failed, creating an event with "info
--             sections" ticked would fail and write nothing (one
--             transaction); every other option is unchanged.
--   Window:   compatible. Same signature and return shape; the deployed
--             code never sends info_sections.
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
  v_sections    boolean := coalesce((v_copy ->> 'info_sections')::boolean, false); -- N38
  v_work_areas  boolean := coalesce((v_copy ->> 'work_areas')::boolean, false);
  v_checklists  boolean := coalesce((v_copy ->> 'checklists')::boolean, false);
  v_officials   boolean := coalesce((v_copy ->> 'officials')::boolean, false);
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
    if v_details or v_stages or v_distances or v_facilities or v_sections or v_work_areas
       or v_checklists or v_officials then -- N38: v_sections
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

  -- N38: info sections, images included. The copy points at the same
  -- storage object as the source; saveInfoSection and deleteInfoSection
  -- only remove a file no other section still references.
  if v_sections then
    insert into public.event_info_sections (
      tenant_id, event_id, title, body, image_path, link_url, link_label, position
    )
    select p_tenant_id, v_event_id, s.title, s.body, s.image_path, s.link_url,
           s.link_label, s.position
    from public.event_info_sections s
    where s.event_id = p_source_event_id;
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

  -- --------------------------------------------------------------------------
  -- The source event's officials, unseen so they get the in-app notice
  -- --------------------------------------------------------------------------
  if v_officials then
    insert into public.official_events (official_id, event_id, tenant_id)
    select m.official_id, v_event_id, p_tenant_id
    from public.official_events m
    join public.officials o on o.id = m.official_id
    where m.event_id = p_source_event_id
      and o.invite_status <> 'removed'
    on conflict (official_id, event_id) do nothing;
  end if;

  return jsonb_build_object('event_id', v_event_id);
end;
$$;

comment on function public.create_event(uuid, text, uuid, jsonb, jsonb) is
  'N23 / TEN-01: creates a draft event, blank or copied from another of the '
  'tenant''s events (stages with new dates, distances, info sections, work '
  'areas, checklists, officials), in one transaction. SECURITY INVOKER. '
  'Returns { event_id }. The facilities copy key is kept until event_facilities '
  'is dropped (N38).';

revoke all on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  to authenticated;

-- Same signature, so CREATE OR REPLACE keeps the grants; restated for a
-- reader of this file alone.
revoke all on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  to authenticated;
