-- ============================================================================
-- Migration 20261127094110: in-app feedback (N71)
-- ============================================================================
--
-- Any signed-in user (tenant admin, official, participant, and a system admin
-- working inside a tenant's admin view) can send feedback of one of three
-- types — question, bug, feature request — with a title, a body and one
-- optional image. The sender sees their own feedback and its status; system
-- admins see everything and are the only ones who change the status
-- (new / in_progress / done / declined). No reply text in v1.
--
-- NOT THE STANDARD TENANT POLICIES. tenant_member_read_<table> would let every
-- member of a tenant read every other member's feedback, and feedback is
-- personal — a bug report can name a colleague. So reading is "own rows or
-- system admin", and there is no tenant_admin_manage_<table>: a tenant admin
-- is a sender like anyone else here.
--
-- WRITES. Senders only insert; a sent feedback is never edited or deleted by
-- its sender in v1. The insert grant is column-level and leaves out status,
-- created_at and updated_at, so a sender cannot file a report as already
-- "done" or backdate it. The insert check (can_insert_feedback) pins user_id
-- to the caller, user_role to a role the caller actually holds in that tenant,
-- event_id to an event of that same tenant, and image_path to the caller's own
-- folder for this very row. Status changes go through update_feedback_status()
-- only — an RPC with a two-column write list instead of an UPDATE policy,
-- which would let the caller send any column unless a WITH CHECK re-asserted
-- every other one (and silently stop doing so when a column is added).
--
-- user_role IS A SNAPSHOT, NOT A JOIN. Roles change after the fact (an admin
-- is demoted, an official leaves the event); the triage page must show who
-- the sender was when they wrote it. A person can hold several roles in one
-- tenant (admin + official), so the check accepts any role they hold rather
-- than comparing to get_user_role(), which returns an arbitrary one of them.
--
-- tenant_id IS NOT NULL: every submission comes from inside a tenant (a system
-- admin sends from a tenant's admin view, not from /admin — decided for v1).
--
-- IMAGES. Private bucket 'feedback-images', path
-- {tenantId}/{userId}/{feedbackId}/{filename}. Read through short-lived signed
-- URLs: the sender reads their own folder, a system admin reads all. The app
-- uploads the image before inserting the row (an orphaned file is invisible;
-- a row pointing at a missing file is a broken card on the triage page), and
-- deletes the upload again if the insert fails — so a sender may delete their
-- own object, but only while no feedback row references it.
-- file_size_limit and allowed_mime_types make storage enforce the 5 MB and
-- png/jpeg/webp limits itself, not only the route handler.
--
-- CASCADES. Rows go with the tenant and with the auth user. Deleting an event
-- keeps the feedback and clears event_id. Storage objects do not cascade —
-- whether feedback (rows and images) joins the SEC-09 anonymisation sweep is a
-- follow-up decision, not part of this migration.
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration:
--             drop policy if exists "feedback_images_insert_own" on storage.objects;
--             drop policy if exists "feedback_images_read_own_or_system_admin" on storage.objects;
--             drop policy if exists "feedback_images_delete_unreferenced_own" on storage.objects;
--             drop function if exists public.can_write_feedback_object(text);
--             drop function if exists public.can_read_feedback_object(text);
--             drop function if exists public.can_delete_feedback_object(text);
--             drop function if exists public.update_feedback_status(uuid, text);
--             drop table if exists public.feedback;
--             drop function if exists public.can_insert_feedback(uuid, uuid, uuid, text, text);
--             delete from storage.buckets where id = 'feedback-images';
--             (the bucket row needs its objects removed first; uploaded images
--             are not recoverable from Postgres.)
--   Data:     no data loss — new table, bucket, functions and policies only.
--             Nothing existing is read or rewritten.
--   Blast:    none for the currently deployed code, which does not know any
--             of these objects exist.
--   Window:   compatible — nothing deployed reads or writes them yet.
-- ============================================================================

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_role text not null
    check (user_role in ('system_admin', 'tenant_admin', 'official', 'participant')),
  type text not null check (type in ('question', 'bug', 'feature')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  page_path text not null check (char_length(page_path) <= 500),
  image_path text check (image_path is null or char_length(image_path) <= 500),
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'done', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "My feedback" list: own rows, newest first.
create index if not exists feedback_user_id_created_at_idx
  on public.feedback (user_id, created_at desc);
-- Serve the cascades from tenants and events.
create index if not exists feedback_tenant_id_idx on public.feedback (tenant_id);
create index if not exists feedback_event_id_idx on public.feedback (event_id);

comment on table public.feedback is
  'N71: in-app feedback (question / bug / feature) from any signed-in user. Sender reads own rows, system admins read all and change status via update_feedback_status().';

alter table public.feedback enable row level security;

-- Explicit grants (a local `supabase db reset` does not add them, and a missing
-- grant fails 42501 before RLS is evaluated — see the KEEP IN SYNC note in
-- seed.sql). Insert is column-level: status, created_at and updated_at keep
-- their defaults. No update/delete grant: senders never change a sent row,
-- and status goes through the SECURITY DEFINER RPC below. anon: nothing.
--
-- REVOKE FIRST. Supabase's default privileges in the public schema hand every
-- new table ALL to authenticated and SELECT to anon, so a grant alone only adds
-- to that: the column-level insert grant would be shadowed by the table-wide
-- INSERT, and a sender could insert status = 'done'. Verified locally — without
-- this revoke, authenticated held INSERT/UPDATE/DELETE on the whole table.
-- service_role keeps its default (it bypasses RLS; nothing in the app uses it here).
revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant insert (id, tenant_id, event_id, user_id, user_role, type, title, body, page_path, image_path)
  on public.feedback to authenticated;

-- The insert check, in one SECURITY DEFINER helper (same reason as
-- can_write_avatar_object in 20260929094440): it looks at user_roles and
-- events rows the caller's own RLS may hide — a participant cannot select the
-- events table, and the check must still confirm the event is in the tenant.
create or replace function public.can_insert_feedback(
  p_id uuid,
  p_tenant_id uuid,
  p_event_id uuid,
  p_user_role text,
  p_image_path text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    -- The role must be one the caller holds in this tenant, or system_admin
    -- for a system admin (whose user_roles row has tenant_id null).
    and (
      (p_user_role = 'system_admin' and coalesce(public.is_system_admin(), false))
      or exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.tenant_id = p_tenant_id
          and ur.role = p_user_role
      )
    )
    and (
      p_event_id is null
      or exists (
        select 1 from public.events e
        where e.id = p_event_id and e.tenant_id = p_tenant_id
      )
    )
    -- The image must sit in the caller's own folder for this very row, so a
    -- row cannot point at someone else's upload.
    and (
      p_image_path is null
      or (
        (storage.foldername(p_image_path))[1] = p_tenant_id::text
        and (storage.foldername(p_image_path))[2] = auth.uid()::text
        and (storage.foldername(p_image_path))[3] = p_id::text
        and array_length(storage.foldername(p_image_path), 1) = 3
      )
    );
$$;

revoke all on function public.can_insert_feedback(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.can_insert_feedback(uuid, uuid, uuid, text, text) to authenticated;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own"
  on public.feedback for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_insert_feedback(id, tenant_id, event_id, user_role, image_path)
  );

-- Own rows, or every row for a system admin. Deliberately no tenant clause.
drop policy if exists "feedback_select_own_or_system_admin" on public.feedback;
create policy "feedback_select_own_or_system_admin"
  on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.is_system_admin());

-- Status change: system admins only. Returns the shape the server action reads
-- ({ id, status }); grep every .rpc('update_feedback_status' call site before
-- changing it (see the RPC return-shape contracts in migrations.md).
create or replace function public.update_feedback_status(
  p_feedback_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
begin
  if not coalesce(public.is_system_admin(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('new', 'in_progress', 'done', 'declined') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;

  update public.feedback
  set status = p_status, updated_at = now()
  where id = p_feedback_id
  returning id, status into v_id, v_status;

  if v_id is null then
    raise exception 'feedback not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

revoke all on function public.update_feedback_status(uuid, text) from public, anon;
grant execute on function public.update_feedback_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-images',
  'feedback-images',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Write: only into your own folder ({tenantId}/{yourUserId}/{feedbackId}/file)
-- of a tenant you hold a role in (or as a system admin).
create or replace function public.can_write_feedback_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and array_length(storage.foldername(object_name), 1) = 3
    and (storage.foldername(object_name))[1] ~ '^[0-9a-f-]{36}$'
    and (storage.foldername(object_name))[2] = auth.uid()::text
    and (storage.foldername(object_name))[3] ~ '^[0-9a-f-]{36}$'
    and (
      coalesce(public.is_system_admin(), false)
      or exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.tenant_id = (storage.foldername(object_name))[1]::uuid
      )
    );
$$;

-- Read: your own folder, or everything for a system admin.
create or replace function public.can_read_feedback_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      (storage.foldername(object_name))[2] = auth.uid()::text
      or coalesce(public.is_system_admin(), false)
    );
$$;

-- Delete: your own upload, only while no feedback row references it — the
-- cleanup after a failed insert, never a way to blank a sent report's image.
create or replace function public.can_delete_feedback_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (storage.foldername(object_name))[2] = auth.uid()::text
    and not exists (
      select 1 from public.feedback f where f.image_path = object_name
    );
$$;

revoke all on function public.can_write_feedback_object(text) from public, anon;
revoke all on function public.can_read_feedback_object(text) from public, anon;
revoke all on function public.can_delete_feedback_object(text) from public, anon;
grant execute on function public.can_write_feedback_object(text) to authenticated;
grant execute on function public.can_read_feedback_object(text) to authenticated;
grant execute on function public.can_delete_feedback_object(text) to authenticated;

drop policy if exists "feedback_images_insert_own" on storage.objects;
create policy "feedback_images_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback-images' and public.can_write_feedback_object(name));

drop policy if exists "feedback_images_read_own_or_system_admin" on storage.objects;
create policy "feedback_images_read_own_or_system_admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'feedback-images' and public.can_read_feedback_object(name));

drop policy if exists "feedback_images_delete_unreferenced_own" on storage.objects;
create policy "feedback_images_delete_unreferenced_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'feedback-images' and public.can_delete_feedback_object(name));
