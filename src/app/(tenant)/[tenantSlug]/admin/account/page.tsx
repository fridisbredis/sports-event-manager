import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getUserLanguage } from '@/lib/i18n/user-language'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function AdminAccountPage({ params }: Props) {
  const { tenantSlug } = await params
  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()
  const language = await getUserLanguage()

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
    .select('id, name, phone, sms_opt_out, avatar_url')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .eq('invite_status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // No roster row means there is no account to edit in this tenant: ACCT-01
  // edits an `officials` row's name, avatar and SMS opt-out, none of which a
  // role-only admin has here. This used to fall back to a form built from
  // auth.users, which rendered an empty name and a '?' avatar and could not
  // save — so it now matches the official-facing page and the two nav bars,
  // which omit the link entirely (hasAccountScreen).
  if (!official) notFound()

  const { count: assignmentCount } = await supabase
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('official_id', official.id)

  return (
    <div className="px-8 py-8">
      <AccountForm
        name={official.name}
        avatarUrl={official.avatar_url}
        phone={official.phone}
        smsOptOut={official.sms_opt_out}
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        assignmentCount={assignmentCount ?? 0}
        i18nNamespace="admin"
        language={language}
        layout="desktop"
      />
    </div>
  )
}
