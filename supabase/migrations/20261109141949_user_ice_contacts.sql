-- ============================================================================
-- Migration 20261109141949: ICE contact per user (N37)
-- ============================================================================
--
-- N37. Every user can give one emergency (ICE) contact: phone, name and
-- relation, all optional (R5a, R5b). Entered at invite acceptance (AUTH-02),
-- later at claim (CLAIM-02, N40), editable on My account (ACCT-01).
--
-- ONE ROW PER USER, NOT PER TENANT. The contact belongs to the person, so a
-- user with roles in two tenants has one ICE contact, and an admin of either
-- tenant reads the same row. user_id is the primary key; the app upserts on it.
--
-- WHY A TABLE OF ITS OWN. Columns on officials would leak: since
-- 20261029090324, event_member_read_officials lets every official in an event
-- read every colleague's officials row, and RLS cannot hide single columns.
-- user_preferences is owner-only by design; ICE needs a second reader.
--
-- WHO READS IT
--   - the user themself (read + write, own row only);
--   - a tenant_admin of any tenant in which the user holds a role
--     (read only — admins never edit someone's ICE contact);
--   - a system_admin.
-- Officials and participants never read anyone else's row. The admin check
-- lives in can_read_ice_contact(): the CALLER must be tenant_admin in a tenant
-- where the TARGET has a user_roles row. Writing that the other way round
-- ("the target is an admin") would be a silent leak — covered by a test.
--
-- GDPR. The row holds a third person's phone number. It goes with the auth
-- user (on delete cascade). Same retention gap push_subscriptions had: nothing
-- deletes inactive auth users, so a follow-up migration modelled on
-- 20261030073124_delete_inactive_push_subscriptions.sql deletes rows of users
-- inactive 24+ months (SEC-09).
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration,
--             drop table if exists public.user_ice_contacts;
--             drop function if exists public.can_read_ice_contact(uuid);
--   Data:     no data loss on apply (new, empty table). A rollback deletes
--             every stored ICE contact; not recoverable except from a backup
--             taken after users started entering them.
--   Blast:    none for the currently deployed code, which does not know this
--             table exists. If it were missing once the new image is live,
--             saving ICE on ACCT-01/AUTH-02 fails visibly and OFF-01 shows
--             no ICE; invite acceptance itself must not depend on it.
--   Window:   compatible — a new table and function nothing deployed uses.
-- ============================================================================

create table if not exists public.user_ice_contacts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text check (phone is null or char_length(phone) <= 32),
  name text check (name is null or char_length(name) <= 200),
  relation text check (relation is null or char_length(relation) <= 100),
  updated_at timestamptz not null default now()
);

comment on table public.user_ice_contacts is
  'N37: one emergency contact per user. Readable by the user, tenant admins of tenants the user has a role in, and system admins.';

-- Explicit grants (see push_subscriptions / seed.sql KEEP IN SYNC note):
-- a local db reset does not add them and a missing grant fails 42501 before
-- RLS. anon gets nothing — no signed-out flow touches ICE.
grant select, insert, update, delete on public.user_ice_contacts to authenticated;
grant select, insert, update, delete on public.user_ice_contacts to service_role;

create or replace function public.can_read_ice_contact(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin()
      or exists (
        select 1
        from public.user_roles caller
        join public.user_roles target
          on target.tenant_id = caller.tenant_id
        where caller.user_id = auth.uid()
          and caller.role = 'tenant_admin'
          and target.user_id = p_user_id
      );
$$;

comment on function public.can_read_ice_contact(uuid) is
  'N37: true if the caller is system_admin, or tenant_admin in a tenant where the given user holds a role.';

revoke all on function public.can_read_ice_contact(uuid) from public, anon;
grant execute on function public.can_read_ice_contact(uuid) to authenticated;

alter table public.user_ice_contacts enable row level security;

drop policy if exists user_manage_own_ice_contact on public.user_ice_contacts;
drop policy if exists admin_read_ice_contact on public.user_ice_contacts;

-- Own row: read and write. FOR ALL covers SELECT, so the upsert can see the
-- conflicting row (the 0024 trap).
create policy user_manage_own_ice_contact
  on public.user_ice_contacts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins: read only.
create policy admin_read_ice_contact
  on public.user_ice_contacts for select
  using (public.can_read_ice_contact(user_id));
