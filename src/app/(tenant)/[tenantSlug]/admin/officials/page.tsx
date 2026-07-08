import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import OfficialsList from './_components/officials-list'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function OfficialsPage({ params }: Props) {
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

  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

  const service = await createSupabaseServiceClient()

  const { data: officials } = await service
    .from('officials')
    .select('id, name, phone, invite_status, user_id, created_at, tenant_id, invite_token, invite_token_expires_at, sms_opt_out')
    .eq('tenant_id', tenant.id)
    .neq('invite_status', 'removed')
    .order('created_at', { ascending: true })

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
