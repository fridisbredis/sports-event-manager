-- ============================================================================
-- Migration 0028: mandatory privacy consent on invite confirmation
-- ============================================================================
--
-- SEC-09/F-SEC-10. PO requires that accepting an official invite also
-- requires accepting the privacy policy ("opt in" checkbox), mandatory to
-- proceed. This adds a privacy_accepted_at timestamp to officials and
-- participants (participants have no invite flow yet, but the same
-- retention/consent policy will apply once one exists — see the GDPR
-- cleanup migration that follows this one) and requires it to be set in
-- confirm_official_invite.
--
-- privacy_accepted_at (rather than a boolean) doubles as the audit trail of
-- *when* consent was given, which matters for a GDPR consent record.
-- ============================================================================

alter table public.officials
  add column if not exists privacy_accepted_at timestamptz;

alter table public.participants
  add column if not exists privacy_accepted_at timestamptz;

-- Replace confirm_official_invite to require and record consent.
-- Signature changes (new p_privacy_accepted param) so the old 4-arg version
-- is dropped explicitly rather than left as dead overload.
drop function if exists public.confirm_official_invite(uuid, uuid, text, text);

create or replace function public.confirm_official_invite(
  p_token             uuid,
  p_user_id           uuid,
  p_user_phone        text,
  p_name              text,
  p_privacy_accepted  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_official officials%rowtype;
  v_updated  integer;
begin
  if not p_privacy_accepted then
    raise exception 'privacy_not_accepted' using errcode = 'P0001';
  end if;

  select * into v_official
  from officials
  where invite_token = p_token
  for update;

  if v_official.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_official.invite_status <> 'invited' then
    raise exception 'already_confirmed' using errcode = 'P0001';
  end if;

  if v_official.invite_token_expires_at is null
     or v_official.invite_token_expires_at <= now() then
    raise exception 'expired' using errcode = 'P0001';
  end if;

  if v_official.phone is distinct from p_user_phone then
    raise exception 'phone_mismatch' using errcode = 'P0001';
  end if;

  update officials
  set
    user_id = p_user_id,
    invite_status = 'confirmed',
    invite_token = null,
    invite_token_expires_at = null,
    name = p_name,
    privacy_accepted_at = now()
  where id = v_official.id
    and invite_status = 'invited';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'already_confirmed' using errcode = 'P0001';
  end if;

  insert into user_roles (user_id, tenant_id, role)
  values (p_user_id, v_official.tenant_id, 'official')
  on conflict (user_id, tenant_id) do nothing;

  return jsonb_build_object('tenant_id', v_official.tenant_id);
end;
$$;

comment on function public.confirm_official_invite is
  'SEC-04/SEC-09: atomically confirms an official invite. Requires '
  'p_user_phone to match officials.phone and p_privacy_accepted = true. '
  'Locks the official row (SELECT ... FOR UPDATE) and re-checks '
  'invite_status in the UPDATE WHERE clause so concurrent callers cannot '
  'both succeed. Raises not_found / already_confirmed / expired / '
  'phone_mismatch / privacy_not_accepted (errcode P0001) on failure.';

revoke all on function public.confirm_official_invite(uuid, uuid, text, text, boolean) from public;
grant execute on function public.confirm_official_invite(uuid, uuid, text, text, boolean) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select column_name from information_schema.columns
--   where table_name in ('officials', 'participants') and column_name = 'privacy_accepted_at';
--   select proname, pronargs from pg_proc where proname = 'confirm_official_invite';
