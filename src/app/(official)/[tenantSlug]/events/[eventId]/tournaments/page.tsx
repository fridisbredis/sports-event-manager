import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AppCard } from '@/components/ui/app-card'
import { offersTournaments, tournamentAppUrl } from '@/lib/tournament/app-url'
import { OpenTournamentsButton } from './_components/open-tournaments-button'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// ADR-0005 §6.3, step 3: tournaments between the event's officials run in
// the separate tournament app, opened from here in its own tab. Premium and
// professional only, and only for someone on the roster — everyone else gets
// a 404, as the tab is not shown to them either (officials cannot upgrade,
// so unlike the admin menu there is nothing to advertise). The layout above
// has already checked that the caller is on this event.
export default async function TournamentsPage({ params }: Props) {
  const { tenantSlug, eventId } = await params
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant || !offersTournaments(tenant)) notFound()

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('tournaments.title')}</h1>
      <AppCard bodyClassName="p-6 flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t('tournaments.intro')}</p>
        <OpenTournamentsButton
          appUrl={tournamentAppUrl()!}
          tenantSlug={tenantSlug}
          eventId={eventId}
        />
      </AppCard>
    </div>
  )
}
