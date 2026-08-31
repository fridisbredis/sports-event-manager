import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { CommunicationPanel } from './_components/communication-panel'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function CommunicationPage({ params }: Props) {
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

  const { data: announcements, error } = await supabase
    .from('announcements')
    .select('id, tenant_id, channel, body, sms_sent, published_at, created_at')
    .eq('tenant_id', tenant.id)
    .order('published_at', { ascending: false })

  if (error) throw error

  return (
    <div className="px-8 py-8">
      <CommunicationPanel tenantId={tenant.id} announcements={announcements ?? []} />
    </div>
  )
}
