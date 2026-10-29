-- ============================================================================
-- Migration 20261028103213: per-tier event cap, archive lock, and Race
-- Results identity per event (N23)
-- ============================================================================
--
-- Three database rules that must hold before a tenant can have a second
-- event. Nothing in the app creates one yet; TEN-01 does, in a later PR.
--
-- 1. THE EVENT CAP. A tenant may have at most MAX_ACTIVE_EVENTS
--    (src/lib/tiers/features.ts) events that are not archived: standard 1,
--    premium 5, professional 20. Enforced in a trigger on events, not in an
--    RPC, because tenant_admin_manage_events lets a tenant admin INSERT
--    events straight through PostgREST — a cap only in an RPC is the same
--    hole B13 was. It fires when an event is created non-archived and when
--    one is un-archived; draft <-> published does not change the count.
--    SECURITY DEFINER so it can lock the tenant row (FOR UPDATE) whoever the
--    caller is: two concurrent creates would otherwise both read the same
--    count and both insert, the race grant_tenant_admin (20261015122314)
--    closes the same way. Raises P0001, the code the N20 admin cap uses for
--    "cap reached".
--
-- 2. THE ARCHIVE LOCK on the event row. While an event is archived nothing
--    on its row may change except status (which is how it is un-archived).
--    Locking the event's stages, work areas and schedule comes with the
--    routing PR, which is where the app learns which event it is editing.
--
-- 3. RACE RESULTS IDENTITY PER EVENT. participants_rr_identity was unique on
--    (tenant_id, external_id). Race Results ids are per Race Results event,
--    so the same id can be a different person next year: importing event 2
--    would have matched event 1's row and overwritten that participant. The
--    index moves to (event_id, external_id), a CHECK makes event_id
--    mandatory on race_results rows (a NULL would slip past the unique
--    index), and import_participants takes the event from its stage and
--    scopes every lookup to it. Its signature and return shape
--    ({ inserted, updated, linked, withdrawn, revived }) are unchanged.
--
-- Forward-fix: replace (import_participants body and participants index
--   replaced; triggers and CHECK added)
--   Rollback: drop trigger if exists events_enforce_cap on public.events;
--             drop trigger if exists events_archive_lock on public.events;
--             drop function if exists public.enforce_event_cap();
--             drop function if exists public.enforce_event_archive_lock();
--             alter table public.participants
--               drop constraint if exists participants_rr_has_event;
--             drop index if exists public.participants_rr_identity;
--             create unique index participants_rr_identity
--               on public.participants (tenant_id, external_id)
--               where source = 'race_results';
--             then restore import_participants from migration
--             20261026094609_import_participants_rpc.sql. The old index can
--             only be recreated while no tenant has the same external_id in
--             two events.
--   Data:     prod snapshot 20261028095200_pre-migration_2026-10-29T12-48-16Z.tar.gz (N23 release).
--             no data loss. Writes no rows; the CHECK and the new index are
--             validated against existing rows (prod: every participant got
--             event_id from 20261028100019, one event per tenant).
--   Blast:    if the cap trigger were wrong, creating an event or saving an
--             archived event's status would fail — nothing creates events
--             in the app yet except create_tenant_with_defaults, whose first
--             event is always within any cap. If the import body were
--             wrong, the Race Results import fails (PART-01) and the
--             transaction rolls back, leaving participants as they were.
--   Window:   compatible. Deployed code calls import_participants with the
--             same arguments and reads the same keys; it never writes
--             'archived' or creates a second event.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Event cap
-- ----------------------------------------------------------------------------

create or replace function public.enforce_event_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier    text;
  v_cap     integer;
  v_current integer;
begin
  if new.status = 'archived' then
    return new;
  end if;

  -- An update that keeps the event active (draft <-> published, a renamed
  -- event) does not change the count.
  if tg_op = 'UPDATE' and old.status <> 'archived' then
    return new;
  end if;

  select tier into v_tier
  from tenants
  where id = new.tenant_id
  for update;

  -- Mirrors MAX_ACTIVE_EVENTS in src/lib/tiers/features.ts. An unrecognised
  -- tier falls to the lowest cap, matching maxActiveEvents().
  v_cap := case v_tier
             when 'professional' then 20
             when 'premium'      then 5
             else 1
           end;

  select count(*) into v_current
  from events
  where tenant_id = new.tenant_id
    and status <> 'archived'
    and id <> new.id;

  if v_current >= v_cap then
    raise exception 'Tenant % is at its event cap (% of %)', new.tenant_id, v_current, v_cap
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_event_cap() is
  'N23: at most MAX_ACTIVE_EVENTS non-archived events per tenant, by tier. '
  'Raises P0001 on create or un-archive past the cap.';

drop trigger if exists events_enforce_cap on public.events;
create trigger events_enforce_cap
  before insert or update of status on public.events
  for each row execute function public.enforce_event_cap();

-- ----------------------------------------------------------------------------
-- 2. Archive lock
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
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_event_archive_lock() is
  'N23: an archived event''s row may change only its status.';

