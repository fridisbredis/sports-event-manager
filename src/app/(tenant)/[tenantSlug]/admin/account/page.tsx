import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'
import AdminAccountForm from './_components/admin-account-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function AdminAccountPage({ params }: Props) {
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
    // getCurrentUser() resolves identity from the JWT's own claims (PERF-01) —
    // fast, but the token only carries what was baked in at login and doesn't
    // reliably include phone/user_metadata the way GoTrue's live user record
    // does. This form needs the real values, so it looks the user up by their
    // own id instead of trusting the claims payload for display data.
    const {
      data: { user: authUser },
    } = await createSupabaseServiceClient().auth.admin.getUserById(user.id)
    const name = (authUser?.user_metadata?.name as string | undefined) ?? ''
    const phone = authUser?.phone ?? ''
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
