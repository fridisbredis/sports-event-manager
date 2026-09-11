-- ============================================================================
-- Migration 20260911130436: ensure_admin_roster_row RPC
-- ============================================================================
--
-- F-MNT-20: Peter's decision of 2026-06-24
-- (docs/flows/officials-management-registration.md:18, repeated in
-- docs/flows/officials-scheduling.md:22 and codified in .claude/CLAUDE.md)
-- says a tenant admin is always schedulable and appears on the roster
-- automatically, implicitly Confirmed, with no SMS invite. The app never
-- implemented it: a tenant_admin has a user_roles row but no officials
-- row, so OFF-01 omits them, /{slug}/account 404s
-- (src/app/(official)/[tenantSlug]/account/page.tsx:40) and SCHED-01's
-- confirmed-only pool excludes them
-- (src/app/(tenant)/[tenantSlug]/admin/scheduling/page.tsx:85-87).
--
-- Why an RPC and not a write inside create_tenant_with_defaults, which is
-- where the F-MNT-20 ticket first pointed: that RPC is called by a
-- *system_admin* creating a tenant, and it grants no tenant_admin role to
-- anyone. There is no admin in scope at tenant-creation time to write a
-- roster row for. In fact no application code path grants tenant_admin at
-- all today — the role is set only by scripts/seed-dev.ts:333-336 and by
-- hand in the database. So the roster row is anchored to the moment an
-- admin *gets their role* rather than to tenant creation, and this RPC is
-- the reusable unit for that moment. It is deliberately callable on its own
-- so the existing admins can be backfilled now; the future SYS-02
-- "designate a tenant admin" flow calls the same function.
--
-- Idempotent, and reuse-first by design. officials has NO unique constraint
-- on (tenant_id, user_id) — only a partial unique index on (tenant_id,
-- phone) where invite_status <> 'removed' (migration 0020). So `on conflict
-- (tenant_id, user_id)` is not available, and a naive insert would both
-- create duplicates on re-run and collide with that phone index. Two of the
-- three tenant admins in prod (Peter Thörn, Lotta Thörn) already hold
-- confirmed officials rows created through the normal invite flow on
-- 2026-07-07 — they worked around this bug by hand. Those rows are left
-- exactly as they are: this function claims an existing non-removed row for
-- the admin rather than writing a second one, and only inserts when the
-- admin has no roster row at all.
--
-- The "<name> — Event admin" label and the suppressed action buttons the
-- spec asks for are derived in the UI from user_roles, not stored here. No
-- column marks a row as the admin's, so an admin who later loses the role
-- simply stops being labelled, and Peter's existing row does not change
-- shape retroactively.
--
-- SECURITY DEFINER, unlike create_tenant_with_defaults's INVOKER: this
-- reads auth.users (for the admin's verified phone and name), which is not
-- reachable by the authenticated role under RLS. The function is therefore
-- its own gate, and the guards below carry that weight:
--   - it writes a row only for a user who genuinely holds tenant_admin on
--     the tenant passed in, verified against user_roles inside the body, so
--     a caller cannot conjure a roster row for an arbitrary user;
--   - it is revoked from public/anon/authenticated and granted only to
--     service_role, so it is server-only (ADR-0002, migration 0035).
--
-- Phone shape: stored numbers omit the leading '+' (see
-- src/lib/phone.ts:20-35 and the SEC-04 normalization of 2026-08-28; all 25
-- prod officials and all 25 auth.users rows verified '+'-free on
-- 2026-09-11). ltrim is applied anyway so a legacy '+'-prefixed auth.users
-- row cannot write a second, differently-shaped roster row past the phone
-- index.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.ensure_admin_roster_row(uuid, uuid);
--             Any roster row it inserted is an ordinary officials row and
--             can be removed with
--               delete from officials where tenant_id = $1 and user_id = $2;
--             — but check invite_status/created_at first, since this
--             function also *claims* pre-existing invite-flow rows it must
--             not delete (Peter's and Lotta's).
--   Data:     no data loss — creates a function and, when called, inserts
--             officials rows. It never updates or deletes an existing row.
--   Blast:    none until something calls it. The three read paths above
--             keep their current behaviour unmodified; nothing in the app
--             calls this function as of this migration.
--   Window:   compatible — additive, no schema the deployed code depends on
--             changes.
-- ============================================================================

create or replace function public.ensure_admin_roster_row(
  p_tenant_id uuid,
  p_user_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_official_id uuid;
  v_created     boolean := false;
  v_phone       text;
  v_name        text;
begin
  if p_tenant_id is null or p_user_id is null then
    raise exception 'ensure_admin_roster_row requires both p_tenant_id and p_user_id'
      using errcode = '22023';
  end if;

  -- The security boundary: only a real tenant_admin of this tenant gets a
  -- roster row. Checked here rather than trusted from the caller, because
  -- SECURITY DEFINER means RLS is not doing it for us.
  if not exists (
    select 1 from user_roles
    where user_id = p_user_id
      and tenant_id = p_tenant_id
      and role = 'tenant_admin'
  ) then
    raise exception 'User % is not a tenant_admin of tenant %', p_user_id, p_tenant_id
      using errcode = '42501';
  end if;

  -- Reuse first. A re-invited official carries a soft-deleted 'removed' row
  -- alongside the live one, so 'removed' rows are skipped and the newest
  -- live row wins — the same shape as the reads in account/page.tsx and
  -- resolveOfficialSurfaceAccess.
  select id into v_official_id
  from officials
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and invite_status <> 'removed'
  order by created_at desc
  limit 1;

  if v_official_id is null then
    select ltrim(u.phone, '+'),
           coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), ltrim(u.phone, '+'))
      into v_phone, v_name
    from auth.users u
    where u.id = p_user_id;

    if v_phone is null or v_phone = '' then
      raise exception 'User % has no phone number to build a roster row from', p_user_id
        using errcode = '22023';
    end if;

    -- An admin may already sit on the roster under the same phone but
    -- without user_id linked (added by name/number before they had an
    -- account). Claiming that row keeps the partial unique index on
    -- (tenant_id, phone) satisfied and preserves any assignments already
    -- pointing at it, instead of failing with a 23505.
    select id into v_official_id
    from officials
    where tenant_id = p_tenant_id
      and phone = v_phone
      and invite_status <> 'removed'
    order by created_at desc
    limit 1;

    if v_official_id is not null then
      update officials
         set user_id = p_user_id,
             invite_status = 'confirmed'
       where id = v_official_id;
    else
      insert into officials (tenant_id, user_id, name, phone, invite_status)
      values (p_tenant_id, p_user_id, v_name, v_phone, 'confirmed')
      returning id into v_official_id;
      v_created := true;
    end if;
  end if;

  return jsonb_build_object(
    'official_id', v_official_id,
    'created', v_created
  );
end;
$$;

comment on function public.ensure_admin_roster_row is
  'F-MNT-20: gives a tenant_admin the officials row Peter''s 2026-06-24 '
  'decision says they should have — implicitly confirmed, no SMS invite — '
  'so they appear on OFF-01, can reach ACCT-01, and enter SCHED-01''s '
  'schedulable pool. Idempotent: reuses an existing non-removed row for the '
  'same user, or claims one matching their phone, and only inserts when '
  'neither exists. Returns {official_id, created}. SECURITY DEFINER because '
  'it reads auth.users; it verifies the tenant_admin role itself and is '
  'granted to service_role only (ADR-0002).';

-- ADR-0002 / migration 0035: server-only surface. This is SECURITY DEFINER
-- and reads auth.users, so it must never be reachable from a browser
-- session, only from server code holding the service role.
revoke all on function public.ensure_admin_roster_row(uuid, uuid) from public;
revoke all on function public.ensure_admin_roster_row(uuid, uuid) from anon;
revoke all on function public.ensure_admin_roster_row(uuid, uuid) from authenticated;
grant execute on function public.ensure_admin_roster_row(uuid, uuid) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'ensure_admin_roster_row';
