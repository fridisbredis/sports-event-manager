-- ============================================================================
-- Migration 20261110062834: drop event_facilities (N38 contract)
-- ============================================================================
--
-- Info sections replaced facilities (L24). The expand half
-- (20261109180943 / 20261109181103 / 20261109203226) copied every event's
-- facility labels into a "Facilities" info section and moved the app off
-- the table; that release is in prod since 2026-11-10. This is the
-- contract half:
--
--   1. get_admin_event_cached and get_event_info_cached stop returning the
--      `facilities` key. Everything else is 20261109181103's body.
--   2. create_event stops reading the `facilities` copy key. An unknown key
--      is ignored, so a caller that still sent it would get no error, just
--      nothing copied. Everything else is 20261109203226's body.
--   3. sync_event_facilities is dropped (no caller since #362).
--   4. event_facilities is dropped, with its policies, FKs and the
--      z_archive_lock trigger that hangs off it.
--
-- The functions go first: plpgsql bodies are not dependencies, so dropping
-- the table first would succeed and leave three functions that fail at
-- their next call.
--
-- Forward-fix: destructive (drops table event_facilities and function sync_event_facilities)
--   Rollback: a new migration that recreates event_facilities as 0005 and
--             20260909123808 left it (columns, composite FK, RLS policies
--             from 20261029090324, grants from 0035, the z_archive_lock
--             trigger from 20261029085340), recreates sync_event_facilities
--             from 20260908131614_sync_event_facilities_rpc.sql, restores
--             get_admin_event_cached and get_event_info_cached from
--             20261109181103_event_info_sections_in_cached_rpcs.sql and
--             create_event from
--             20261109203226_create_event_copies_info_sections.sql, then
--             reloads the rows from the snapshot below.
--   Data:     prod snapshot 20261110062834_pre-migration_2026-11-10T06-33-14Z.tar.gz
--             (taken 2026-11-10, before the prod push; holds event_facilities).
--             Prod holds one row (micke-testar, "Parking"), already copied
--             into that event's "Facilities" info section by 20261109180943
--             and verified there in prod on 2026-11-10.
--   Blast:    if a body failed, EVT-02 and INFO-01 would throw for every
--             event, or creating an event would fail, until rolled back.
--   Window:   compatible — this is the contract half. The deployed image
--             (#362) neither reads `facilities` from the RPCs, nor sends
--             the copy key, nor calls sync_event_facilities, nor touches
--             the table.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_event_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id      uuid;
  v_event         jsonb;
  v_stages        jsonb;
  v_distances     jsonb;
  v_info_sections jsonb; -- N38
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  -- Column list matches the `events` select in admin/event/page.tsx
  -- exactly, including
  -- `id` — the page passes it to the child queries and to the editor form.
  select e.id,
         jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'location', e.location,
           'logo_url', e.logo_url,
           'status', e.status,
           'scheduling_granularity_min', e.scheduling_granularity_min
         )
    into v_event_id, v_event
  from public.events e
  where e.tenant_id = p_tenant_id
    and (p_event_id is null or e.id = p_event_id) -- N23
  order by e.created_at asc
  limit 1;

  -- Column list matches that page's `event_stages` select. Note
  -- `race_type`, which
  -- get_event_info_cached does not read, and `results_url`, which it does
  -- (migration 20261013093537).
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'race_type', s.race_type,
               'start_time', s.start_time,
               'end_time', s.end_time,
               'venue', s.venue,
               'results_url', s.results_url,
               'position', s.position
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.event_id = v_event_id
    and s.tenant_id = p_tenant_id;

  -- Column list matches that page's `event_distances` select — no `id`,
  -- as there.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'label', d.label,
               'position', d.position,
               'stage_id', d.stage_id
             )
             order by d.position asc
           ),
           '[]'::jsonb
         )
    into v_distances
  from public.event_distances d
  where d.event_id = v_event_id
    and d.tenant_id = p_tenant_id;

  -- N38: the event's info sections, in the admin's order.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'body', i.body,
               'image_path', i.image_path,
               'link_url', i.link_url,
               'link_label', i.link_label,
               'position', i.position
             )
             order by i.position asc, i.created_at asc
           ),
           '[]'::jsonb
         )
    into v_info_sections
  from public.event_info_sections i
  where i.event_id = v_event_id
    and i.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { id, name, event_type, description, location, logo_url,
  --              status, scheduling_granularity_min } | null,
  --     stages:        [ { id, name, stage_type, race_type, start_time,
  --                        end_time, venue, results_url, position } ],
  --     distances:     [ { label, position, stage_id } ],
  --     info_sections: [ { id, title, body, image_path, link_url,
  --                        link_label, position } ] }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal. The arrays are always arrays, never null; when
  -- `event` is null they are empty, since v_event_id is then NULL and every
  -- child predicate fails.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'distances', v_distances,
    'info_sections', v_info_sections -- N38
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_info_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id      uuid; -- N23
  v_event         jsonb;
  v_stages        jsonb;
  v_info_sections jsonb; -- N38
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  select e.id, -- N23
         jsonb_build_object(
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'logo_url', e.logo_url,
           'status', e.status
         )
    into v_event_id, v_event
  from public.events e
  where e.tenant_id = p_tenant_id
    and (p_event_id is null or e.id = p_event_id)
  order by e.created_at asc
  limit 1;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'stage_date', s.stage_date,
               'start_time', s.start_time,
               'end_time', s.end_time,
               'venue', s.venue,
               'results_url', s.results_url,
               'position', s.position
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.tenant_id = p_tenant_id
    and s.event_id = v_event_id; -- N23

  -- N38: the event's info sections, in the admin's order (L17).
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'body', i.body,
               'image_path', i.image_path,
               'link_url', i.link_url,
               'link_label', i.link_label,
               'position', i.position
             )
             order by i.position asc, i.created_at asc
           ),
           '[]'::jsonb
         )
    into v_info_sections
  from public.event_info_sections i
  where i.tenant_id = p_tenant_id
    and i.event_id = v_event_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { name, event_type, description, logo_url, status } | null,
  --     stages:        [ { id, name, stage_type, stage_date, start_time,
  --                        end_time, venue, results_url, position } ],
  --     info_sections: [ { id, title, body, image_path, link_url,
  --                        link_label, position } ] }
  -- `event` is JSON null when the tenant has no event row; the arrays are
  -- always arrays, never null.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'info_sections', v_info_sections -- N38
  );
end;
$function$;

-- CREATE OR REPLACE keeps owner (cache_rpc_reader) and grants; restated so a
-- reader of this file alone sees the security model.
revoke all on function public.get_admin_event_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_event_cached(uuid, uuid) to service_role;
alter function public.get_admin_event_cached(uuid, uuid) owner to cache_rpc_reader;

revoke all on function public.get_event_info_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_info_cached(uuid, uuid) to service_role;
alter function public.get_event_info_cached(uuid, uuid) owner to cache_rpc_reader;

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
    if v_details or v_stages or v_distances or v_sections or v_work_areas
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
  -- Distances and info sections
  -- --------------------------------------------------------------------------
  if v_distances then
    insert into public.event_distances (tenant_id, event_id, stage_id, label, position)
    select p_tenant_id, v_event_id,
           (v_stage_map ->> d.stage_id::text)::uuid,
           d.label, d.position
    from public.event_distances d
    where d.event_id = p_source_event_id;
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
  'Returns { event_id }.';

revoke all on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_event(uuid, text, uuid, jsonb, jsonb)
  to authenticated;

drop function if exists public.sync_event_facilities(uuid, uuid, jsonb);

drop table if exists public.event_facilities;
