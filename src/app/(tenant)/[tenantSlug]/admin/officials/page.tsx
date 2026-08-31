import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import OfficialsList from './_components/officials-list'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

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

  if (error) throw error

  return (
    <div className="px-8 py-8">
      <OfficialsList
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        officials={officials ?? []}
        currentUserId={user.id}
      />
    </div>
  )
}
