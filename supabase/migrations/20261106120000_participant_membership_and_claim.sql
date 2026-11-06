-- ============================================================================
-- Migration 20261106120000: one account, several roles — participant
-- membership and claim_participant (N35, Participant 1/10, L5/L26)
-- ============================================================================
--
-- L5: one phone number is one user per tenant, and the same person can be an
-- official in one event and a participant in another — or both in the same
-- event. The role belongs to the event membership, not to the user.
--
-- WHAT THE MODEL ALREADY HAD. Event membership with a role is already stored
-- per event, in two places, and this migration keeps both:
--   official    — official_events (official_id -> officials.user_id), N23
--   participant — participants (event_id NOT NULL since N23, user_id)
-- Neither needs a user account to exist: an official is invited by phone, a
-- participant is imported without one. That is why a generic
-- (user_id, event_id, role) table is NOT introduced — it could not hold the
-- pre-login half of either membership, and would duplicate both.
--
-- user_roles stays one row per (user_id, tenant_id). It is the TENANT ACCESS
-- TIER — tenant_admin > official > participant — which get_user_role, the
-- post-login routing and every app guard read. Migration 0047 already made a
-- participant row upgrade to 'official' on invite confirmation and never
-- downgrade an admin; this follows the same rule. Changing that key to
-- (user_id, tenant_id, role) would invalidate the ON CONFLICT (user_id,
-- tenant_id) clause in every invite/grant RPC for no gain the card needs.
--
-- WHAT WAS MISSING, and what this adds:
--
-- 1. participants_user_id_key made a user linkable to ONE participant row in
--    the whole platform. Since N23 a participant row is per event, so the
--    same runner in two events (or two tenants) is two rows, and the second
--    link failed with 23505. Replaced by uniqueness per (event_id, user_id):
--    still no split identity inside one event, which is what N21's comment
--    guarded against.
--
-- 2. Nothing granted or removed the participant tier. sync_participant_role
--    derives it: a user with a linked participant row in the tenant and no
--    user_roles row gets 'participant'; a 'participant' row with no linked
--    participant left is deleted. It never touches an official or admin row.
--    Triggers call it when a link changes (participants) and when a higher
--    role is deleted (user_roles), so:
--      - removing the official role of someone who is also a participant
--        leaves them a participant (remove_official deletes the 'official'
--        row; the trigger puts 'participant' back), and
--      - unlinking the participant of someone who is also an official leaves
--        the official row untouched.
--    L26: a user whose last membership goes keeps the auth account (nothing
--    here deletes auth.users) and simply has no role row and no event.
--
-- 3. claim_participant: links an account to a participant record, in one
--    transaction. The participant tier follows from the trigger, so an
--    official who claims keeps their single 'official' row and no second
--    user is ever created. The claim UI is N40; this is the server-side half.
--
--    The record's phone is NOT a credential. Imported participants have no
--    phone at all (Race Results carries none, 20261026084206). In Peter's
--    flow (N39/N40, L6/L9) the runner picks their row from the open claim
--    list and verifies THEIR phone by SMS code: the SMS-verified auth phone
--    is the proof, and the first claim wins (conflicts are N42). So the
--    claim writes the account's phone into participants.phone (N41: PART-01's
--    phone column fills in on claim), overwriting whatever an admin typed —
--    the verified number is the better fact. Stored like officials.phone:
--    E.164 without '+', exactly as auth.users holds it (normalizePhoneToE164,
--    SEC-04). Service-role only, like confirm_official_invite_by_phone: the
--    phone is read from auth.users for p_user_id, never taken from the
--    caller.
--
-- 4. A participant can read the events row of an event they are entered in
--    (event_participant_read_events), so the event picker can name it.
--    Deliberately NOT the rest of the event-scoped tables: can_read_event /
--    is_event_member stay official-only, so a participant does not see work
--    areas, todos, checklists or officials' announcements. N43 (participant
--    screens) decides what else a participant reads. events.status is not
--    consulted here; whether a draft event is visible to its participants is
--    N36's decision.
--
-- Forward-fix: replace (unique index replaced by a looser one; new helpers,
--   triggers, RPC and one new read policy)
--   Rollback: drop trigger if exists participants_sync_participant_role on public.participants;
--             drop trigger if exists user_roles_sync_participant_role on public.user_roles;
--             drop function if exists public.participants_sync_participant_role();
--             drop function if exists public.user_roles_sync_participant_role();
--             drop function if exists public.claim_participant(uuid, uuid, uuid);
--             drop function if exists public.sync_participant_role(uuid, uuid);
--             drop policy if exists event_participant_read_events on public.events;
--             drop function if exists public.is_event_participant(uuid);
--             drop index if exists public.participants_event_id_user_id_key;
--             create unique index participants_user_id_key on public.participants (user_id)
--               where user_id is not null;
--             The last statement fails once any user is linked to participant
--             rows in two events; unlink one of them first (that is the
--             state the old index cannot represent). 'participant'
--             user_roles rows written by the trigger are ordinary rows and
--             can stay.
--   Data:     prod snapshot: NOT YET TAKEN — run scripts/ops/snapshot-prod-db.sh 20261106120000
--             right before the prod push and put the filename here. Writes
--             no rows when it runs (participants.user_id is NULL on every
--             prod row, so the new index validates trivially). The triggers
--             write user_roles rows on later changes.
--   Blast:    if sync_participant_role raised, every participants insert/
--             delete/link change and every user_roles delete would fail —
--             PART-01 add/remove, the RR import, remove_official,
--             revoke_tenant_admin. It returns early for a missing user or
--             tenant (cascading deletes) and only ever writes the one
--             (user_id, tenant_id) row with ON CONFLICT DO NOTHING.
--   Window:   compatible. Deployed code never writes participants.user_id,
--             so the triggers only fire for paths that keep working
--             (participant user_id NULL -> no-op). The looser index rejects
--             nothing the old one accepted. The new events policy only adds
--             rows for a linked participant, of which prod has none.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Participant link uniqueness: per event, not platform-wide
-- ----------------------------------------------------------------------------

