import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getUserRoles } from '@/lib/auth/tenant'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'
import AdminAccountForm from './_components/admin-account-form'

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
  const isSystemAdmin = roles.some((r) => r.role === 'system_admin')
  const tenantRole = roles.find((r) => r.tenantSlug === tenantSlug)
  if (!tenantRole && !isSystemAdmin) notFound()

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
    const name = (user.user_metadata?.name as string | undefined) ?? ''
    const phone = user.phone ?? ''
    return (
      <div className="px-8 py-8">
        <AdminAccountForm name={name} phone={phone} tenantId={tenant.id} />
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
