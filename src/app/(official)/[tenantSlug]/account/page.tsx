import { redirect, notFound } from 'next/navigation'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import AccountForm from './_components/account-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function OfficialAccountPage({ params }: Props) {
  const { tenantSlug } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // Confirmed rows only, newest first: a re-invited official also has the old
  // soft-deleted ('removed') row on this (user_id, tenant_id), and maybeSingle() would
  // error on the pair and send a real official to notFound(). user_id is only ever set
  // at confirm time, so this filter excludes exactly the removed rows.
  const { data: official } = await supabase
    .from('officials')
    .select('id, name, phone, sms_opt_out, avatar_url')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .eq('invite_status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!official) notFound()

  const { count: assignmentCount } = await supabase
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('official_id', official.id)

  return (
    <div>
      {/* page-title like every other heading in the app. This was the one
          screen still using a local text-2xl/700, which rendered it 4px
          smaller and a weight lighter than the titles on Event info and
          Announcements right next to it in the tab bar.

          pb-0: AccountForm opens with its own pt-10, and the two used to
          stack into a band of empty space under the title that appeared
          nowhere else. */}
      <div className="px-5 pt-10">
        <h1 className="page-title">{t('account.title')}</h1>
      </div>
      <AccountForm
        name={official.name}
        avatarUrl={official.avatar_url}
        phone={official.phone}
        smsOptOut={official.sms_opt_out}
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        assignmentCount={assignmentCount ?? 0}
        i18nNamespace="official"
        language={language}
      />
    </div>
  )
}
