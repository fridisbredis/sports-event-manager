-- ============================================================================
-- Migration 20261110133030: what a signed-in participant reads directly
-- (N43, Participant 9/10, PAR-01 participant home)
-- ============================================================================
--
-- N35 (20261106120000) let a participant read the events row of an event
-- they are entered in and left the rest to N43. Two direct reads are added
-- here, both SELECT only — participants edit nothing about the event:
--
-- 1. participant_stages — the caller's own stage entries (PAR-01: one card
--    per Race stage). participants already has participant_read_own.
--
-- 2. announcements — channel = 'participants' only, in an event the caller
--    is entered in (PAR-01's latest-announcement preview; N44 builds the
--    timeline on the same policy). can_read_event stays official-only, so the
--    officials channel stays unreadable to a participant.
--
-- 3. set_own_participant_sms_opt_out — ACCT-01's SMS switch. The one column a
--    participant may change on their own record, so a function rather than
--    an UPDATE policy: a policy cannot limit which columns change, and the
--    rest of the row (name, bib, claim state) belongs to the import and the
--    admin. Applies to every record the caller has in the tenant, the way
--    the official switch is one setting per tenant.
--
-- Deliberately NOT event_stages or event_info_sections. INFO-01 reads those
-- through get_event_info_cached, with the app deciding access — that was
-- N38's decision for participants too (tests/integration/
-- event-info-sections-rls.test.ts: "deliberately no participant read
-- policy"). The participant screens use the same RPC and filter to Race
-- stages in the app, rather than opening a second read path.
--
-- Whether the event is open (published, Premium+) is not checked here. It is
-- decided in the app with isParticipantSideOpen (N36), the same split N39 and
-- N40 use.
--
-- TO authenticated: the cached RPCs run as cache_rpc_reader, which has no
-- EXECUTE on is_event_participant. A policy without a role list is evaluated
-- for that role too and fails the RPC with 42501.
--
-- No is_system_admin() OR clause: these are self-read policies like
-- participant_read_own, and admins already read every row through the
-- existing tenant_admin_manage_<table> policies.
--
-- Forward-fix: additive
--   Rollback: drop policy if exists participant_read_own_participant_stages on public.participant_stages;
--             drop policy if exists event_participant_read_announcements on public.announcements;
--             drop function if exists public.set_own_participant_sms_opt_out(uuid, boolean);
--   Data:     no data loss
--   Blast:    SELECT policies are OR'ed with the existing ones, so admins and
--             officials read exactly what they read before. Too narrow, and a
--             PAR-01 card or the announcement preview comes back empty. If
--             the function raised, ACCT-01's SMS switch would show its save
--             error and leave sms_opt_out as it was.
--   Window:   compatible. New policies and a new function; no deployed code
--             depends on them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. participant_stages
-- ----------------------------------------------------------------------------

drop policy if exists participant_read_own_participant_stages on public.participant_stages;
create policy participant_read_own_participant_stages
  on public.participant_stages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.participants p
      where p.id = participant_stages.participant_id
        and p.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2. announcements (participant channel only)
-- ----------------------------------------------------------------------------

drop policy if exists event_participant_read_announcements on public.announcements;
create policy event_participant_read_announcements
  on public.announcements
  for select
  to authenticated
  using (channel = 'participants' and public.is_event_participant(event_id));

-- ----------------------------------------------------------------------------
-- 3. set_own_participant_sms_opt_out
-- ----------------------------------------------------------------------------
-- Scoped by auth.uid(), so it is called with the caller's own session, never
-- the service client (auth.uid() is NULL under service_role and the update
-- would match nothing). Returns how many records changed; 0 means the caller
-- has no record in the tenant.

create or replace function public.set_own_participant_sms_opt_out(
  p_tenant_id uuid,
  p_opt_out   boolean
)
returns integer
language sql
security definer
set search_path = public
as $$
  with changed as (
    update public.participants
       set sms_opt_out = p_opt_out
     where tenant_id = p_tenant_id
       and user_id = auth.uid()
    returning 1
  )
  select count(*)::integer from changed;
$$;

comment on function public.set_own_participant_sms_opt_out(uuid, boolean) is
  'N43: the caller''s SMS opt-out on every participant record they hold in the '
  'tenant. The only participant column a participant writes.';

-- New functions in public get EXECUTE for anon and authenticated from the
-- schema's default ACL; revoking from PUBLIC alone does not remove those.
revoke all on function public.set_own_participant_sms_opt_out(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_own_participant_sms_opt_out(uuid, boolean)
  to authenticated;