drop trigger if exists events_archive_lock on public.events;
create trigger events_archive_lock
  before update on public.events
  for each row execute function public.enforce_event_archive_lock();

-- ----------------------------------------------------------------------------
-- 3. Race Results identity per event
-- ----------------------------------------------------------------------------

alter table public.participants
  drop constraint if exists participants_rr_has_event;
alter table public.participants
  add constraint participants_rr_has_event
  check (source <> 'race_results' or event_id is not null);

drop index if exists public.participants_rr_identity;
create unique index participants_rr_identity
  on public.participants (event_id, external_id)
  where source = 'race_results';

-- Body as in 20261026094609, with every participant lookup scoped to the
-- stage's event instead of the whole tenant. Comments there still apply and
-- are not repeated; the changed lines are marked N23.
create or replace function public.import_participants(
  p_tenant_id uuid,
  p_stage_id  uuid,
  p_rows      jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_withdrawn integer := 0;
  v_revived   integer := 0;
  v_linked    integer := 0;
  v_seen      text[];
  v_event_id  uuid;
begin
  if p_tenant_id is null or p_stage_id is null then
    raise exception 'import_participants requires a tenant and a stage'
      using errcode = 'P0002';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'import_participants expects p_rows to be a JSON array'
      using errcode = '22023';
  end if;

  -- N23: the stage also names the event the participants belong to.
  select s.event_id into v_event_id
  from public.event_stages s
  where s.id = p_stage_id and s.tenant_id = p_tenant_id;

  if v_event_id is null then
    raise exception 'Stage % does not belong to tenant %', p_stage_id, p_tenant_id
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct r->>'external_id'), array[]::text[])
    into v_seen
  from jsonb_array_elements(p_rows) as r
  where nullif(trim(coalesce(r->>'external_id', '')), '') is not null;

  select count(*) into v_revived
  from public.participants p
  where p.event_id = v_event_id -- N23
    and p.source = 'race_results'
    and p.withdrawn_at is not null
    and p.external_id = any (v_seen);

  with input as (
    select
      nullif(trim(coalesce(r->>'external_id', '')), '') as external_id,
      nullif(trim(coalesce(r->>'name',        '')), '') as name,
      nullif(trim(coalesce(r->>'bib',         '')), '') as bib,
      nullif(trim(coalesce(r->>'category',    '')), '') as category,
      nullif(trim(coalesce(r->>'club',        '')), '') as club,
      nullif(trim(coalesce(r->>'nation',      '')), '') as nation,
      nullif(trim(coalesce(r->>'gender',      '')), '') as gender,
      coalesce(r->'extra', '{}'::jsonb)                 as extra
    from jsonb_array_elements(p_rows) as r
    where nullif(trim(coalesce(r->>'external_id', '')), '') is not null
  ),
  upserted as (
    insert into public.participants as p (
      tenant_id, event_id, source, external_id,
      name, bib, category, club, nation, gender, extra, withdrawn_at
    )
    select
      p_tenant_id, v_event_id, 'race_results', i.external_id, -- N23
      i.name, i.bib, i.category, i.club, i.nation, i.gender, i.extra, null
    from input i
    on conflict (event_id, external_id) where source = 'race_results' -- N23
    do update set
      name     = excluded.name,
      bib      = excluded.bib,
      category = excluded.category,
      club     = excluded.club,
      nation   = excluded.nation,
      gender   = excluded.gender,
      extra    = excluded.extra,
      withdrawn_at = null
    returning p.id, (xmax = 0) as was_inserted, p.withdrawn_at
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
    into v_inserted, v_updated
  from upserted;

  with linked as (
    insert into public.participant_stages (participant_id, stage_id, tenant_id)
    select p.id, p_stage_id, p_tenant_id
    from public.participants p
    where p.event_id = v_event_id -- N23
      and p.source = 'race_results'
      and p.external_id = any (v_seen)
    on conflict (participant_id, stage_id) do nothing
    returning 1
  )
  select count(*) into v_linked from linked;

  with withdrawn as (
    update public.participants p
    set withdrawn_at = now()
    where p.event_id = v_event_id -- N23
      and p.source = 'race_results'
      and p.withdrawn_at is null
      and not (p.external_id = any (v_seen))
      and exists (
        select 1 from public.participant_stages ps
        where ps.participant_id = p.id and ps.stage_id = p_stage_id
      )
    returning 1
  )
  select count(*) into v_withdrawn from withdrawn;

  return jsonb_build_object(
    'inserted',  v_inserted,
    'updated',   v_updated,
    'linked',    v_linked,
    'withdrawn', v_withdrawn,
    'revived',   v_revived
  );
end;
$$;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select tgname from pg_trigger
--   where tgrelid = 'public.events'::regclass and not tgisinternal;
--   -- expect events_enforce_cap and events_archive_lock
--   select pg_get_indexdef('public.participants_rr_identity'::regclass);
--   -- expect (event_id, external_id) WHERE source = 'race_results'
