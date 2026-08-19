-- ============================================================================
-- Migration 0022: get_user_id_by_phone RPC
-- ============================================================================
--
-- Supporting function for the officials invite flow moving account creation
-- to invite time (POST /api/officials) instead of OTP-verify time, so that
-- Supabase Auth's "Allow new users to sign up" can stay disabled — see
-- docs/quality-requirements.md and the AUTH-01 fix for the open self-registration
-- gap (any phone number could previously get an auth.users row + SMS just by
-- calling signInWithOtp, since shouldCreateUser defaults to true).
--
-- When an admin invites a phone number that already has an auth.users row
-- (e.g. already an official at another tenant, or a tenant admin), the route
-- must reuse that account rather than fail the invite. supabase-js's admin
-- API has no getUserByPhone/getUserByEmail method (listUsers is unfiltered
-- and paginated, impractical here) so the lookup goes through this
-- SECURITY DEFINER function, the same pattern as confirm_official_invite
-- (0017) for reading data PostgREST itself has no access to.
-- ============================================================================

create or replace function public.get_user_id_by_phone(p_phone text)
returns uuid
language sql
security definer
set search_path = auth
as $$
  select id from auth.users where phone = p_phone limit 1;
$$;

comment on function public.get_user_id_by_phone is
  'Resolves an auth.users.id from a phone number. Used by POST /api/officials '
  'to reuse an existing account when inviting a phone number that already '
  'has one, since supabase-js admin has no getUserByPhone method.';

-- Only the invite-creation route (via the service-role client) should ever
-- call this function directly — it bypasses RLS by design (SECURITY DEFINER)
-- and reads the auth schema, which PostgREST cannot access otherwise.
revoke all on function public.get_user_id_by_phone(text) from public;
grant execute on function public.get_user_id_by_phone(text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'get_user_id_by_phone';
