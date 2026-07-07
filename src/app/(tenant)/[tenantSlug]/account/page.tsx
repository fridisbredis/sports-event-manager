import { redirect, notFound } from 'next/navigation'
import { getServerTranslation } from '@/lib/i18n/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function AdminAccountPage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'admin')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

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

  if (!official) notFound()

  const { count: assignmentCount } = await service
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('official_id', official.id)

  return (
    <div>
      <div className="px-5 pt-10 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">{t('account.title')}</h1>
      </div>
      <AccountForm
        name={official.name}
        phone={official.phone}
        smsOptOut={official.sms_opt_out}
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        assignmentCount={assignmentCount ?? 0}
        i18nNamespace="admin"
      />
    </div>
  )
}
