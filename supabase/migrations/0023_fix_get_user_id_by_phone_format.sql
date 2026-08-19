-- ============================================================================
-- Migration 0023: fix get_user_id_by_phone phone format mismatch
-- ============================================================================
--
-- 0022's get_user_id_by_phone compared p_phone directly against auth.users.phone.
-- The app passes E.164 phone numbers with a leading '+' (see src/lib/phone.ts),
-- but Supabase Auth stores auth.users.phone WITHOUT the leading '+'. The lookup
-- therefore never matched, and the phone_exists fallback in POST /api/officials
-- would always fail. Strip a leading '+' from p_phone before comparing.
-- ============================================================================

create or replace function public.get_user_id_by_phone(p_phone text)
returns uuid
language sql
security definer
set search_path = auth
as $$
  select id from auth.users where phone = ltrim(p_phone, '+') limit 1;
$$;

comment on function public.get_user_id_by_phone is
  'Resolves an auth.users.id from a phone number. Strips a leading "+" before '
  'comparing, since auth.users.phone is stored without it while callers pass '
  'E.164 (+countrycode...). Used by POST /api/officials to reuse an existing '
  'account when inviting a phone number that already has one.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select public.get_user_id_by_phone('+46700000001');
