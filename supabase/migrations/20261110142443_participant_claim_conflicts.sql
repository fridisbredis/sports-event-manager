-- ============================================================================
-- Migration 20261110142443: claim conflicts (N42, Participant 8/10, L6/L11/L18)
-- ============================================================================
--
-- L6 says the first claim wins. N42 adds what happens to the second: someone
-- who taps "This is me" on an already claimed record goes through the same
-- CLAIM-02 steps (number, SMS code, both boxes) and ends as a CONFLICT. They
-- get no access. The first claimant keeps theirs until an admin, who has
-- talked to both people outside the app, picks Keep current or Switch to new
-- on PART-01. Neither choice sends an SMS (L18).
--
-- 1. participant_claim_conflicts: one row per (participant, new claimant).
--    Several claimants on the same record are each stored (Frida 2026-11-10,
--    the card's open question): the third person to tap "This is me" may be
--    the real runner, so nobody is dropped or overwritten. The same person
--    trying again is one row (unique per participant and user).
--    phone is the claimant's SMS-verified number, read from auth.users by
--    the RPC and stored like participants.phone (E.164 without '+').
--    created_at is also when they accepted the privacy policy: the RPC
--    refuses to store a conflict without it, and Switch to new carries it
--    over as privacy_accepted_at.
--
--    RLS: admins only. Officials and participants read nothing here: a row
--    is a phone number of someone with no role in the tenant yet. Rows are
--    WRITTEN only by submit_participant_claim (service role) and removed by
--    an admin (Keep current) or the trigger below.
--
-- 2. submit_participant_claim: what CLAIM-02's Complete now calls. One
--    transaction that either claims (complete_participant_claim, unchanged)
--    or, when someone else holds the record, stores the conflict. Deciding
--    under the row lock is what keeps "two people press Complete at once"
--    from becoming two claims or a lost conflict. Returns
--    { participant_id, event_id, role_granted, outcome: 'claimed'|'conflict' }.
--    complete_participant_claim stays: the deployed image calls it.
--
-- 3. participants_clear_claim_conflicts (trigger): when a record's user_id
--    changes, its pending conflicts are settled — by Switch to new, or by
--    Unlink, after which the record is simply claimable again. And when a
--    user is linked to a record, their own pending conflicts elsewhere in
--    that event go: they found their row, and switching them onto a second
--    one would hit participants_event_id_user_id_key anyway.
--
-- 4. switch_participant_claimant: Switch to new. SECURITY INVOKER, so the
--    caller's RLS is the access check — an admin reaches the conflict row,
--    anyone else gets not_found. Moves the record to the new claimant with
--    their phone and consent time, clears the old claimant's photo (it is of
--    them), and returns the old photo URL so the app can remove the file.
--    The trigger then clears every pending conflict on the record, and
--    sync_participant_role grants the new claimant 'participant' and drops
--    it from the old one if this was their only record.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.switch_participant_claimant(uuid, uuid, uuid);
--             drop trigger if exists participants_clear_claim_conflicts on public.participants;
--             drop function if exists public.participants_clear_claim_conflicts();
--             drop function if exists public.submit_participant_claim(uuid, uuid, uuid, uuid, boolean);
--             drop table if exists public.participant_claim_conflicts;
--             (revert the app first: the claim route calls
--             submit_participant_claim and PART-01 reads the table.)
--   Data:     no data loss. Dropping the table loses pending conflicts only;
--             those people can tap "This is me" again.
--   Blast:    if submit_participant_claim raised for every call, no runner
--             could complete a claim (CLAIM-02's generic error). If the
--             trigger raised, every change of participants.user_id would
--             fail: claim, unlink, switch. It only deletes from the new table.
--   Window:   compatible. The deployed image never calls the new functions;
--             the trigger fires on its claim and unlink with nothing to
--             delete.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------

create table if not exists public.participant_claim_conflicts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  event_id       uuid not null references public.events (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  phone          text check (phone is null or char_length(phone) <= 32),
  created_at     timestamptz not null default now(),
  constraint participant_claim_conflicts_participant_user_key unique (participant_id, user_id)
);

comment on table public.participant_claim_conflicts is
  'N42: a second (or later) SMS-verified claim on an already claimed participant '
  'record, waiting for an admin''s Keep current / Switch to new. One row per '
  'participant and claimant. Admin-only through RLS; written by '
  'submit_participant_claim.';

-- PART-01 and EVT-01 count and filter per event; the unique key already
-- covers lookups by participant_id.
create index if not exists participant_claim_conflicts_event_id_idx
  on public.participant_claim_conflicts (event_id);
-- The trigger deletes a user's conflicts in an event when they are linked.
create index if not exists participant_claim_conflicts_user_id_idx
  on public.participant_claim_conflicts (user_id);

alter table public.participant_claim_conflicts enable row level security;

drop policy if exists tenant_admin_manage_participant_claim_conflicts
  on public.participant_claim_conflicts;
create policy tenant_admin_manage_participant_claim_conflicts
  on public.participant_claim_conflicts
  for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  )
  with check (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

-- Admins read and dismiss. Inserts and updates go through the RPC only.
revoke all on table public.participant_claim_conflicts from anon, authenticated;
grant select, delete on table public.participant_claim_conflicts to authenticated;
grant select, insert, update, delete on table public.participant_claim_conflicts to service_role;

-- ----------------------------------------------------------------------------
-- 2. submit_participant_claim
-- ----------------------------------------------------------------------------

create or replace function public.submit_participant_claim(
  p_user_id          uuid,
  p_participant_id   uuid,
  p_tenant_id        uuid,
  p_event_id         uuid,
  p_privacy_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holder     uuid;
  v_user_phone text;
  v_result     jsonb;
begin
  if p_privacy_accepted is distinct from true then
    raise exception 'privacy_not_accepted' using errcode = 'P0001';
  end if;

  -- The same scope check complete_participant_claim makes, taken here with
  -- the row lock so the claimed/unclaimed decision below cannot go stale.
  select user_id into v_holder
  from participants
  where id = p_participant_id
    and tenant_id = p_tenant_id
    and event_id = p_event_id
    and withdrawn_at is null
    and hidden_at is null
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Unclaimed, or already theirs: the ordinary claim, unchanged.
  if v_holder is null or v_holder = p_user_id then
    v_result := public.complete_participant_claim(
      p_user_id, p_participant_id, p_tenant_id, p_event_id, true
    );
    return v_result || jsonb_build_object('outcome', 'claimed');
  end if;

  -- Someone else holds it: a conflict. A person already linked to another
  -- record in this event could never be switched onto this one
  -- (participants_event_id_user_id_key), so they get the same refusal as a
  -- claim would give them (L13).
  if exists (
    select 1 from participants
    where event_id = p_event_id and user_id = p_user_id
  ) then
    raise exception 'already_in_event' using errcode = 'P0001';
  end if;

  select phone into v_user_phone from auth.users where id = p_user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Trying again keeps the first attempt's time: that is when they asked.
  insert into participant_claim_conflicts
    (tenant_id, event_id, participant_id, user_id, phone)
  values
    (p_tenant_id, p_event_id, p_participant_id, p_user_id,
     nullif(ltrim(v_user_phone, '+'), ''))
  on conflict (participant_id, user_id) do nothing;

  return jsonb_build_object(
    'participant_id', p_participant_id,
    'event_id', p_event_id,
    'role_granted', false,
    'outcome', 'conflict'
  );
end;
$$;

comment on function public.submit_participant_claim(uuid, uuid, uuid, uuid, boolean) is
  'N42: CLAIM-02''s Complete. Claims an unclaimed record (complete_participant_claim) '
  'or, when another user holds it, stores a participant_claim_conflicts row. '
  'Raises not_found / privacy_not_accepted / already_in_event (P0001). Returns '
  '{ participant_id, event_id, role_granted, outcome: claimed|conflict }. '
  'Service role only.';

-- ----------------------------------------------------------------------------
-- 3. Settle conflicts when a record changes hands
-- ----------------------------------------------------------------------------

create or replace function public.participants_clear_claim_conflicts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from participant_claim_conflicts where participant_id = new.id;

  if new.user_id is not null then
    delete from participant_claim_conflicts
    where event_id = new.event_id and user_id = new.user_id;
  end if;

  return null;
end;
$$;

drop trigger if exists participants_clear_claim_conflicts on public.participants;
create trigger participants_clear_claim_conflicts
  after update of user_id on public.participants
  for each row
  when (old.user_id is distinct from new.user_id)
  execute function public.participants_clear_claim_conflicts();

-- ----------------------------------------------------------------------------
-- 4. switch_participant_claimant
-- ----------------------------------------------------------------------------

create or replace function public.switch_participant_claimant(
  p_tenant_id   uuid,
  p_event_id    uuid,
  p_conflict_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conflict   participant_claim_conflicts%rowtype;
  v_old_avatar text;
begin
  select * into v_conflict
  from participant_claim_conflicts
  where id = p_conflict_id
    and tenant_id = p_tenant_id
    and event_id = p_event_id;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- The lock is on the PARTICIPANT row, not the conflict row: FOR UPDATE on
  -- the conflict would need UPDATE on that table, which authenticated
  -- deliberately does not have. Every change of the record goes through
  -- this row, so two decisions on the same record queue here; whoever comes
  -- second re-checks below and finds their conflict already settled.
  select avatar_url into v_old_avatar
  from participants
  where id = v_conflict.participant_id
    and tenant_id = p_tenant_id
    and event_id = p_event_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  perform 1 from participant_claim_conflicts where id = p_conflict_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Linked to another record in this event since they asked (the trigger
  -- normally removes the conflict then; this covers the race).
  if exists (
    select 1 from participants
    where event_id = p_event_id
      and user_id = v_conflict.user_id
      and id <> v_conflict.participant_id
  ) then
    raise exception 'already_in_event' using errcode = 'P0001';
  end if;

  update participants
  set user_id = v_conflict.user_id,
      phone = coalesce(v_conflict.phone, phone),
      privacy_accepted_at = v_conflict.created_at,
      avatar_url = null
  where id = v_conflict.participant_id;

  return jsonb_build_object(
    'participant_id', v_conflict.participant_id,
    'previous_avatar_url', v_old_avatar
  );
end;
$$;

comment on function public.switch_participant_claimant(uuid, uuid, uuid) is
  'N42: Switch to new on PART-01. Moves the record to the conflict''s claimant '
  '(phone, consent time), clears the old photo; the trigger clears the record''s '
  'other conflicts. SECURITY INVOKER: RLS is the admin check. Raises not_found / '
  'already_in_event (P0001). Returns { participant_id, previous_avatar_url }.';

-- ----------------------------------------------------------------------------
-- 5. Grants. New functions in public get EXECUTE for anon and authenticated
--    from the schema's default ACL; revoking from PUBLIC alone does not
--    remove those.
-- ----------------------------------------------------------------------------

revoke all on function public.submit_participant_claim(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_participant_claim(uuid, uuid, uuid, uuid, boolean)
  to service_role;

revoke all on function public.participants_clear_claim_conflicts()
  from public, anon, authenticated;

revoke all on function public.switch_participant_claimant(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.switch_participant_claimant(uuid, uuid, uuid)
  to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select relrowsecurity from pg_class where relname = 'participant_claim_conflicts';
--   -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'participant_claim_conflicts' order by 1, 2;
--   -- authenticated: DELETE, SELECT; service_role: all four; no anon
--   select proname, proacl from pg_proc
--   where proname in ('submit_participant_claim', 'switch_participant_claimant');
--   select tgname from pg_trigger where tgname = 'participants_clear_claim_conflicts';
-- ============================================================================
