import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftRight, ChevronRight } from 'lucide-react'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { listOfficialEvents } from '@/lib/events/official-event'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import AccountForm from './_components/account-form'
import { countOfficialShifts } from '@/lib/scheduling/shift-count'

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

  // Shifts, not slots: one `assignments` row is one grid slot, and the head
  // count this used to do reported hours. See `countOfficialShifts`.
  const shiftCount = await countOfficialShifts(supabase, {
    tenantId: tenant.id,
    officialId: official.id,
  })

  const hasSeveralEvents = (await listOfficialEvents(tenantSlug)).length > 1

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
        {/* N23: only for someone with more than one event — with one there
            is nothing to change to. Leads to the same picker as login. */}
        {hasSeveralEvents && (
          <Link
            href={`/${tenantSlug}/events`}
            className={`card-accent-left mt-6 flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:border-tenant-primary hover:bg-tenant-primary-tint`}
          >
            <div className="flex size-12 shrink-0 items-center justify-center rounded-large bg-tenant-primary-tint text-tenant-primary-tint-text">
              <ArrowLeftRight className="size-6" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold leading-snug text-ink">
                {t('events.changeEvent')}
              </p>
              <p className="mt-0.5 text-[15px] leading-snug text-ink-muted">
                {t('events.changeEventSub')}
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-tenant-primary" aria-hidden="true" />
          </Link>
        )}
      </div>
      <AccountForm
        name={official.name}
        avatarUrl={official.avatar_url}
        phone={official.phone}
        smsOptOut={official.sms_opt_out}
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        shiftCount={shiftCount}
        i18nNamespace="official"
        language={language}
      />
    </div>
  )
}
