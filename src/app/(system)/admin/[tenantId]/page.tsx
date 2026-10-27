import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AppCard } from '@/components/ui/app-card'
import { TenantDetail } from './_components/tenant-detail'
import { TenantAdminsSection } from './_components/tenant-admins-section'
import { TenantSmsSection } from './_components/tenant-sms-section'
import { listTenantAdmins } from '@/lib/auth/tenant-admins'
import { maxTenantAdmins } from '@/lib/tiers/features'
import { dateLocaleFor, EVENT_TIME_ZONE } from '@/lib/i18n/date-locale'
import { readSmsCapStatus } from '@/lib/sms/cap'

interface Props {
  params: Promise<{ tenantId: string }>
}

export default async function TenantDetailPage({ params }: Props) {
  const { tenantId } = await params

  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')
  const supabase = await createSupabaseServerClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, is_active, tier, sms_sender_id')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) notFound()

  const admins = await listTenantAdmins(tenant.id, tenant.tier)

  // N24: this month's spend for this tenant. Service client because
  // sms_usage is revoked from `authenticated`; the system-admin check above
  // has already passed.
  const smsUsage = await readSmsCapStatus({
    service: createSupabaseServiceClient(),
    tenantId: tenant.id,
    tier: tenant.tier,
    op: 'GET /(system)/admin/[tenantId]',
  })

  // Formatted here rather than in the client component so the dates follow the
  // user's locale setting (B7: locale and text language are separate settings)
  // and the event's zone, instead of whatever the browser happens to be in.
  const dateFormatter = new Intl.DateTimeFormat(dateLocaleFor(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: EVENT_TIME_ZONE,
  })
  const formattedDates = Object.fromEntries(
    admins.map((admin) => [admin.userId, dateFormatter.format(new Date(admin.createdAt))])
  )

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
      <Link
        href="/admin"
        className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-ink-label transition-colors hover:text-ink"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
        {t('systemAdmin.tenants')}
      </Link>

      <h1 className="page-title mb-8 mt-3">{tenant.name}</h1>

      <AppCard bodyClassName="p-0 overflow-hidden">
        <TenantDetail
          tenantId={tenant.id}
          isActive={tenant.is_active}
          tier={tenant.tier as 'standard' | 'premium' | 'professional'}
          smsSenderId={tenant.sms_sender_id}
        />
        {/* Directly under the feature tier, which is what sets the cap: an
            admin who has just changed a tenant's tier sees what that did to
            its allowance without leaving the page. */}
        <div className="border-t border-edge-soft">
          <TenantSmsSection
            usage={smsUsage}
            language={language}
            title={t('systemAdmin.smsUsageTitle')}
            spentLabel={t('systemAdmin.smsSpent')}
            capLabel={t('systemAdmin.smsCap')}
            segmentsLabel={t('systemAdmin.smsSegments')}
            statusLabel={t('systemAdmin.smsWithinCap')}
            blockedHint={t('systemAdmin.smsBlockedHint')}
            unavailableHint={t('systemAdmin.smsUnavailable')}
            estimateHint={smsUsage?.usingFallbackRate ? t('systemAdmin.smsEstimated') : undefined}
          />
        </div>
        <div className="border-t border-edge-soft">
          <TenantAdminsSection
            tenantId={tenant.id}
            admins={admins}
            cap={maxTenantAdmins(tenant.tier)}
            formattedDates={formattedDates}
          />
        </div>
      </AppCard>
    </div>
  )
}