create unique index if not exists participants_event_id_user_id_key
  on public.participants (event_id, user_id)
  where user_id is not null;

drop index if exists public.participants_user_id_key;

-- participants_user_id_idx (20261026104544) stays: participant_read_own and
-- is_event_participant filter on user_id alone.

-- ----------------------------------------------------------------------------
-- 2. The participant tier in user_roles, derived from the links
-- ----------------------------------------------------------------------------

create or replace function public.sync_participant_role(p_user_id uuid, p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_linked boolean;
begin
  if p_user_id is null or p_tenant_id is null then
    return;
  end if;

  -- Cascading deletes (an auth user, a tenant) reach here after the parent
  -- row is gone; inserting a role for it would fail the whole delete.
  if not exists (select 1 from auth.users where id = p_user_id)
     or not exists (select 1 from public.tenants where id = p_tenant_id) then
    return;
  end if;

  select role into v_role
  from public.user_roles
  where user_id = p_user_id and tenant_id = p_tenant_id;

  v_linked := exists (
    select 1 from public.participants
    where user_id = p_user_id and tenant_id = p_tenant_id
  );

  if v_role is null and v_linked then
    insert into public.user_roles (user_id, tenant_id, role)
    values (p_user_id, p_tenant_id, 'participant')
    on conflict (user_id, tenant_id) do nothing;
  elsif v_role = 'participant' and not v_linked then
    delete from public.user_roles
    where user_id = p_user_id and tenant_id = p_tenant_id and role = 'participant';
  end if;
end;
$$;

comment on function public.sync_participant_role(uuid, uuid) is
  'N35: grants ''participant'' to a user with a linked participant row and no '
  'role in the tenant, and drops a ''participant'' row with no link left. Never '
  'touches official/tenant_admin rows. Called by triggers and claim_participant.';

create or replace function public.participants_sync_participant_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.user_id is not null then
    perform public.sync_participant_role(old.user_id, old.tenant_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.user_id is not null then
    perform public.sync_participant_role(new.user_id, new.tenant_id);
  end if;
  return null;
end;
$$;

drop trigger if exists participants_sync_participant_role on public.participants;
create trigger participants_sync_participant_role
  after insert or delete or update of user_id, tenant_id on public.participants
  for each row execute function public.participants_sync_participant_role();

create or replace function public.user_roles_sync_participant_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_participant_role(old.user_id, old.tenant_id);
  return null;
end;
$$;

-- Only when a HIGHER role goes: deleting a 'participant' row must not bring
-- it straight back, and a system_admin row has no tenant.
drop trigger if exists user_roles_sync_participant_role on public.user_roles;
create trigger user_roles_sync_participant_role
  after delete on public.user_roles
  for each row
  when (old.tenant_id is not null and old.role <> 'participant')
  execute function public.user_roles_sync_participant_role();

-- ----------------------------------------------------------------------------
-- 3. claim_participant
-- ----------------------------------------------------------------------------

create or replace function public.claim_participant(
  p_user_id        uuid,
  p_participant_id uuid,
  p_tenant_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant  participants%rowtype;
  v_user_phone   text;
  v_had_role     boolean;
  v_role_granted boolean;
begin
  select phone into v_user_phone from auth.users where id = p_user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select * into v_participant
  from participants
  where id = p_participant_id and tenant_id = p_tenant_id
  for update;

  if v_participant.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_participant.user_id = p_user_id then
    return jsonb_build_object(
      'participant_id', v_participant.id,
      'event_id', v_participant.event_id,
      'role_granted', false
    );
  end if;

  if v_participant.user_id is not null then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from participants
    where event_id = v_participant.event_id and user_id = p_user_id
  ) then
    raise exception 'already_in_event' using errcode = 'P0001';
  end if;

  v_had_role := exists (
    select 1 from user_roles where user_id = p_user_id and tenant_id = p_tenant_id
  );

  -- The participants trigger grants 'participant' if the user had no role.
  -- The verified phone replaces the record's; an account without one (not
  -- possible with SMS login, but auth.users allows it) keeps what is there.
  update participants
  set user_id = p_user_id,
      phone = coalesce(nullif(ltrim(v_user_phone, '+'), ''), phone)
  where id = v_participant.id;

  v_role_granted := not v_had_role and exists (
    select 1 from user_roles where user_id = p_user_id and tenant_id = p_tenant_id
  );

  return jsonb_build_object(
    'participant_id', v_participant.id,
    'event_id', v_participant.event_id,
    'role_granted', v_role_granted
  );
end;
$$;

comment on function public.claim_participant(uuid, uuid, uuid) is
  'N35: links an account to a participant record in the tenant (first claim '
  'wins) and writes the account''s verified phone (auth.users, E.164 without '
  '+) into participants.phone. The participant tier follows from the trigger; '
  'an existing official/admin row is kept. Idempotent for the same user. '
  'Raises not_found / already_claimed / already_in_event (P0001). Returns { participant_id, '
  'event_id, role_granted }. Service role only.';

-- ----------------------------------------------------------------------------
-- 4. A participant reads the events they are entered in
-- ----------------------------------------------------------------------------

create or replace function public.is_event_participant(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.participants
    where event_id = p_event_id and user_id = auth.uid()
  );
$$;

comment on function public.is_event_participant(uuid) is
  'N35: whether the caller is linked to a participant row in the given event.';

drop policy if exists event_participant_read_events on public.events;
create policy event_participant_read_events on public.events
  for select to authenticated using (public.is_event_participant(id));

-- ----------------------------------------------------------------------------
-- 5. Grants. New functions in public get EXECUTE for anon and authenticated
--    from the schema's default ACL; revoking from PUBLIC alone does not
--    remove those.
-- ----------------------------------------------------------------------------

revoke all on function public.sync_participant_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.participants_sync_participant_role() from public, anon, authenticated;
revoke all on function public.user_roles_sync_participant_role() from public, anon, authenticated;
revoke all on function public.claim_participant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_participant(uuid, uuid, uuid) to service_role;

revoke all on function public.is_event_participant(uuid) from public, anon;
grant execute on function public.is_event_participant(uuid) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select indexname from pg_indexes where tablename = 'participants'
--     and indexname in ('participants_user_id_key', 'participants_event_id_user_id_key');
--   -- expect only participants_event_id_user_id_key
--   select proname, proacl from pg_proc
--   where proname in ('claim_participant', 'sync_participant_role', 'is_event_participant');
--   -- claim_participant/sync_participant_role: no anon, no authenticated
--   select tgname from pg_trigger
--   where tgname like '%sync_participant_role';
--   -- expect 2 rows
-- ============================================================================
