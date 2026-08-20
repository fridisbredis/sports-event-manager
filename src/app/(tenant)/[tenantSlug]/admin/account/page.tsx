import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
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

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  // Only a tenant_admin of this tenant or a system_admin may pass.
  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

  // Confirmed rows only, newest first — same reason as the official-facing account
  // page: a removed row and a re-confirmed row can both carry this
  // (user_id, tenant_id), and maybeSingle() errors on the pair. Must match the filter
  // in PATCH /api/account, or the form would edit a row the page never showed.
  const { data: official } = await supabase
    .from('officials')
    .select('id, name, phone, sms_opt_out')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .eq('invite_status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
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

  const { count: assignmentCount } = await supabase
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
