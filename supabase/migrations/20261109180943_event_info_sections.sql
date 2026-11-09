-- ============================================================================
-- Migration 20261109180943: info sections on an event (N38, Participant 4/10,
-- R1-R4, L17, L23, L24)
-- ============================================================================
--
-- The admin writes flexible info sections on EVT-02 — Getting there, Parking,
-- Depot area, Live video, Merch — and INFO-01 shows them right after the
-- identity block, in the admin's order. A section has a title and at least
-- one of text, image and link (L23). Live video and merch are ordinary links
-- (R3, R4). Organiser text is stored as typed and never translated.
--
-- They replace the facilities list (L24). This is the EXPAND half: the new
-- table is added and each event's facilities are copied into one section
-- titled 'Facilities' (labels as "• label" lines, in their position order),
-- but event_facilities is left in place because the deployed code still
-- reads and writes it. A later destructive migration drops it once no
-- deployed code reads the `facilities` key any more.
--
-- 1. event_info_sections. Event-scoped, so the composite (event_id,
--    tenant_id) FK of SEC-01 pins the event to the row's tenant. Both rules
--    of L23 are CHECKs, not only Zod: a non-blank title, and at least one of
--    body / image_path / link_url. A link must be http(s) so a section can
--    never carry a javascript: URL into an <a href>. image_path is the
--    storage path in event-info-images; the public URL is built in the app
--    with getPublicUrl, as the event logo is.
--
-- 2. RLS, N23 event-scoped convention: tenant admins manage; anyone who can
--    read the event reads. cache_rpc_reader gets the same tenant-pinned read
--    policy as every other table behind the cached Group 1 RPCs (0051), so
--    get_event_info_cached / get_admin_event_cached can return the sections.
--
--    No participant read policy. "Participants see sections once the event
--    is published" depends on the tenant's tier as well as events.status —
--    a Standard event always reads as Draft (displayedEventStatus, N36) —
--    so the gate lives in the app next to that function, and participant
--    screens read through the cached RPC like officials do (N43).
--
-- 3. Storage bucket event-info-images, public like `logos` (0015): INFO-01
--    renders the image by URL, and paths carry three uuids. Writes are
--    limited to the tenant's admins via the first path segment, same as
--    logos. Path: {tenantId}/{eventId}/{sectionId}/{timestamp}.webp.
--
-- 4. reorder_event_info_sections: rewrites every position of one event in a
--    single UPDATE (REL-01), SECURITY INVOKER so RLS decides who may. It
--    refuses a list that is not exactly the event's sections, so a stale
--    client cannot leave two sections on the same position.
--
-- 5. The facilities copy. Idempotent: an event that already has a section
--    titled 'Facilities' is skipped. Prod has one facilities row (verified
--    2026-11-09: tenant micke-testar, 'Parking'); Viadal has none.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.reorder_event_info_sections(uuid, uuid, uuid[]);
--             drop table if exists public.event_info_sections;
--             delete from storage.objects where bucket_id = 'event-info-images';
--             drop policy if exists event_info_images_public_read on storage.objects;
--             drop policy if exists event_info_images_tenant_admin_insert on storage.objects;
--             drop policy if exists event_info_images_tenant_admin_update on storage.objects;
--             drop policy if exists event_info_images_tenant_admin_delete on storage.objects;
--             delete from storage.buckets where id = 'event-info-images';
--   Data:     no data loss. event_facilities is only read; the copied rows
--             are new rows in a new table.
--   Blast:    none for deployed code — nothing reads the new table yet. If
--             the copy were wrong, only the 'Facilities' section would be.
--   Window:   compatible. The deployed code keeps using event_facilities.
--             A facility added or removed in the old UI between this
--             migration and the new image is not reflected in the copied
--             section (minutes; prod holds one test row).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------

create table if not exists public.event_info_sections (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  event_id    uuid not null,
  title       text not null,
  body        text,
  image_path  text,
  link_url    text,
  link_label  text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint event_info_sections_event_tenant_fkey
    foreign key (event_id, tenant_id) references public.events (id, tenant_id) on delete cascade,
  constraint event_info_sections_title_not_blank check (btrim(title) <> ''),
  constraint event_info_sections_has_content check (
    nullif(btrim(body), '') is not null
    or image_path is not null
    or nullif(btrim(link_url), '') is not null
  ),
  constraint event_info_sections_link_is_http check (
    link_url is null or link_url ~* '^https?://'
  ),
  constraint event_info_sections_label_needs_link check (
    link_label is null or link_url is not null
  )
);

