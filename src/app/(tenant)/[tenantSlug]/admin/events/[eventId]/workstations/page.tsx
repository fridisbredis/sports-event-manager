import { redirect, notFound } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import WorkstationsList from './_components/workstations-list'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

interface AdminWorkstationsCached {
  event: { id: string } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    start_time: string | null
    end_time: string | null
  }>
  workstations: Array<{
    id: string
    name: string
    color: string | null
    capacity_ceiling: number
    stage_id: string | null
    workstation_operating_windows: Array<{ window_start: string; window_end: string }>
  }>
}

export default async function WorkstationsPage({ params }: Props) {
  const { tenantSlug, eventId } = await params

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // Read uncached, on purpose. This is an edit screen: after a save the admin
  // must see their own write on the very next render. ADR-0003 put it behind
  // unstable_cache, but that cache is per replica (prod runs 2-3 and has no
  // shared cacheHandler), so updateTag only cleared the replica that handled
  // the write. A router.refresh() landing on another replica got the old
  // payload for up to 60s — a new work area did not show until a reload. With ~3 admins per event the cache saved almost nothing here.
  //
  // Still the service-role client and the *_cached RPC: the RPC is SECURITY
  // DEFINER owned by cache_rpc_reader (NOBYPASSRLS), so service_role's own
  // BYPASSRLS never applies inside it, and tenant.id comes from
  // getAdminTenant above, which has already authorized this admin.
  const service = createSupabaseServiceClient()
  const { data, error } = await service.rpc('get_admin_workstations_cached', {
    p_tenant_id: tenant.id,
    p_event_id: eventId,
  })
  if (error) throw error
  const { event, stages, workstations } = data as unknown as AdminWorkstationsCached

  if (!event) notFound()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <WorkstationsList stages={stages} workstations={workstations} />
    </div>
  )
}
