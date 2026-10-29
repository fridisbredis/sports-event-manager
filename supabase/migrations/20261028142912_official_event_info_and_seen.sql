-- ============================================================================
-- Migration 20261028142912: INFO-01 reads the event in the URL, and officials
-- can mark a new event as seen (N23)
-- ============================================================================
--
-- Official surfaces move under /[tenantSlug]/events/[eventId]/ in the same
-- PR, the way the admin screens did.
--
-- 1. get_event_info_cached took only p_tenant_id and showed the tenant's
--    OLDEST event, whichever the official opened. It now takes
--    (p_tenant_id uuid, p_event_id uuid DEFAULT NULL), dropped and re-created
--    rather than overloaded (PGRST203) — the same change, for the same
--    reasons, as 20261028140031 made to the admin RPCs. The body is the live
--    definition with only the line marked N23 changed; the return shape is
--    unchanged.
--
-- 2. mark_official_event_seen(p_event_id) sets seen_at on the caller's own
--    membership in that event. seen_at NULL is the "you were added to a new
--    event" notice (20261028104200); the event picker shows it and opening
--    the event clears it. SECURITY DEFINER, so officials need no UPDATE
--    policy on official_events — one that would let them rewrite other
--    columns of their membership. It can only ever touch rows of the caller
--    (o.user_id = auth.uid()) and only seen_at, and only from NULL.
--
-- Forward-fix: replace (get_event_info_cached signature and body replaced;
--   mark_official_event_seen is additive)
--   Rollback: drop function if exists public.mark_official_event_seen(uuid);
--             drop function if exists public.get_event_info_cached(uuid, uuid);
--             then restore the (uuid) version, with its revoke/grant/owner
--             lines, from 20260929153848_event_info_cached_add_stage_date.sql.
--   Data:     prod snapshot 20261028095200_pre-migration_2026-10-29T12-48-16Z.tar.gz (N23 release).
--             no data loss. The only write is seen_at, a notice flag.
--   Blast:    if get_event_info_cached were wrong, INFO-01 fails to load. If
--             mark_official_event_seen were wrong, the "new event" badge
--             would stay or vanish wrongly — nothing else reads seen_at.
--   Window:   compatible. Deployed code calls get_event_info_cached with
--             p_tenant_id only, which resolves to the new function with the
--             old behaviour; it never calls mark_official_event_seen.
-- ============================================================================

drop function if exists public.get_event_info_cached(uuid);

CREATE OR REPLACE FUNCTION public.get_event_info_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event      jsonb;
  v_stages     jsonb;
  v_facilities jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  select jsonb_build_object(
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'logo_url', e.logo_url,
           'status', e.status
         )
    into v_event
  from public.events e
  where e.tenant_id = p_tenant_id
    and (p_event_id is null or e.id = p_event_id) -- N23
  order by e.created_at asc
  limit 1;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'stage_date', s.stage_date,
               'start_time', s.start_time,
               'end_time', s.end_time,
               'venue', s.venue,
               'results_url', s.results_url,
               'position', s.position
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.tenant_id = p_tenant_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', f.id,
               'label', f.label,
               'position', f.position
             )
             order by f.position asc
           ),
           '[]'::jsonb
         )
    into v_facilities
  from public.event_facilities f
  where f.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { name, event_type, description, logo_url, status } | null,
  --     stages:     [ { id, name, stage_type, stage_date, start_time,
  --                     end_time, venue, results_url, position } ],
  --     facilities: [ { id, label, position } ] }
  -- `event` is JSON null when the tenant has no event row; the two arrays
  -- are always arrays, never null.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'facilities', v_facilities
  );
end;
$function$;

revoke all on function public.get_event_info_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_info_cached(uuid, uuid) to service_role;
alter function public.get_event_info_cached(uuid, uuid) owner to cache_rpc_reader;

create or replace function public.mark_official_event_seen(p_event_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.official_events oe
  set seen_at = now()
  from public.officials o
  where o.id = oe.official_id
    and o.user_id = auth.uid()
    and oe.event_id = p_event_id
    and oe.seen_at is null;
$$;

comment on function public.mark_official_event_seen(uuid) is
  'N23: clears the caller''s own "new event" notice for one event.';

revoke all on function public.mark_official_event_seen(uuid) from public, anon;
grant execute on function public.mark_official_event_seen(uuid) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select p.oid::regprocedure from pg_proc p
--   where p.proname in ('get_event_info_cached', 'mark_official_event_seen');