create index if not exists event_info_sections_event_position_idx
  on public.event_info_sections (event_id, position);
create index if not exists event_info_sections_tenant_id_idx
  on public.event_info_sections (tenant_id);

comment on table public.event_info_sections is
  'N38: flexible info sections an admin writes for one event (EVT-02), shown '
  'on INFO-01 in position order. Replaces event_facilities (L24).';

-- ----------------------------------------------------------------------------
-- 2. RLS and grants
-- ----------------------------------------------------------------------------

alter table public.event_info_sections enable row level security;
alter table public.event_info_sections force row level security;

drop policy if exists tenant_admin_manage_event_info_sections on public.event_info_sections;
create policy tenant_admin_manage_event_info_sections
  on public.event_info_sections for all
  using (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin())
  with check (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin());

drop policy if exists event_member_read_event_info_sections on public.event_info_sections;
create policy event_member_read_event_info_sections
  on public.event_info_sections for select
  using (public.can_read_event(tenant_id, event_id));

drop policy if exists cache_rpc_reader_read_event_info_sections on public.event_info_sections;
create policy cache_rpc_reader_read_event_info_sections
  on public.event_info_sections for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

-- Explicit grants (see user_ice_contacts / seed.sql KEEP IN SYNC note): a
-- local db reset does not add them, and a missing grant fails 42501 before
-- RLS is even consulted.
grant select, insert, update, delete on public.event_info_sections to authenticated;
grant select, insert, update, delete on public.event_info_sections to service_role;
grant select on public.event_info_sections to cache_rpc_reader;

-- ----------------------------------------------------------------------------
-- 3. Storage bucket
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('event-info-images', 'event-info-images', true)
on conflict (id) do nothing;

drop policy if exists event_info_images_public_read on storage.objects;
create policy event_info_images_public_read
  on storage.objects for select
  using (bucket_id = 'event-info-images');

drop policy if exists event_info_images_tenant_admin_insert on storage.objects;
create policy event_info_images_tenant_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-info-images'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.get_user_role((storage.foldername(name))[1]::uuid) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

drop policy if exists event_info_images_tenant_admin_update on storage.objects;
create policy event_info_images_tenant_admin_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'event-info-images'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.get_user_role((storage.foldername(name))[1]::uuid) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

drop policy if exists event_info_images_tenant_admin_delete on storage.objects;
create policy event_info_images_tenant_admin_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-info-images'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.get_user_role((storage.foldername(name))[1]::uuid) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Reorder RPC
-- ----------------------------------------------------------------------------

create or replace function public.reorder_event_info_sections(
  p_tenant_id uuid,
  p_event_id  uuid,
  p_ids       uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing integer;
  v_updated  integer;
begin
  select count(*) into v_existing
  from event_info_sections
  where tenant_id = p_tenant_id and event_id = p_event_id;

  if p_ids is null
     or cardinality(p_ids) <> v_existing
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'reorder_event_info_sections: ids do not match the event''s sections'
      using errcode = '22023';
  end if;

  update event_info_sections s
  set position = o.ord - 1,
      updated_at = now()
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.id = o.id
    and s.tenant_id = p_tenant_id
    and s.event_id = p_event_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_existing then
    raise exception 'reorder_event_info_sections: ids do not match the event''s sections'
      using errcode = '22023';
  end if;
end;
$$;

comment on function public.reorder_event_info_sections(uuid, uuid, uuid[]) is
  'N38 / REL-01: sets position = index in p_ids for every info section of '
  'the event in one statement. p_ids must be exactly the event''s sections. '
  'SECURITY INVOKER: RLS limits it to tenant admins.';

revoke all on function public.reorder_event_info_sections(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.reorder_event_info_sections(uuid, uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Copy facilities into one 'Facilities' section per event
-- ----------------------------------------------------------------------------

insert into public.event_info_sections (tenant_id, event_id, title, body, position)
select f.tenant_id,
       f.event_id,
       'Facilities',
       string_agg('• ' || btrim(f.label), E'\n' order by f.position, f.created_at),
       0
from public.event_facilities f
where btrim(f.label) <> ''
  and not exists (
    select 1 from public.event_info_sections s
    where s.event_id = f.event_id and s.title = 'Facilities'
  )
group by f.tenant_id, f.event_id;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select count(*) from public.event_info_sections where title = 'Facilities';
--   -- expect one per event that has facilities (prod: 1)
--   select id, public from storage.buckets where id = 'event-info-images';
--   select proname, proacl from pg_proc where proname = 'reorder_event_info_sections';
