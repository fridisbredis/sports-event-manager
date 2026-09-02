import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import OfficialsList from './_components/officials-list'
import { logger } from '@/lib/logger'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// A guard-rail, not pagination. A confirmed typical tenant runs 10-15
// officials (quality-requirements.md:113), so this ceiling should never be
// reached; asking for one row past it makes a breach visible in the logs
// instead of silently shortening the roster.
const OFFICIALS_CEILING = 500

export default async function OfficialsPage({ params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  const { data: officials, error } = await supabase
    .from('officials')
    .select('id, name, phone, invite_status, user_id, created_at, tenant_id, sms_opt_out')
    .eq('tenant_id', tenant.id)
    .neq('invite_status', 'removed')
    .order('created_at', { ascending: true })
    .range(0, OFFICIALS_CEILING)

  if (error) throw error

  const rows = officials ?? []
  if (rows.length > OFFICIALS_CEILING) {
    logger.warn('Officials roster hit its read ceiling — the list is truncated', {
      ceiling: OFFICIALS_CEILING,
      tenantId: tenant.id,
      page: 'admin/officials',
    })
  }

  return (
    <div className="px-8 py-8">
      <OfficialsList
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        officials={rows.slice(0, OFFICIALS_CEILING)}
        currentUserId={user.id}
      />
    </div>
  )
}
