import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getUserRoles } from '@/lib/auth/tenant'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function AdminAccountPage({ params }: Props) {
  const { tenantSlug } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const roles = await getUserRoles(user.id)
  const tenantRole = roles.find((r) => r.tenantSlug === tenantSlug)
  if (!tenantRole) notFound()

  const service = await createSupabaseServiceClient()

  const { data: tenant } = await service
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  const { data: official } = await service
    .from('officials')
    .select('id, name, phone, sms_opt_out')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!official) {
    return (
      <div className="px-8 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Account</h1>
        <p className="text-sm text-gray-500">{user.email}</p>
      </div>
    )
  }

  const { count: assignmentCount } = await service
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('official_id', official.id)

  return (
    <div className="px-8 py-8">
      <AccountForm
        name={official.name}
        phone={official.phone}
        smsOptOut={official.sms_opt_out}
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        assignmentCount={assignmentCount ?? 0}
        i18nNamespace="admin"
        layout="desktop"
      />
    </div>
  )
}
