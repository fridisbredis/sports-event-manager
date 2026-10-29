import { redirect } from 'next/navigation'
import { getDefaultAdminEventId } from '@/lib/events/admin-event'
import { adminEventPath } from '@/lib/events/paths'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// The admin landing page. Until TEN-01 lists the tenant's events, it opens
// the default event's dashboard. A tenant with no events at all (only ever
// made by hand — create_tenant_with_defaults always creates one) gets an
// empty state instead of a dashboard with nothing to show.
export default async function AdminIndexPage({ params }: Props) {
  const { tenantSlug } = await params
  const eventId = await getDefaultAdminEventId(tenantSlug)

  if (eventId) redirect(adminEventPath(tenantSlug, eventId, 'dashboard'))

  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-8 text-center">
      <h1 className="text-xl font-medium text-gray-900">{t('events.noEventsTitle')}</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-500">
        {t('events.noEventsBody')}
      </p>
    </div>
  )
}
