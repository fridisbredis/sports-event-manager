import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { Calendar } from 'lucide-react'
import { getCurrentUser, getParticipantTenant, hasOfficialScreens } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SurfaceSwitchBar } from '@/components/navigation/surface-switch-bar'
import { officialShiftsPath } from '@/lib/events/official-event'
import { effectivePalette, TenantThemeStyle } from '@/lib/theme/tenant-theme-style'
import { ParticipantTabBar } from './_components/participant-tab-bar'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// A participant who is also an official lands on the official surface after
// sign-in; this strip is their way back (and SurfaceLinksChrome on the official
// layout is the way here). It opens their schedule directly when they have one
// event, rather than the event picker. Suspended chrome, as in the official layout: no
// route's reachability depends on it.
export async function OfficialLinkChrome({ tenantSlug }: { tenantSlug: string }) {
  if (!(await hasOfficialScreens(tenantSlug))) return null
  const [t, href] = await Promise.all([
    getUserLanguage().then((lang) => getServerTranslation(lang, 'official')),
    officialShiftsPath(tenantSlug),
  ])
  return (
    <SurfaceSwitchBar links={[{ href, label: t('participant.nav.myShifts'), Icon: Calendar }]} />
  )
}

export default async function ParticipantLayout({ children, params }: Props) {
  const { tenantSlug } = await params

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Gates every participant screen. Awaited in the layout body, not behind a
  // Suspense boundary, for the reason spelled out in the official layout: a
  // notFound() after streaming starts would send a 404 body under a 200.
  const tenant = await getParticipantTenant(tenantSlug)

  if (!tenant) notFound()

  const soleEventId = tenant.entries.length === 1 ? tenant.entries[0].eventId : null

  return (
    <>
      <TenantThemeStyle colorPalette={effectivePalette(tenant)} />
      {/* min-h-svh, not min-h-screen: on iOS 100vh is the viewport with the
          browser bars collapsed, so a short page came out taller than the
          screen with the bars showing — it scrolled by the bar height and
          tucked the page title under the address bar. svh is the viewport with
          the bars showing, so a page that fits never scrolls. */}
      <div className="flex flex-col min-h-svh bg-white">
        <Suspense>
          <OfficialLinkChrome tenantSlug={tenantSlug} />
        </Suspense>
        <div className="flex-1 pb-16">{children}</div>
        <ParticipantTabBar tenantSlug={tenantSlug} soleEventId={soleEventId} />
      </div>
    </>
  )
}
