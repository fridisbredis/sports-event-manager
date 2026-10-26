import { notFound } from 'next/navigation'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AppCard } from '@/components/ui/app-card'
import { listSystemAdmins } from '@/lib/auth/system-admins'
import { dateLocaleFor, EVENT_TIME_ZONE } from '@/lib/i18n/date-locale'
import { SystemAdminsSection } from './_components/system-admins-section'

// N28: who holds the global system_admin role, and adding or removing one.
export default async function SystemAdminsPage() {
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')

  const admins = await listSystemAdmins()

  // Formatted here, as on SYS-02, so dates follow the user's locale setting
  // (B7) and the event's zone rather than the browser's.
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
      <h1 className="page-title mb-8">{t('systemAdmin.systemAdmins')}</h1>

      <AppCard bodyClassName="p-0 overflow-hidden">
        <SystemAdminsSection
          admins={admins}
          currentUserId={auth.user.id}
          formattedDates={formattedDates}
        />
      </AppCard>
    </div>
  )
}
