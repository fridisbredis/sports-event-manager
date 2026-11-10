import { unstable_cache } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { eventInfoCacheTag } from '@/lib/cache/tags'
import type { InfoSection } from '@/lib/events/info-sections'

// What get_event_info_cached returns: the event's identity, its stages and its
// info sections (N38). Shared by INFO-01's official and participant variants
// and by PAR-01, which reads stage names and the event's status from it.
export interface EventInfoCached {
  event: {
    name: string | null
    event_type: string | null
    description: string | null
    logo_url: string | null
    status: string
  } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    stage_date: string | null
    start_time: string | null
    end_time: string | null
    venue: string | null
    results_url: string | null
    position: number
  }>
  info_sections: InfoSection[]
}

// PERF-06 / F-PERF-04 Phase 2 (ADR-0003): reads moved behind
// get_event_info_cached (migration 0051). Must be the service-role client —
// unstable_cache can't reach cookies(), and this is only safe because the RPC
// is SECURITY DEFINER owned by cache_rpc_reader (NOBYPASSRLS), so
// service_role's own BYPASSRLS never applies inside it.
//
// The RPC authorises nothing: it answers for whatever event it is given. Call
// it only after the caller's access to (tenantId, eventId) has been checked —
// getOfficialTenant for officials, the participant's own entries for
// participants.
export function getEventInfoCached(tenantId: string, eventId: string): Promise<EventInfoCached> {
  return unstable_cache(
    async (tenantId: string, eventId: string) => {
      const service = createSupabaseServiceClient()
      const { data, error } = await service.rpc('get_event_info_cached', {
        p_tenant_id: tenantId,
        p_event_id: eventId,
      })
      if (error) throw error
      return data as unknown as EventInfoCached
    },
    ['event-info'], // cache namespace, data-shape only — tenant scoping
    // comes entirely from the tenantId argument reaching both the RPC call
    // above and the tags array below
    {
      tags: [eventInfoCacheTag(tenantId)],
      revalidate: 60,
    }
  )(tenantId, eventId)
}
