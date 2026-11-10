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
--   Data:     no data loss
--   Blast:    SELECT policies are OR'ed with the existing ones, so admins and
--             officials read exactly what they read before. Too narrow, and a
--             PAR-01 card or the announcement preview comes back empty.
--   Window:   compatible. New policies only; no deployed code depends on them.
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
