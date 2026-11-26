-- ============================================================================
-- Migration 20261126144947: a participant leaves an event themselves (N74)
-- ============================================================================
--
-- Until now only a tenant admin could take a participant record away from the
-- person who claimed it ('Unlink' on PART-01, N41: unlinkParticipant). N74
-- lets the participant do the same to their OWN record, per event, from the
-- participant Account page.
--
-- 1. leave_own_participant_entry(p_participant_id) — clears the same four
--    columns unlinkParticipant clears (user_id, phone, privacy_accepted_at,
--    avatar_url) on one record, and only when that record is the caller's.
--    The participants_sync_participant_role trigger then drops the
--    'participant' role if this was the caller's last record in the tenant,
--    exactly as after an admin unlink. The record stays and can be claimed
--    again (N74 decision, 2026-11-26). The account is not touched.
--
--    A function, not an UPDATE policy, for the reason set_own_participant_
--    sms_opt_out (20261110133030) gives: a policy cannot limit which columns
--    change, and the rest of the row belongs to the import and the admin.
--
--    Scoped by auth.uid(), so it is called with the caller's own session,
--    never the service client (auth.uid() is NULL under service_role and the
--    update would match nothing). The server action also checks that the
--    record is one of the caller's entries before calling it — defense in
--    depth; this WHERE clause is the real gate.
--
--    Returns jsonb:
--      { "left": false }                                     not the caller's
--      { "left": true, "tenant_id", "event_id", "avatar_url" }   done
--    avatar_url is the value BEFORE the clear, so the server action can
--    delete the photo file from storage (storage is not reachable from here).
--
-- 2. AUDIT. The leave is written to audit_events in the same transaction, so
--    a record cleared by its holder can be told apart from one an admin
--    unlinked. audit_events' CHECKs admitted only admins as actors; they are
--    widened with actor_role 'participant', action 'participant_left_event'
--    and target_type 'participant'. The row is inserted by this SECURITY
--    DEFINER function (as the table owner, so RLS does not apply); the
--    INSERT policy is unchanged, so a participant still cannot write audit
--    rows directly. detail carries the event id only — no name or phone.
--
-- Forward-fix: replace (widens three audit_events CHECKs; the function is
-- additive)
--   Rollback: drop function if exists public.leave_own_participant_entry(uuid);
--             The CHECKs can only be narrowed back while no row uses a new
--             value:
--               select count(*) from public.audit_events
--               where action = 'participant_left_event';
--             If zero, re-run the action CHECK block from 20261027143113 and
--             the actor_role/target_type CHECKs from 0037. If non-zero,
--             leave the wider CHECKs in place rather than deleting audit rows
--             to make a rollback possible.
--   Data:     prod snapshot 20261126144947_pre-migration_2026-11-26T15-04-06Z.tar.gz
--             (Azure Blob sportsevtmgrprodsnaps, container db-snapshots),
--             taken by hand before the push; restore with
--             scripts/ops/restore-prod-db.sh <that filename>.
--             On apply, no row is written. At call time the function clears
--             four columns on one participants row (the same clear an admin
--             unlink does); a bad body could clear someone else's record.
--             phone and privacy_accepted_at are recoverable only from the
--             snapshot or PITR.
--   Blast:    none until the N74 Account action calls the function.
--   Window:   compatible. Deployed code never calls the new function nor
--             writes the new audit values; widening a CHECK cannot reject an
--             existing write.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. audit_events: admit a participant as actor
-- ----------------------------------------------------------------------------

alter table public.audit_events
  drop constraint if exists audit_events_actor_role_check;

alter table public.audit_events
  add constraint audit_events_actor_role_check check (
    actor_role = any (array[
      'system_admin'::text,
      'tenant_admin'::text,
      -- N74
      'participant'::text
    ])
  );

alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  add constraint audit_events_action_check check (
    action = any (array[
      'role_revoked'::text,
      'tenant_created'::text,
      'tenant_activated'::text,
      'tenant_deactivated'::text,
      'tenant_tier_changed'::text,
      'official_invited'::text,
      'announcement_published'::text,
      -- N20
      'tenant_admin_granted'::text,
      'tenant_admin_revoked'::text,
      -- N28
      'system_admin_granted'::text,
      'system_admin_revoked'::text,
      -- N13
      'tenant_sms_sender_changed'::text,
      -- N74
      'participant_left_event'::text
    ])
  );

alter table public.audit_events
  drop constraint if exists audit_events_target_type_check;

alter table public.audit_events
  add constraint audit_events_target_type_check check (
    target_type = any (array[
      'user_role'::text,
      'tenant'::text,
      'official'::text,
      'announcement'::text,
      -- N74
      'participant'::text
    ])
  );

-- ----------------------------------------------------------------------------
-- 2. leave_own_participant_entry
-- ----------------------------------------------------------------------------

create or replace function public.leave_own_participant_entry(
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_tenant_id  uuid;
  v_event_id   uuid;
  v_avatar_url text;
begin
  if v_uid is null then
    raise exception 'leave_own_participant_entry requires a signed-in caller'
      using errcode = '42501';
  end if;

  if p_participant_id is null then
    raise exception 'leave_own_participant_entry requires p_participant_id'
      using errcode = '22023';
  end if;

  -- Locked so the avatar_url read here is the one the update clears: a
  -- concurrent photo upload cannot slip in between and leave its file behind.
  select tenant_id, event_id, avatar_url
    into v_tenant_id, v_event_id, v_avatar_url
    from participants
   where id = p_participant_id
     and user_id = v_uid
     for update;

  -- Someone else's record, an unclaimed one, or one already left in another
  -- tab. One answer for all three, so the function says nothing about
  -- records that are not the caller's.
  if not found then
    return jsonb_build_object('left', false);
  end if;

  -- The same four columns unlinkParticipant clears (participants/actions.ts).
  -- Keep the two lists identical: a column added to one belongs in the other.
  update participants
     set user_id = null,
         phone = null,
         privacy_accepted_at = null,
         avatar_url = null
   where id = p_participant_id;

  insert into audit_events (
    tenant_id, actor_user_id, actor_role, action, target_type, target_id, detail
  ) values (
    v_tenant_id, v_uid, 'participant', 'participant_left_event', 'participant',
    p_participant_id, jsonb_build_object('event_id', v_event_id)
  );

  return jsonb_build_object(
    'left', true,
    'tenant_id', v_tenant_id,
    'event_id', v_event_id,
    'avatar_url', v_avatar_url
  );
end;
$$;

comment on function public.leave_own_participant_entry(uuid) is
  'N74: the caller leaves one event they are entered in. Clears user_id, '
  'phone, privacy_accepted_at and avatar_url on their own participants row '
  '(as an admin unlink does), writes participant_left_event to audit_events, '
  'and returns the previous avatar_url for storage cleanup.';

-- New functions in public get EXECUTE for anon and authenticated from the
-- schema's default ACL; revoking from PUBLIC alone does not remove those.
revoke all on function public.leave_own_participant_entry(uuid)
  from public, anon, authenticated;
grant execute on function public.leave_own_participant_entry(uuid)
  to authenticated;

-- ============================================================================
-- Verify with:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname in ('audit_events_actor_role_check',
--                     'audit_events_action_check',
--                     'audit_events_target_type_check');
--   select proacl from pg_proc where proname = 'leave_own_participant_entry';
-- ============================================================================
