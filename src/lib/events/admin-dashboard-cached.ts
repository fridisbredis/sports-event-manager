import { unstable_cache } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { adminDashboardCacheTag } from '@/lib/cache/tags'

export interface AdminDashboardCached {
  event: {
    id: string
    name: string | null
    event_type: string | null
    start_date: string | null
    end_date: string | null
    status: string
    scheduling_granularity_min: number
    logo_url: string | null
  } | null
  officials_invited: number
  officials_confirmed: number
  race_stage_count: number
  over_capacity: number
  double_booked: number
  time_off_clash: number
  earliest_day: string | null
  earliest_stage_id: string | null
}

// PERF-06 / F-PERF-04 Phase 3 (ADR-0003): the event read, both officials
// head-counts, the race-stage count, and the scheduling-warning counts (once
// five separate round trips, one of them a Postgres RPC) sit behind
// get_admin_dashboard_cached (migration 0054). Read by the dashboard and by
// Help and guide (B22), which shows the same setup progress.
//
// Must be the service-role client — unstable_cache can't reach cookies(), and
// this is only safe because the RPC is SECURITY DEFINER owned by
// cache_rpc_reader (NOBYPASSRLS), so service_role's own BYPASSRLS never
// applies inside it. Callers must have authorized the tenant first
// (getAdminTenant) — this function does not.
export function getAdminDashboardCached(
  tenantId: string,
  eventId: string
): Promise<AdminDashboardCached> {
  return unstable_cache(
    async (tenantId: string, eventId: string) => {
      const service = createSupabaseServiceClient()
      const { data, error } = await service.rpc('get_admin_dashboard_cached', {
        p_tenant_id: tenantId,
        p_event_id: eventId,
      })
      if (error) throw error
      return data as unknown as AdminDashboardCached
    },
    ['admin-dashboard'], // cache namespace, data-shape only — tenant scoping
    // comes entirely from the tenantId argument reaching both the RPC call
    // above and the tags array below
    {
      tags: [adminDashboardCacheTag(tenantId)],
      revalidate: 60,
    }
  )(tenantId, eventId)
}
