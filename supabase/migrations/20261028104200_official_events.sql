-- ============================================================================
-- Migration 20261028104200: official_events — which events an official is in
-- (N23)
-- ============================================================================
--
-- N23: officials belong to an event, and an admin can add an official from
-- the tenant's other events. officials stays one row per person per tenant
-- (phone, login, consent, SMS opt-out, avatar), so those can never drift
-- apart between events. This table says which events that person is in.
--
-- MEMBERSHIP ONLY. invite_status stays on officials: a person who has
-- accepted the tenant's invitation does not accept again per event — being
-- added to another event needs only a notice in the app (Frida, 2026-10-28).
-- seen_at is that notice: NULL means "added, not yet shown to them". Rows
-- created here by the backfill and by the fill trigger are marked seen, since
-- for those the invitation itself was the notice.
--
-- TENANT CONSISTENCY by composite FKs, (official_id, tenant_id) ->
-- officials(id, tenant_id) and (event_id, tenant_id) -> events(id,
-- tenant_id), so an official can never be put in another tenant's event. The
-- first needs a unique (id, tenant_id) on officials, added here — the same
-- pairing events and event_stages already have.
--
-- RLS. Tenant admins manage the tenant's memberships (the 0004 convention).
-- Officials read only their OWN rows, not the standard tenant_member_read:
-- under N23 an official must not learn about events they are not in, and
-- another official's memberships would tell them exactly that.
--
-- is_event_member(event_id) is the helper the event-scoped official policies
-- will use when the routing PR makes official surfaces event-aware. SECURITY
-- DEFINER like get_user_role, so a policy calling it does not recurse into
-- this table's RLS. Unused by any policy yet.
--
-- THE BACKFILL puts every official into their tenant's only event. THE
-- TRIGGER does the same for officials inserted while deployed code knows
-- nothing about events (invites, ensure_admin_roster_row), as long as the
-- tenant has exactly one non-archived event; with several, the app must add
-- the membership itself, which it will once TEN-01 exists.
--
-- Forward-fix: destructive (backfills official_events; table, constraint,
--   helper and trigger are additive)
--   Rollback: drop trigger if exists officials_join_sole_event on public.officials;
--             drop function if exists public.add_official_to_sole_event();
--             drop function if exists public.is_event_member(uuid);
--             drop table if exists public.official_events;
--             alter table public.officials drop constraint if exists officials_id_tenant_id_key;
--   Data:     no data loss on rollback before any second event exists: every
--             row is derivable again from officials + the sole event. Once
--             admins add officials to other events, dropping the table loses
--             those memberships.
--   Blast:    the trigger runs on every officials insert. If it raised,
--             inviting an official (OFF-01) and the admin roster row would
--             fail. It only inserts a membership for the row just written,
--             within the same tenant, and ignores a duplicate.
--   Window:   compatible. A new table and a new unique constraint (ids are
--             already unique, so (id, tenant_id) is too); deployed code never
--             reads either.
-- ============================================================================

alter table public.officials
  drop constraint if exists officials_id_tenant_id_key;
alter table public.officials
  add constraint officials_id_tenant_id_key unique (id, tenant_id);

create table if not exists public.official_events (
  official_id uuid not null,
  event_id    uuid not null,
  tenant_id   uuid not null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  primary key (official_id, event_id),
  constraint official_events_official_tenant_fkey
    foreign key (official_id, tenant_id) references public.officials (id, tenant_id)
    on delete cascade,
  constraint official_events_event_tenant_fkey
    foreign key (event_id, tenant_id) references public.events (id, tenant_id)
    on delete cascade
);

create index if not exists official_events_event_id_idx on public.official_events (event_id);

comment on table public.official_events is
  'N23: which events an official is in. Membership only — invite_status '
  'stays on officials. seen_at NULL = added, notice not yet shown.';

alter table public.official_events enable row level security;

-- Same grant reasoning as 20261006113036: a table created by a migration has
-- no base grants for authenticated locally, and a missing grant fails with
-- 42501 before RLS is evaluated.
grant select, insert, update, delete on public.official_events to authenticated;

drop policy if exists tenant_admin_manage_official_events on public.official_events;
create policy tenant_admin_manage_official_events on public.official_events
  for all
  using (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin())
  with check (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin());

drop policy if exists official_read_own_official_events on public.official_events;
create policy official_read_own_official_events on public.official_events
  for select
  using (
    exists (
      select 1 from public.officials o
      where o.id = official_events.official_id and o.user_id = auth.uid()
    )
  );

create or replace function public.is_event_member(p_event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.official_events oe
    join public.officials o on o.id = oe.official_id
    where oe.event_id = p_event_id and o.user_id = auth.uid()
  );
$$;

comment on function public.is_event_member(uuid) is
  'N23: whether the caller is an official in the given event.';

-- Backfill: every official into their tenant's only event.
with sole_event as (
  select tenant_id, (array_agg(id))[1] as event_id
  from public.events
  group by tenant_id
  having count(*) = 1
)
insert into public.official_events (official_id, event_id, tenant_id, seen_at)
select o.id, s.event_id, o.tenant_id, now()
from public.officials o
join sole_event s on s.tenant_id = o.tenant_id
on conflict (official_id, event_id) do nothing;

create or replace function public.add_official_to_sole_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_ids uuid[];
begin
  select array_agg(e.id) into v_event_ids
  from events e
  where e.tenant_id = new.tenant_id and e.status <> 'archived';

  if cardinality(v_event_ids) = 1 then
    insert into official_events (official_id, event_id, tenant_id, seen_at)
    values (new.id, v_event_ids[1], new.tenant_id, now())
    on conflict (official_id, event_id) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.add_official_to_sole_event() is
  'N23 expand step: a new official joins the tenant''s only non-archived '
  'event. Dropped once the app adds memberships itself.';

drop trigger if exists officials_join_sole_event on public.officials;
create trigger officials_join_sole_event
  after insert on public.officials
  for each row execute function public.add_official_to_sole_event();

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (expect 0 while every tenant has one event):
--   select count(*) from public.officials o
--   where not exists (select 1 from public.official_events oe where oe.official_id = o.id);
