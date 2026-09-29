-- ============================================================================
-- Migration 20260929095047: get_official_home_cached returns avatar_url
-- ============================================================================
--
-- ACCT-01 profile pictures (migration 20260929094440) added
-- officials.avatar_url. HOME-01's greeting avatar reads through this cached
-- RPC rather than a direct .from('officials') select, so the picture can only
-- reach that screen if the function returns it.
--
-- Return-shape contract (per .claude/reference/migrations.md): the existing
-- 'name' key MUST survive. src/app/(official)/[tenantSlug]/home/page.tsx
-- destructures the response as `{ name: string | null }` and renders it as
-- both the greeting and the initials fallback; dropping it is exactly the
-- silent-key-loss failure that migration 0045 shipped and 0046 had to repair.
-- This migration adds a key and changes nothing about 'name'.
--
-- Body is otherwise copied verbatim from 0050 (still the live definition —
-- 0055 touched the officials RLS policy this function relies on, not the
-- function itself), with only the extra selected column and the extra
-- jsonb_build_object key. The GUC set/reset pairs, the '' search_path, the
-- confirmed-rows-only filter and the created_at ordering are unchanged.
--
-- Ownership and grants are deliberately NOT restated: `create or replace`
-- preserves both, and the function must stay owned by cache_rpc_reader
-- (the NOBYPASSRLS role from 0049) for the RLS reasoning in 0050 to hold.
--
-- Forward-fix: replace
--   Rollback: Restore the definition from migration
--             0050_official_home_cache_rpc.sql — re-run that file's
--             `create or replace function` block verbatim. Grants and
--             ownership are unaffected by either direction.
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None in either direction. The added key is additive: code that
--             reads only 'name' is unaffected by an extra key, and code that
--             reads 'avatar_url' falls back to initials on undefined.
--   Window:   Compatible. The currently deployed HOME-01 reads only 'name',
--             which this still returns; the new image reads 'avatar_url',
--             which is present the moment this lands. Safe in either order.
-- ============================================================================

create or replace function public.get_official_home_cached(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_avatar_url text;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);
  perform pg_catalog.set_config('app.user_id', p_user_id::text, true);

  select o.name, o.avatar_url into v_name, v_avatar_url
  from public.officials o
  where o.tenant_id = p_tenant_id
    and o.user_id = p_user_id
    and o.invite_status = 'confirmed'
  order by o.created_at desc
  limit 1;

  -- Reset both GUCs before returning, matching 0051-0055. Not load-bearing on
  -- its own: set_config(..., true) is transaction-local and each PostgREST
  -- call is its own transaction, and a stale app.user_id would narrow a later
  -- read rather than widen it (0055's policy treats a set app.user_id as the
  -- own-row case). Done anyway so every cache RPC states its scope on entry
  -- and leaves none behind, instead of this one function being the exception.
  perform pg_catalog.set_config('app.user_id', '', true);
  perform pg_catalog.set_config('app.tenant_id', '', true);

  return jsonb_build_object('name', v_name, 'avatar_url', v_avatar_url);
end;
$$;
