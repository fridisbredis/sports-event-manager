-- ============================================================================
-- Migration: per-tenant alphanumeric SMS sender ID (N13)
-- ============================================================================
--
-- Professional tenants send SMS from their own alphanumeric sender name
-- ("Viadal") instead of the platform number. Decided 2026-10-27 on the task
-- board: Sweden supports dynamic alphanumeric sender IDs with no registration,
-- so a name costs nothing and needs no purchase, unlike a dedicated number.
--
-- THE COLUMN is nullable and null means "use the platform number". It is NOT
-- tier-gated here: the stored value survives a downgrade and comes back on
-- upgrade, and the send sites decide per message whether the tenant's tier
-- unlocks it (resolveSmsSender in src/lib/sms/sender.ts) — the same
-- gate-on-read approach as the colour theme.
--
-- THE CHECK is Twilio's rule for an alphanumeric sender: at most 11
-- characters, ASCII letters, digits and space, at least one letter. Edge
-- spaces are rejected too, since Twilio would either strip or refuse them.
-- The app validates the same rule (smsSenderIdSchema); this is the backstop.
--
-- THE TRIGGER exists because RLS cannot protect one column.
-- tenant_admin_update_own_tenant (20260928165612) gives a tenant admin UPDATE
-- on every column of their own tenant row, so without this a tenant admin
-- could set their own sender name straight through PostgREST. Only a system
-- admin may change it from a user session. Roles other than anon and
-- authenticated (service_role, the migration role) pass: auth.uid() is NULL
-- under service_role, so is_system_admin() alone would wrongly block them.
--
-- AUDIT: widens audit_events_action_check with tenant_sms_sender_changed,
-- written by setTenantSmsSenderId in the system-admin actions.
--
-- Forward-fix: replace (widens audit_events_action_check; column, CHECK and
-- trigger are additive)
--   Rollback: drop trigger if exists tenants_guard_sms_sender_id on public.tenants;
--             drop function if exists public.guard_tenant_sms_sender_id();
--             alter table public.tenants drop column if exists sms_sender_id;
--             The audit CHECK can only be narrowed back while no row uses the
--             new value:
--               select count(*) from public.audit_events
--               where action = 'tenant_sms_sender_changed';
--             If zero, re-run the constraint block from 20261026134923. If
--             non-zero, leave the wider constraint in place rather than
--             deleting audit rows to make a rollback possible.
--   Data:     prod snapshot 20261027143113_pre-migration_2026-10-28T09-03-54Z.tar.gz
--             (Azure Blob sportsevtmgrprodsnaps, container db-snapshots);
--             restore with scripts/ops/restore-prod-db.sh <that filename>.
--             Taken AFTER the migration, despite the script's
--             "pre-migration" naming: deploy-prod.yml applied it on
--             2026-10-28 before the snapshot was taken (its REL-04 guard
--             only blocks `destructive`). No pre-migration data was lost by
--             that: this migration writes no rows, so the snapshot's data
--             equals prod's data before it — verified after apply, 3
--             tenants, 0 with a sender, 8 audit rows. Dropping the column on
--             rollback loses only the sender names entered since, which a
--             system admin can re-enter.
--   Blast:    none on apply. If the trigger condition were wrong, the worst
--             case is a system admin unable to save a sender name (the SMS
--             still goes out from the platform number), or a tenant admin
--             able to set one through the raw API.
--   Window:   compatible. Deployed code never selects the new column nor
--             emits the new audit value; widening a CHECK cannot reject an
--             existing write, and the trigger fires only when sms_sender_id
--             changes, which deployed code never does.
-- ============================================================================

alter table public.tenants
  add column if not exists sms_sender_id text;

alter table public.tenants
  drop constraint if exists tenants_sms_sender_id_format;

alter table public.tenants
  add constraint tenants_sms_sender_id_format check (
    sms_sender_id is null
    or (
      sms_sender_id ~ '^[A-Za-z0-9 ]{1,11}$'
      and sms_sender_id ~ '[A-Za-z]'
      and sms_sender_id = btrim(sms_sender_id)
    )
  );

comment on column public.tenants.sms_sender_id is
  'N13: alphanumeric SMS sender name. Used only when the tenant''s tier '
  'unlocks smsSenderId (src/lib/tiers/features.ts); null or a lower tier '
  'sends from the platform number. Writable by system admins only — see '
  'guard_tenant_sms_sender_id.';

create or replace function public.guard_tenant_sms_sender_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sms_sender_id is distinct from old.sms_sender_id
     and current_user in ('anon', 'authenticated')
     and not public.is_system_admin() then
    raise exception 'only a system admin can change a tenant''s SMS sender'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tenants_guard_sms_sender_id on public.tenants;

create trigger tenants_guard_sms_sender_id
  before update of sms_sender_id on public.tenants
  for each row
  execute function public.guard_tenant_sms_sender_id();

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
      'tenant_sms_sender_changed'::text
    ])
  );

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'tenants'
--     and column_name = 'sms_sender_id';
--   select tgname from pg_trigger where tgname = 'tenants_guard_sms_sender_id';
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname in ('tenants_sms_sender_id_format', 'audit_events_action_check');
