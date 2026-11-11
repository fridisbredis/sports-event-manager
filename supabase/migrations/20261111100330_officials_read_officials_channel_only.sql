-- ============================================================================
-- Migration 20261111100330: officials read only the officials channel
-- (N44, Participant 10/10, participant announcements)
-- ============================================================================
--
-- N44: "Officials never see the participant channel and vice versa."
--
-- The participant half already holds: event_participant_read_announcements
-- (20261110133030) is limited to channel = 'participants'. The official half
-- did not. event_member_read_announcements (20261029090324) is
-- can_read_event(tenant_id, event_id) with no channel term, so an official's
-- session could read the event's participant announcements straight through
-- PostgREST. The official screens filter to channel = 'officials', which
-- hid it in the UI and nowhere else.
--
-- The policy gains `channel = 'officials'`. Who is unaffected:
--   - tenant admins and system admins read both channels through
--     tenant_admin_manage_announcements (FOR ALL, 0004), which this does not
--     touch. can_read_event also lets them through here, but they no longer
--     need this policy for the participant channel.
--   - a user who is an official in one event and a participant in another (or
--     the same) event reads the participant channel through
--     event_participant_read_announcements, for events they are entered in.
--   - the SMS worker and the push sender run as service_role (no RLS).
--
-- Forward-fix: replace (RLS policy event_member_read_announcements)
--   Rollback: restore event_member_read_announcements from migration
--             20261029090324_event_member_read_policies.sql.
--   Data:     no data loss. A SELECT policy; no rows are written.
--   Blast:    too narrow, and an official's Announcements page and home
--             preview come back empty. Both read channel = 'officials' only,
--             which is exactly what the policy still allows.
--   Window:   compatible. The deployed official screens already read only
--             the officials channel; nothing deployed reads the participant
--             channel with an official's session.
-- ============================================================================

drop policy if exists event_member_read_announcements on public.announcements;
create policy event_member_read_announcements on public.announcements
  for select to authenticated
  using (channel = 'officials' and public.can_read_event(tenant_id, event_id));
