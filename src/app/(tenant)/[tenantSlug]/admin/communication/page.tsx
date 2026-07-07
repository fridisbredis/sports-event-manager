import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { CommunicationPanel } from './_components/communication-panel'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function CommunicationPage({ params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!roleRow || (roleRow.role !== 'tenant_admin' && roleRow.role !== 'system_admin')) {
    notFound()
  }

  const { data: announcements } = await service
    .from('announcements')
    .select('id, tenant_id, channel, body, sms_sent, published_at, created_at')
    .eq('tenant_id', tenant.id)
    .order('published_at', { ascending: false })

  return (
    <div className="px-8 py-8">
      <CommunicationPanel
        tenantId={tenant.id}
        announcements={announcements ?? []}
      />
    </div>
  )
}
