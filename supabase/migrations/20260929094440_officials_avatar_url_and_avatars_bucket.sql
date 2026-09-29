-- ============================================================================
-- Migration 20260929094440: officials.avatar_url + avatars storage bucket
-- ============================================================================
--
-- ACCT-01 profile pictures. Adds a nullable avatar_url to officials and a
-- public 'avatars' storage bucket, so the initials-circle on the account
-- screens (and the officials list, scheduling grid and HOME-01 greeting that
-- draw the same initials) can render an uploaded picture instead.
--
-- Path pattern: avatars/{tenantId}/{officialId}/{timestamp}.{ext} — the same
-- tenant-first shape as the 'logos' bucket (0015), so storage.foldername()[1]
-- stays the tenant scope every policy here keys off.
--
-- The write policies deliberately differ from 0015's. Logos are tenant
-- branding, so only a tenant_admin may write them. An avatar belongs to one
-- person: an official uploads their own, which means the policy has to allow
-- a plain 'official' role to write — but only under their own officials row,
-- hence the second folder segment being matched against an officials row
-- owned by auth.uid(). A tenant_admin keeps blanket write access over their
-- own tenant's folder (they administer the roster, and the admin account
-- screen writes through the same path).
--
-- Public bucket, matching 'logos': avatars are shown to every signed-in
-- member of the tenant, and a public object URL avoids a signed-URL round
-- trip on every list row. The filename carries a timestamp, so the URL is
-- unguessable in practice but not a security boundary — nothing sensitive
-- is inferable from a profile picture beyond what the roster already shows
-- to fellow members.
--
-- Forward-fix: additive
--   Rollback: alter table public.officials drop column if exists avatar_url;
--             drop policy if exists "avatars_public_read" on storage.objects;
--             drop policy if exists "avatars_own_or_admin_insert" on storage.objects;
--             drop policy if exists "avatars_own_or_admin_update" on storage.objects;
--             drop policy if exists "avatars_own_or_admin_delete" on storage.objects;
--             delete from storage.buckets where id = 'avatars';
--             (dropping the bucket row needs its objects removed first; the
--             uploaded files themselves are not recoverable from Postgres.)
--   Data:     No data loss — new nullable column, new bucket, new policies.
--             Nothing existing is read or rewritten.
--   Blast:    None. Until the app code in this same PR writes avatar_url, the
--             column stays null everywhere and every avatar keeps rendering
--             its initials fallback.
--   Window:   Compatible. A new nullable column is invisible to the currently
--             deployed code, which neither selects nor inserts it, and the new
--             bucket/policies touch no object any running code reaches.
-- ============================================================================

alter table public.officials
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- The write check, factored out so the three policies below can't drift apart.
-- SECURITY DEFINER + `set search_path = public`, matching this project's other
-- helper functions (0017, 0018, 0022, 0026-0030, 0043, 0045, 0046): the
-- officials lookup has to see rows the caller's own RLS would hide, since an
-- official can only select their own tenant's rows and the storage policy runs
-- before any of that is established.
create or replace function public.can_write_avatar_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce() on the role comparison: get_user_role() returns NULL for a user
  -- with no role in that tenant, which would make the whole OR chain NULL
  -- rather than false. NULL denies in a policy just as false does, so this is
  -- not a live hole -- it is pinned so the function answers a plain boolean
  -- and stays safe to reuse anywhere the three-valued result would not deny.
  select
    (storage.foldername(object_name))[1] ~ '^[0-9a-f-]{36}$'
    and (storage.foldername(object_name))[2] ~ '^[0-9a-f-]{36}$'
    and (
      coalesce(
        public.get_user_role((storage.foldername(object_name))[1]::uuid) = 'tenant_admin',
        false
      )
      or coalesce(public.is_system_admin(), false)
      or exists (
        select 1
        from public.officials o
        where o.id = (storage.foldername(object_name))[2]::uuid
          and o.tenant_id = (storage.foldername(object_name))[1]::uuid
          and o.user_id = auth.uid()
          and o.invite_status = 'confirmed'
      )
    );
$$;

revoke all on function public.can_write_avatar_object(text) from public, anon;
grant execute on function public.can_write_avatar_object(text) to authenticated, service_role;

-- Public read (bucket is public so anyone can fetch URLs)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Write access: the official who owns the row in folder segment 2, or a
-- tenant_admin / system_admin over the tenant in folder segment 1.
drop policy if exists "avatars_own_or_admin_insert" on storage.objects;
create policy "avatars_own_or_admin_insert"
  on storage.objects for insert to authenticated
  with check (public.can_write_avatar_object(name));

drop policy if exists "avatars_own_or_admin_update" on storage.objects;
create policy "avatars_own_or_admin_update"
  on storage.objects for update to authenticated
  using (public.can_write_avatar_object(name));

drop policy if exists "avatars_own_or_admin_delete" on storage.objects;
create policy "avatars_own_or_admin_delete"
  on storage.objects for delete to authenticated
  using (public.can_write_avatar_object(name));
