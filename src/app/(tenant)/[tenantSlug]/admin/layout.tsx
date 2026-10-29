import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getAdminTenant, hasAccountScreen } from '@/lib/auth/tenant'
import { hasFeature } from '@/lib/tiers/features'
import { SidebarNav } from './_components/sidebar-nav'
import { getDefaultAdminEventId } from '@/lib/events/admin-event'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { effectivePalette, TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// The sidebar's own data, which the gate above does not need.
//
// Only hasAccountScreen lives here. It decides whether the sidebar shows an
// Account link and nothing else — no route's reachability depends on it, so
// suspending it costs no guarantee. The access check itself stays in the
// layout body below.
export async function SidebarChrome({
  tenantSlug,
  adminLabel,
}: {
  tenantSlug: string
  adminLabel: string
}) {
  // ACCT-01 is backed by an `officials` row, which an admin who reaches this
  // tenant by role alone does not have — see hasAccountScreen.
  const showAccount = await hasAccountScreen(tenantSlug)

  // N21: PART-01 is Premium and up, so a Standard tenant gets no link.
  // getAdminTenant is memoised per render pass, so this costs no extra
  // query. The page and every participants server action carry the same
  // gate independently — hiding a link is not access control.
  const tenant = await getAdminTenant(tenantSlug)
  const showParticipants = tenant != null && hasFeature(tenant.tier, 'participants')

  // N23: on a screen whose URL names no event (Account), the event links
  // open the default event. Memoised, so the admin index and legacy
  // redirects that also ask for it pay nothing extra.
  const defaultEventId = await getDefaultAdminEventId(tenantSlug)

  return (
    <SidebarNav
      tenantSlug={tenantSlug}
      adminLabel={adminLabel}
      showAccount={showAccount}
      showParticipants={showParticipants}
      defaultEventId={defaultEventId}
    />
  )
}

export default async function TenantLayout({ children, params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Resolves the tenant only once the caller has passed the admin access
  // check, so this layout still gates every page beneath it. Memoised per
  // render pass (F-PERF-07), so the pages below reuse this result instead of
  // repeating the GoTrue round trip and the two access-context queries.
  //
  // This await is deliberately in the layout body and must stay there, even
  // though it costs the instant navigation a loading.tsx would otherwise buy.
  // notFound() terminates the segment it is thrown in: once a Suspense shell
  // has started streaming, the 200 is already on the wire and an unauthorised
  // caller gets a 404 body under a 200 status. The e2e access-control suite
  // asserts the status, and is right to — that is the part a client or a
  // crawler acts on. Reachability is not a thing to trade for a skeleton.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  return (
    <>
      <TenantThemeStyle colorPalette={effectivePalette(tenant)} />
      <div className="app-surface flex min-h-screen">
        {/* Suspended because it is chrome, not a gate: no fallback, since a
            grey unclickable rail reads worse than the real one arriving a
            moment later. */}
        <Suspense>
          <SidebarChrome tenantSlug={tenantSlug} adminLabel={t('navigation.adminLabel')} />
        </Suspense>
        {/* pb-24 on a phone reserves the floating menu button's corner, so the
            last row of a page can still be read and tapped once scrolled to
            the bottom — without it the button sat on top of whatever ended
            the page. Nothing floats on desktop, where the rail carries the
            navigation instead. */}
        <div className="min-w-0 flex-1 pb-24 md:pb-0">{children}</div>
      </div>
    </>
  )
}
