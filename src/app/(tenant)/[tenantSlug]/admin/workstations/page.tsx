import { redirect, notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { workstationsCacheTag } from '@/lib/cache/tags'
import WorkstationsList from './_components/workstations-list'

interface Props {
  params: Promise<{ tenantSlug: string }>
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
    capacity_ceiling: number
    stage_id: string | null
    workstation_operating_windows: Array<{ window_start: string; window_end: string }>
  }>
}

export default async function WorkstationsPage({ params }: Props) {
  const { tenantSlug } = await params

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // PERF-06 / F-PERF-04 Phase 2 (ADR-0003): reads moved behind
  // get_admin_workstations_cached (migration 0051). Must be the
  // service-role client — unstable_cache can't reach cookies(), and this
  // is only safe because the RPC is SECURITY DEFINER owned by
  // cache_rpc_reader (NOBYPASSRLS), so service_role's own BYPASSRLS never
  // applies inside it.
  const getAdminWorkstationsCached = unstable_cache(
    async (tenantId: string) => {
      const service = createSupabaseServiceClient()
      // TODO(PERF-06 Phase 2): temporary `any` cast —
      // get_admin_workstations_cached (migration 0051) isn't in
      // src/types/database.ts yet because that's generated from dev's
      // schema and this migration hasn't been pushed there. Remove the
      // cast once db:types is regenerated post-push.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (service.rpc as any)('get_admin_workstations_cached', {
        p_tenant_id: tenantId,
      })
      if (error) throw error
      return data as unknown as AdminWorkstationsCached
    },
    ['admin-workstations'], // cache namespace, data-shape only — tenant
    // scoping comes entirely from the tenantId closure argument reaching
    // both the RPC call above and the tags array below
    {
      tags: [workstationsCacheTag(tenant.id)],
      revalidate: 60,
    }
  )

  const { event, stages, workstations } = await getAdminWorkstationsCached(tenant.id)

  if (!event) notFound()

  return (
    <div className="px-8 py-8">
      <WorkstationsList tenantSlug={tenantSlug} stages={stages} workstations={workstations} />
    </div>
  )
}
