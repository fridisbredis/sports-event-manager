-- ============================================================================
-- Migration 20261110130000: complete a participant claim — consent and photo
-- (N40, Participant 6/10, CLAIM-02, L6/L7/L8/L13)
-- ============================================================================
--
-- CLAIM-02 ends with one Complete button that does three things the runner
-- has to see as one: the participant record becomes theirs (L6, first claim
-- wins), they have confirmed it is them (L7), and they have accepted the
-- privacy policy. A claim without recorded consent is personal data held on
-- no lawful basis, so the link and the consent timestamp are written in ONE
-- transaction here (REL-01, docs/patterns/atomic-multi-table-writes.md),
-- never as two calls from the route.
--
-- 1. participants.avatar_url — the optional photo (L8). Per participant row,
--    the same shape as officials.avatar_url (20260929094440): a public URL in
--    the 'avatars' bucket, path {tenantId}/participants/{participantId}/....
--    The Race Results import (import_participants) never names this column
--    in its ON CONFLICT update, so a re-import keeps the photo, exactly as it
--    keeps user_id and phone.
--
-- 2. complete_participant_claim — wraps claim_participant (20261106120000)
--    and adds what the claim route needs checked in the same transaction:
--      - the participant belongs to p_event_id (the event the claim token
--        resolved to). claim_participant only checks the tenant; without
--        this, a valid token for event A plus a participant id from event B
--        in the same tenant would claim into B.
--      - the row is not withdrawn or hidden — CLAIM-01 does not offer those,
--        so a direct POST must not be able to claim them either.
--      - p_privacy_accepted is true, and privacy_accepted_at is set on the
--        claimed row. The first acceptance is kept on an idempotent re-run.
--    Whether the event is OPEN (published, Premium+) is decided in the app
--    with isParticipantSideOpen, the one shared check from N36 — the same
--    split CLAIM-01 uses. Duplicating the tier rule in SQL would give it two
--    places to drift.
--
--    Raises, each its own P0001 message: not_found, privacy_not_accepted,
--    and claim_participant's already_claimed / already_in_event (L13).
--    Returns claim_participant's { participant_id, event_id, role_granted }
--    unchanged — the route reads all three keys.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.complete_participant_claim(uuid, uuid, uuid, uuid, boolean);
--             alter table public.participants drop column if exists avatar_url;
--             (drop the column only after removing the app code that
--             selects it; objects under avatars/{tenant}/participants/ stay
--             in the bucket and can be removed by path prefix.)
--   Data:     no data loss
--   Blast:    if the function raised for every call, no runner could
--             complete a claim — CLAIM-02 would show its generic error.
--             Nothing deployed before N40 calls it.
--   Window:   compatible. A new nullable column and a new function; no
--             deployed code reads or calls either.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Photo
-- ----------------------------------------------------------------------------

alter table public.participants
  add column if not exists avatar_url text;

comment on column public.participants.avatar_url is
  'N40 (L8): optional photo from CLAIM-02, public URL in the avatars bucket '
  'under {tenantId}/participants/{participantId}/. Never touched by the Race '
  'Results import.';

-- ----------------------------------------------------------------------------
-- 2. complete_participant_claim
-- ----------------------------------------------------------------------------

create or replace function public.complete_participant_claim(
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
  v_result jsonb;
begin
  if p_privacy_accepted is distinct from true then
    raise exception 'privacy_not_accepted' using errcode = 'P0001';
  end if;

  -- Same not_found for every way the row can be out of reach, so the route
  -- cannot be used to tell "another event" from "withdrawn" from "no such
  -- id". claim_participant takes the row lock itself.
  if not exists (
    select 1 from participants
    where id = p_participant_id
      and tenant_id = p_tenant_id
      and event_id = p_event_id
      and withdrawn_at is null
      and hidden_at is null
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  v_result := public.claim_participant(p_user_id, p_participant_id, p_tenant_id);

  update participants
  set privacy_accepted_at = coalesce(privacy_accepted_at, now())
  where id = p_participant_id
    and user_id = p_user_id;

  return v_result;
end;
$$;

comment on function public.complete_participant_claim(uuid, uuid, uuid, uuid, boolean) is
  'N40: claim_participant plus the CLAIM-02 checks in one transaction — the row '
  'is in p_event_id and not withdrawn/hidden, privacy was accepted, and '
  'privacy_accepted_at is set. Raises not_found / privacy_not_accepted / '
  'already_claimed / already_in_event (P0001). Returns { participant_id, '
  'event_id, role_granted }. Service role only.';

-- ----------------------------------------------------------------------------
-- 3. Grants. New functions in public get EXECUTE for anon and authenticated
--    from the schema's default ACL; revoking from PUBLIC alone does not
--    remove those.
-- ----------------------------------------------------------------------------

revoke all on function public.complete_participant_claim(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_participant_claim(uuid, uuid, uuid, uuid, boolean)
  to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'participants' and column_name = 'avatar_url';
--   select proname, proacl from pg_proc where proname = 'complete_participant_claim';
--   -- no anon, no authenticated
-- ============================================================================
